/**
 * font-metadata.test.ts
 *
 * Pure, offline tests for the sfnt reader. All font bytes are synthesised
 * in the test itself — no network, no database, no real font files.
 *
 * Coverage:
 *   - OTTO (CFF) container detection
 *   - TrueType (0x00010000) container detection
 *   - name table: platform 3 (Windows/UTF-16BE) strings
 *   - name table: platform 1 (Mac Roman) strings
 *   - name table: ID 16/17 preferred over 1/2 when present
 *   - OS/2 table: weightClass and fsSelection italic bit
 *   - post table: italicAngle fixed-point conversion
 *   - fvar table: axes present → isVariable = true
 *   - fvar table: absent → isVariable = false
 *   - ttcf container → ok: false, honest reason
 *   - wOF2 container → ok: false, Brotli reason
 *   - wOFF container → ok: false, zlib reason
 *   - truncated buffer (< 12 bytes) → ok: false or null (no throw)
 *   - table offset out of bounds → ok: true, missing table fields (fail safe)
 *   - mergeWithFilenameGuess: binary wins; filename fills gaps; provenance preserved
 *   - parseTableDirectory: returns entries or empty entries for compressed containers
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseFontMetadata,
  parseTableDirectory,
  mergeWithFilenameGuess,
  type ParsedFontMetadata,
} from "./font-metadata.js";

// ---------------------------------------------------------------------------
// Synthetic buffer builders
// ---------------------------------------------------------------------------

/** Write a big-endian uint32 into a DataView. */
function writeU32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value, false);
}

/** Write a big-endian uint16 into a DataView. */
function writeU16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value, false);
}

/** Write a big-endian int32 into a DataView. */
function writeI32(view: DataView, offset: number, value: number): void {
  view.setInt32(offset, value, false);
}

/** Write ASCII bytes into a DataView at offset. */
function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}

/**
 * A name record entry in the name table.
 */
interface NameEntry {
  platformId: number;
  encodingId: number;
  languageId: number;
  nameId: number;
  text: string;
  utf16: boolean; // true = UTF-16BE, false = Mac Roman (single-byte)
}

/**
 * Build a minimal sfnt buffer.
 *
 * @param sfntMagic  4-byte sfnt tag (0x00010000 for TrueType, 'OTTO' for CFF)
 * @param nameEntries  Records to include in the 'name' table (may be empty)
 * @param os2Weight  usWeightClass to write (undefined = omit OS/2)
 * @param os2FsSelection  fsSelection value (undefined = omit OS/2)
 * @param italicAngleFP  post italicAngle as 16.16 fixed int (undefined = omit post)
 * @param fvarAxes  Axes to write in fvar (undefined or [] = omit fvar)
 */
function buildSfnt(opts: {
  sfntMagic?: number; // default 0x00010000
  sfntTag?: string; // alternative: set the 4-byte tag directly (e.g. 'OTTO')
  nameEntries?: NameEntry[];
  os2Weight?: number;
  os2FsSelection?: number;
  italicAngleFP?: number; // 16.16 fixed-point integer
  fvarAxes?: Array<{ tag: string; min: number; def: number; max: number }>;
  badTableOffset?: boolean; // force name table offset to point out of bounds
}): ArrayBuffer {
  // We build: sfnt header (12) + table directory (16 * numTables) + table data.
  // Decide which tables to include.
  const tables: string[] = [];
  if (opts.nameEntries !== undefined) tables.push("name");
  if (opts.os2Weight !== undefined || opts.os2FsSelection !== undefined) tables.push("OS/2");
  if (opts.italicAngleFP !== undefined) tables.push("post");
  if (opts.fvarAxes && opts.fvarAxes.length > 0) tables.push("fvar");
  if (tables.length === 0) tables.push("name"); // always need at least one table

  const numTables = tables.length;

  // --- Compute name table bytes ---
  const nameEntries = opts.nameEntries ?? [];
  // Build string storage: each entry's bytes concatenated.
  const stringBytes: Uint8Array[] = [];
  const stringOffsets: number[] = [];
  const stringSizes: number[] = [];
  let storageSize = 0;
  for (const entry of nameEntries) {
    stringOffsets.push(storageSize);
    let bytes: Uint8Array;
    if (entry.utf16) {
      bytes = new Uint8Array(entry.text.length * 2);
      const dv = new DataView(bytes.buffer);
      for (let i = 0; i < entry.text.length; i++) {
        dv.setUint16(i * 2, entry.text.charCodeAt(i), false);
      }
    } else {
      bytes = new Uint8Array(entry.text.length);
      for (let i = 0; i < entry.text.length; i++) {
        bytes[i] = entry.text.charCodeAt(i) & 0xff;
      }
    }
    stringSizes.push(bytes.length);
    stringBytes.push(bytes);
    storageSize += bytes.length;
  }

  const nameHeaderSize = 6; // format(2) + count(2) + stringOffset(2)
  const nameRecordSize = 12;
  const nameStorageOffset = nameHeaderSize + nameEntries.length * nameRecordSize;
  const nameTableSize = nameStorageOffset + storageSize;

  // --- Compute OS/2 table bytes ---
  const os2TableSize = 78; // minimum v0

  // --- Compute post table bytes ---
  const postTableSize = 32; // enough for header + italicAngle

  // --- Compute fvar table bytes ---
  const fvarAxes = opts.fvarAxes ?? [];
  const fvarAxisSize = 20; // standard axis record size
  const fvarAxesArrayOffset = 16; // right after the fvar header
  const fvarTableSize = fvarAxesArrayOffset + fvarAxes.length * fvarAxisSize;

  // Layout: sfnt header + directory + table data blocks.
  const headerSize = 12 + numTables * 16;

  // Assign offsets for each table sequentially.
  const tableOffsets: Map<string, number> = new Map();
  const tableSizes: Map<string, number> = new Map();
  let cursor = headerSize;
  for (const tag of tables) {
    tableOffsets.set(tag, cursor);
    let size = 0;
    if (tag === "name") size = nameTableSize;
    else if (tag === "OS/2") size = os2TableSize;
    else if (tag === "post") size = postTableSize;
    else if (tag === "fvar") size = fvarTableSize;
    tableSizes.set(tag, size);
    cursor += size;
  }

  const totalSize = cursor;
  const buf = new ArrayBuffer(totalSize);
  const view = new DataView(buf);

  // Write sfnt header.
  if (opts.sfntTag) {
    writeAscii(view, 0, opts.sfntTag);
  } else {
    writeU32(view, 0, opts.sfntMagic ?? 0x00010000);
  }
  writeU16(view, 4, numTables);
  // searchRange, entrySelector, rangeShift — not important for our parser.
  writeU16(view, 6, 0);
  writeU16(view, 8, 0);
  writeU16(view, 10, 0);

  // Write table directory.
  for (let i = 0; i < tables.length; i++) {
    const tag = tables[i]!;
    const base = 12 + i * 16;
    writeAscii(view, base, tag);
    writeU32(view, base + 4, 0); // checksum
    const offset = opts.badTableOffset && tag === "name"
      ? totalSize + 9999 // deliberately out of bounds
      : tableOffsets.get(tag)!;
    writeU32(view, base + 8, offset);
    writeU32(view, base + 12, tableSizes.get(tag)!);
  }

  // Write name table.
  if (tables.includes("name")) {
    const nb = tableOffsets.get("name")!;
    writeU16(view, nb, 0); // format 0
    writeU16(view, nb + 2, nameEntries.length); // count
    writeU16(view, nb + 4, nameStorageOffset); // stringOffset

    for (let i = 0; i < nameEntries.length; i++) {
      const entry = nameEntries[i]!;
      const r = nb + 6 + i * 12;
      writeU16(view, r, entry.platformId);
      writeU16(view, r + 2, entry.encodingId);
      writeU16(view, r + 4, entry.languageId);
      writeU16(view, r + 6, entry.nameId);
      writeU16(view, r + 8, stringSizes[i]!);
      writeU16(view, r + 10, stringOffsets[i]!);
    }

    // Write string storage.
    let storeCursor = nb + nameStorageOffset;
    for (const sb of stringBytes) {
      for (let i = 0; i < sb.length; i++) {
        view.setUint8(storeCursor + i, sb[i]!);
      }
      storeCursor += sb.length;
    }
  }

  // Write OS/2 table.
  if (tables.includes("OS/2")) {
    const ob = tableOffsets.get("OS/2")!;
    writeU16(view, ob, 0); // version 0
    // usWeightClass at +4
    writeU16(view, ob + 4, opts.os2Weight ?? 400);
    // fsSelection at +62
    writeU16(view, ob + 62, opts.os2FsSelection ?? 0);
  }

  // Write post table.
  if (tables.includes("post")) {
    const pb = tableOffsets.get("post")!;
    writeU32(view, pb, 0x00020000); // version 2.0
    // italicAngle at +4 (Fixed 16.16)
    writeI32(view, pb + 4, opts.italicAngleFP ?? 0);
  }

  // Write fvar table.
  if (tables.includes("fvar")) {
    const fb = tableOffsets.get("fvar")!;
    writeU16(view, fb, 1); // majorVersion
    writeU16(view, fb + 2, 0); // minorVersion
    writeU16(view, fb + 4, fvarAxesArrayOffset); // axesArrayOffset
    writeU16(view, fb + 6, 0); // reserved
    writeU16(view, fb + 8, fvarAxes.length); // axisCount
    writeU16(view, fb + 10, fvarAxisSize); // axisSize
    writeU16(view, fb + 12, 0); // instanceCount
    writeU16(view, fb + 14, 0); // instanceSize

    for (let i = 0; i < fvarAxes.length; i++) {
      const axis = fvarAxes[i]!;
      const ab2 = fb + fvarAxesArrayOffset + i * fvarAxisSize;
      writeAscii(view, ab2, axis.tag);
      writeI32(view, ab2 + 4, axis.min);
      writeI32(view, ab2 + 8, axis.def);
      writeI32(view, ab2 + 12, axis.max);
      writeU16(view, ab2 + 16, 0); // axisNameID
      writeU16(view, ab2 + 18, 0); // flags
    }
  }

  return buf;
}

/** Build a raw 4-byte magic buffer. */
function magicBuf(bytes: [number, number, number, number]): ArrayBuffer {
  const buf = new ArrayBuffer(4);
  const view = new DataView(buf);
  for (let i = 0; i < 4; i++) view.setUint8(i, bytes[i]!);
  return buf;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("parseFontMetadata", () => {
  // ── Container detection ────────────────────────────────────────────────

  it("recognises TrueType (0x00010000) container", () => {
    const buf = buildSfnt({
      sfntMagic: 0x00010000,
      nameEntries: [
        { platformId: 3, encodingId: 1, languageId: 0x0409, nameId: 1, text: "TestFont", utf16: true },
      ],
    });
    const result = parseFontMetadata(buf);
    assert.ok(result.ok, `expected ok: true, got reason: ${!result.ok ? result.reason : ""}`);
    assert.equal(result.container, "truetype");
  });

  it("recognises OTTO (CFF) container", () => {
    const buf = buildSfnt({
      sfntTag: "OTTO",
      nameEntries: [
        { platformId: 3, encodingId: 1, languageId: 0x0409, nameId: 1, text: "CFFFont", utf16: true },
      ],
    });
    const result = parseFontMetadata(buf);
    assert.ok(result.ok);
    assert.equal(result.container, "otto");
  });

  it("returns ok:false for ttcf with a clear reason", () => {
    const buf = new ArrayBuffer(16);
    const view = new DataView(buf);
    writeAscii(view, 0, "ttcf");
    const result = parseFontMetadata(buf);
    assert.equal(result.ok, false);
    assert.equal(result.container, "ttcf");
    assert.ok(result.reason.length > 10, "reason should be descriptive");
  });

  it("returns ok:false for wOF2 with a Brotli reason", () => {
    const buf = new ArrayBuffer(16);
    const view = new DataView(buf);
    writeAscii(view, 0, "wOF2");
    const result = parseFontMetadata(buf);
    assert.equal(result.ok, false);
    assert.equal(result.container, "wOF2");
    assert.ok(
      result.reason.toLowerCase().includes("brotli"),
      `expected 'Brotli' in reason, got: ${result.reason}`,
    );
  });

  it("returns ok:false for wOFF (zlib) without throwing", () => {
    const buf = new ArrayBuffer(16);
    const view = new DataView(buf);
    writeAscii(view, 0, "wOFF");
    const result = parseFontMetadata(buf);
    assert.equal(result.ok, false);
    assert.equal(result.container, "wOFF");
    assert.ok(result.reason.length > 10);
  });

  // ── name table: platform 3 (Windows UTF-16BE) ─────────────────────────

  it("reads name ID 1 and 2 from platform 3 (UTF-16BE)", () => {
    const buf = buildSfnt({
      nameEntries: [
        { platformId: 3, encodingId: 1, languageId: 0x0409, nameId: 1, text: "MyFamily", utf16: true },
        { platformId: 3, encodingId: 1, languageId: 0x0409, nameId: 2, text: "Regular", utf16: true },
      ],
    });
    const result = parseFontMetadata(buf);
    assert.ok(result.ok);
    assert.equal(result.family?.value, "MyFamily");
    assert.equal(result.family?.source, "name_table");
    assert.equal(result.subfamily?.value, "Regular");
    assert.equal(result.subfamily?.source, "name_table");
  });

  // ── name table: platform 1 (Mac Roman) ────────────────────────────────

  it("reads name ID 1 from platform 1 (Mac Roman) when platform 3 absent", () => {
    const buf = buildSfnt({
      nameEntries: [
        { platformId: 1, encodingId: 0, languageId: 0, nameId: 1, text: "MacFamily", utf16: false },
        { platformId: 1, encodingId: 0, languageId: 0, nameId: 2, text: "Bold", utf16: false },
      ],
    });
    const result = parseFontMetadata(buf);
    assert.ok(result.ok);
    assert.equal(result.family?.value, "MacFamily");
    assert.equal(result.subfamily?.value, "Bold");
  });

  // ── name table: ID 16/17 preferred over 1/2 ───────────────────────────

  it("prefers name ID 16 (typographic family) over ID 1 when both present", () => {
    const buf = buildSfnt({
      nameEntries: [
        { platformId: 3, encodingId: 1, languageId: 0x0409, nameId: 1, text: "ShortName", utf16: true },
        { platformId: 3, encodingId: 1, languageId: 0x0409, nameId: 16, text: "Typographic Family", utf16: true },
      ],
    });
    const result = parseFontMetadata(buf);
    assert.ok(result.ok);
    assert.equal(result.family?.value, "Typographic Family");
  });

  it("prefers name ID 17 (typographic subfamily) over ID 2 when both present", () => {
    const buf = buildSfnt({
      nameEntries: [
        { platformId: 3, encodingId: 1, languageId: 0x0409, nameId: 2, text: "Regular", utf16: true },
        { platformId: 3, encodingId: 1, languageId: 0x0409, nameId: 17, text: "Light Condensed", utf16: true },
      ],
    });
    const result = parseFontMetadata(buf);
    assert.ok(result.ok);
    assert.equal(result.subfamily?.value, "Light Condensed");
  });

  it("falls back to ID 1/2 when ID 16/17 are absent", () => {
    const buf = buildSfnt({
      nameEntries: [
        { platformId: 3, encodingId: 1, languageId: 0x0409, nameId: 1, text: "FallbackFamily", utf16: true },
        { platformId: 3, encodingId: 1, languageId: 0x0409, nameId: 2, text: "Bold Italic", utf16: true },
      ],
    });
    const result = parseFontMetadata(buf);
    assert.ok(result.ok);
    assert.equal(result.family?.value, "FallbackFamily");
    assert.equal(result.subfamily?.value, "Bold Italic");
  });

  // ── OS/2 table ─────────────────────────────────────────────────────────

  it("reads usWeightClass from OS/2 table", () => {
    const buf = buildSfnt({
      nameEntries: [],
      os2Weight: 700,
      os2FsSelection: 0x0000,
    });
    const result = parseFontMetadata(buf);
    assert.ok(result.ok);
    assert.equal(result.weightClass?.value, 700);
    assert.equal(result.weightClass?.source, "os2_table");
    assert.equal(result.isItalic?.value, false);
    assert.equal(result.isItalic?.source, "os2_table");
  });

  it("sets isItalic from OS/2 fsSelection bit 0", () => {
    const buf = buildSfnt({
      nameEntries: [],
      os2Weight: 400,
      os2FsSelection: 0x0001, // bit 0 = italic
    });
    const result = parseFontMetadata(buf);
    assert.ok(result.ok);
    assert.equal(result.isItalic?.value, true);
  });

  it("returns undefined weightClass and isItalic when OS/2 table is absent", () => {
    // Build a font with only a name table.
    const buf = buildSfnt({
      nameEntries: [
        { platformId: 3, encodingId: 1, languageId: 0x0409, nameId: 1, text: "NoOs2", utf16: true },
      ],
      // os2Weight and os2FsSelection omitted → no OS/2 table
    });
    const result = parseFontMetadata(buf);
    assert.ok(result.ok);
    assert.equal(result.weightClass, undefined);
    assert.equal(result.isItalic, undefined);
  });

  // ── post table ─────────────────────────────────────────────────────────

  it("reads italicAngle from post table (Fixed 16.16)", () => {
    // -12 degrees as 16.16: -12 * 65536 = -786432 = 0xFFF40000
    const italicAngleFP = -12 * 65536; // -786432
    const buf = buildSfnt({
      nameEntries: [],
      os2Weight: 400,
      os2FsSelection: 0,
      italicAngleFP,
    });
    const result = parseFontMetadata(buf);
    assert.ok(result.ok);
    assert.ok(result.italicAngle !== undefined);
    assert.equal(result.italicAngle?.source, "post_table");
    // Should be -12.0 (within float precision).
    assert.ok(
      Math.abs((result.italicAngle?.value ?? 0) - (-12)) < 0.001,
      `expected -12, got ${result.italicAngle?.value}`,
    );
  });

  // ── fvar table ─────────────────────────────────────────────────────────

  it("reports isVariable=true and extracts axes when fvar is present", () => {
    const buf = buildSfnt({
      nameEntries: [],
      os2Weight: 400,
      os2FsSelection: 0,
      fvarAxes: [
        { tag: "wght", min: 100 * 65536, def: 400 * 65536, max: 900 * 65536 },
        { tag: "ital", min: 0, def: 0, max: 1 * 65536 },
      ],
    });
    const result = parseFontMetadata(buf);
    assert.ok(result.ok);
    assert.equal(result.isVariable, true);
    assert.equal(result.variableAxes.length, 2);
    assert.equal(result.variableAxes[0]?.tag, "wght");
    assert.equal(result.variableAxes[0]?.minValue, 100);
    assert.equal(result.variableAxes[0]?.defaultValue, 400);
    assert.equal(result.variableAxes[0]?.maxValue, 900);
    assert.equal(result.variableAxes[1]?.tag, "ital");
  });

  it("reports isVariable=false and empty axes when fvar is absent", () => {
    const buf = buildSfnt({
      nameEntries: [
        { platformId: 3, encodingId: 1, languageId: 0x0409, nameId: 1, text: "Static", utf16: true },
      ],
    });
    const result = parseFontMetadata(buf);
    assert.ok(result.ok);
    assert.equal(result.isVariable, false);
    assert.deepEqual(result.variableAxes, []);
  });

  // ── Resilience: truncated / malformed ─────────────────────────────────

  it("does not throw on a completely truncated buffer (< 4 bytes)", () => {
    const buf = new ArrayBuffer(3);
    let result: ReturnType<typeof parseFontMetadata> | undefined;
    assert.doesNotThrow(() => {
      result = parseFontMetadata(buf);
    });
    assert.ok(result !== undefined);
    assert.equal(result.ok, false);
  });

  it("does not throw on a buffer that is exactly 12 bytes (truncated directory)", () => {
    // Write a valid TrueType magic + numTables=5 but no actual directory entries.
    const buf = new ArrayBuffer(12);
    const view = new DataView(buf);
    writeU32(view, 0, 0x00010000);
    writeU16(view, 4, 5); // claims 5 tables but there's no room
    let result: ReturnType<typeof parseFontMetadata> | undefined;
    assert.doesNotThrow(() => {
      result = parseFontMetadata(buf);
    });
    // May be ok:true (with no tables) or ok:false — either is acceptable,
    // but it must not throw and must not read past the buffer.
    assert.ok(result !== undefined);
  });

  it("does not throw and skips the name table when its offset is out of bounds", () => {
    const buf = buildSfnt({
      nameEntries: [
        { platformId: 3, encodingId: 1, languageId: 0x0409, nameId: 1, text: "Ghost", utf16: true },
      ],
      badTableOffset: true,
    });
    let result: ReturnType<typeof parseFontMetadata> | undefined;
    assert.doesNotThrow(() => {
      result = parseFontMetadata(buf);
    });
    assert.ok(result !== undefined);
    if (result.ok) {
      // family should be absent because the offset was out of bounds.
      assert.equal(result.family, undefined);
    }
    // ok:false is also acceptable — what's not acceptable is a throw or OOB read.
  });

  it("does not throw on a buffer containing only zeroes", () => {
    const buf = new ArrayBuffer(512);
    assert.doesNotThrow(() => parseFontMetadata(buf));
  });

  // ── parseTableDirectory ────────────────────────────────────────────────

  it("parseTableDirectory returns entries for a plain sfnt", () => {
    const buf = buildSfnt({
      nameEntries: [
        { platformId: 3, encodingId: 1, languageId: 0x0409, nameId: 1, text: "Dir", utf16: true },
      ],
      os2Weight: 400,
      os2FsSelection: 0,
    });
    const dir = parseTableDirectory(buf);
    assert.ok(dir !== null);
    assert.equal(dir.sfntTag, "truetype");
    assert.ok(dir.entries.length >= 1);
    assert.ok(dir.entries.some((e) => e.tag === "name"));
  });

  it("parseTableDirectory returns empty entries for wOF2", () => {
    const buf = new ArrayBuffer(16);
    const view = new DataView(buf);
    writeAscii(view, 0, "wOF2");
    const dir = parseTableDirectory(buf);
    assert.ok(dir !== null);
    assert.equal(dir.sfntTag, "wOF2");
    assert.equal(dir.numTables, 0);
    assert.deepEqual(dir.entries, []);
  });

  it("parseTableDirectory returns empty entries for ttcf", () => {
    const buf = new ArrayBuffer(16);
    const view = new DataView(buf);
    writeAscii(view, 0, "ttcf");
    const dir = parseTableDirectory(buf);
    assert.ok(dir !== null);
    assert.equal(dir.sfntTag, "ttcf");
    assert.deepEqual(dir.entries, []);
  });

  it("parseTableDirectory returns null for unrecognised magic", () => {
    const buf = magicBuf([0xde, 0xad, 0xbe, 0xef]);
    const dir = parseTableDirectory(buf);
    assert.equal(dir, null);
  });

  // ── mergeWithFilenameGuess ─────────────────────────────────────────────

  it("binary wins over filename for every field it supplies", () => {
    const buf = buildSfnt({
      nameEntries: [
        { platformId: 3, encodingId: 1, languageId: 0x0409, nameId: 1, text: "BinaryFamily", utf16: true },
        { platformId: 3, encodingId: 1, languageId: 0x0409, nameId: 2, text: "Bold", utf16: true },
      ],
      os2Weight: 700,
      os2FsSelection: 0,
    });
    const parsed = parseFontMetadata(buf);
    assert.ok(parsed.ok);

    const merged = mergeWithFilenameGuess(parsed as ParsedFontMetadata, {
      family: "FilenameFamily",
      subfamily: "FilenameSubfamily",
      weightClass: 400,
      isItalic: true,
    });

    assert.equal(merged.family?.value, "BinaryFamily");
    assert.equal(merged.family?.source, "name_table");
    assert.equal(merged.subfamily?.value, "Bold");
    assert.equal(merged.subfamily?.source, "name_table");
    assert.equal(merged.weightClass?.value, 700);
    assert.equal(merged.weightClass?.source, "os2_table");
    assert.equal(merged.isItalic?.value, false);
    assert.equal(merged.isItalic?.source, "os2_table");
  });

  it("filename fills gaps where binary has no value", () => {
    // Build a font with no OS/2 table (no weightClass / isItalic).
    const buf = buildSfnt({
      nameEntries: [
        { platformId: 3, encodingId: 1, languageId: 0x0409, nameId: 1, text: "PartialFont", utf16: true },
      ],
      // no os2Weight → OS/2 table absent
    });
    const parsed = parseFontMetadata(buf);
    assert.ok(parsed.ok);

    const merged = mergeWithFilenameGuess(parsed as ParsedFontMetadata, {
      family: "GuessFam", // should lose to binary's name_table
      weightClass: 300,
      isItalic: false,
    });

    // family: binary wins
    assert.equal(merged.family?.value, "PartialFont");
    assert.equal(merged.family?.source, "name_table");
    // weightClass: binary absent → filename fills gap
    assert.equal(merged.weightClass?.value, 300);
    assert.equal(merged.weightClass?.source, "filename");
    // isItalic: binary absent → filename fills gap
    assert.equal(merged.isItalic?.value, false);
    assert.equal(merged.isItalic?.source, "filename");
  });

  it("mergeWithFilenameGuess: null/undefined filename values are not promoted", () => {
    const buf = buildSfnt({ nameEntries: [] });
    const parsed = parseFontMetadata(buf);
    assert.ok(parsed.ok);

    const merged = mergeWithFilenameGuess(parsed as ParsedFontMetadata, {
      family: null,
      weightClass: undefined,
    });

    assert.equal(merged.family, undefined);
    assert.equal(merged.weightClass, undefined);
  });
});
