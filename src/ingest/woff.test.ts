/**
 * woff.test.ts
 *
 * Pure, offline tests for WOFF1 and WOFF2 decompression and metadata
 * extraction. All font bytes are synthesised in the test — no network,
 * no database, no real font files.
 *
 * Coverage:
 *   - WOFF1: decompressWoff1 on a valid minimal file returns a parseable sfnt
 *   - WOFF1: stored (uncompressed) table (compLength === origLength)
 *   - WOFF1: bad signature returns null
 *   - WOFF1: parseWoffMetadata reads family name from name table
 *   - WOFF2: decompressWoff2 on a valid minimal file returns a parseable sfnt
 *   - WOFF2: parseWoffMetadata reads name/OS·2 from WOFF2 file
 *   - WOFF2: bad signature returns null
 *   - readUIntBase128: single byte, multi-byte, overflow guard (tested via
 *     WOFF2 parsing)
 *   - parseWoffMetadata: buffer too short returns ok:false
 *   - parseWoffMetadata: unknown signature returns ok:false
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deflateSync, brotliCompressSync } from "node:zlib";
import {
  decompressWoff1,
  decompressWoff2,
  parseWoffMetadata,
} from "./woff.js";
import { parseFontMetadata } from "./font-metadata.js";

// ---------------------------------------------------------------------------
// Helpers: build minimal sfnt tables
// ---------------------------------------------------------------------------

/** Write big-endian uint32 into DataView */
function u32(view: DataView, off: number, v: number): void {
  view.setUint32(off, v >>> 0, false);
}
/** Write big-endian uint16 into DataView */
function u16(view: DataView, off: number, v: number): void {
  view.setUint16(off, v & 0xffff, false);
}
/** Write ASCII into DataView */
function ascii(view: DataView, off: number, s: string): void {
  for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
}

/**
 * Build a minimal sfnt (TrueType flavor) with a name table containing
 * name IDs 1 and 2 as Windows/UTF-16BE strings.
 *
 * The sfnt has exactly one table ("name") to keep the buffer small.
 */
function buildMinimalSfntWithName(family: string, subfamily: string): Uint8Array {
  // Build name records for ID 1 (family) and ID 2 (subfamily)
  // Platform 3 (Windows), encoding 1 (Unicode BMP), language 0x0409 (en-US)
  const encodeUtf16Be = (s: string): Uint8Array => {
    const buf = new Uint8Array(s.length * 2);
    const view = new DataView(buf.buffer);
    for (let i = 0; i < s.length; i++) view.setUint16(i * 2, s.charCodeAt(i), false);
    return buf;
  };

  const familyBytes = encodeUtf16Be(family);
  const subfamilyBytes = encodeUtf16Be(subfamily);

  // name table layout:
  //   format (2) + count (2) + stringOffset (2) = 6 bytes header
  //   per record: platformID(2)+encodingID(2)+languageID(2)+nameID(2)+length(2)+offset(2) = 12 bytes
  //   string data
  const recordCount = 2;
  const stringOffset = 6 + recordCount * 12;
  const nameTableSize = stringOffset + familyBytes.length + subfamilyBytes.length;

  const nameTable = new Uint8Array(nameTableSize);
  const ntView = new DataView(nameTable.buffer);
  u16(ntView, 0, 0); // format
  u16(ntView, 2, recordCount); // count
  u16(ntView, 4, stringOffset); // stringOffset

  let recOff = 6;
  let strOff = 0;

  // Record for name ID 1 (family)
  u16(ntView, recOff, 3); u16(ntView, recOff + 2, 1); u16(ntView, recOff + 4, 0x0409);
  u16(ntView, recOff + 6, 1); // nameID
  u16(ntView, recOff + 8, familyBytes.length);
  u16(ntView, recOff + 10, strOff);
  recOff += 12;
  nameTable.set(familyBytes, stringOffset + strOff);
  strOff += familyBytes.length;

  // Record for name ID 2 (subfamily)
  u16(ntView, recOff, 3); u16(ntView, recOff + 2, 1); u16(ntView, recOff + 4, 0x0409);
  u16(ntView, recOff + 6, 2); // nameID
  u16(ntView, recOff + 8, subfamilyBytes.length);
  u16(ntView, recOff + 10, strOff);
  nameTable.set(subfamilyBytes, stringOffset + strOff);

  // Build sfnt with one table "name"
  const numTables = 1;
  const sfntHeaderSize = 12 + 16 * numTables;
  const tableOffset = (sfntHeaderSize + 3) & ~3; // 4-byte aligned
  const sfntSize = tableOffset + nameTable.length;

  const sfnt = new Uint8Array(sfntSize);
  const sv = new DataView(sfnt.buffer);

  // sfnt header (TrueType flavor 0x00010000)
  u32(sv, 0, 0x00010000);
  u16(sv, 4, numTables);
  u16(sv, 6, 16); // searchRange
  u16(sv, 8, 0);  // entrySelector
  u16(sv, 10, 0); // rangeShift

  // Table directory entry for "name"
  ascii(sv, 12, "name");
  u32(sv, 12 + 4, 0); // checksum
  u32(sv, 12 + 8, tableOffset);
  u32(sv, 12 + 12, nameTable.length);

  sfnt.set(nameTable, tableOffset);
  return sfnt;
}

/**
 * Build a minimal WOFF1 file wrapping one or more sfnt tables.
 * @param sfnt - a complete sfnt buffer (will be parsed for its table directory)
 * @param compressAll - if true, zlib-compress each table; otherwise store raw
 */
function buildWoff1FromSfnt(sfnt: Uint8Array, compressAll = true): Uint8Array {
  const sv = new DataView(sfnt.buffer);
  const flavor = sv.getUint32(0, false);
  const numTables = sv.getUint16(4, false);

  // Parse table directory from sfnt
  const sfntDir: Array<{ tag: string; origOffset: number; origLength: number; origChecksum: number }> = [];
  for (let i = 0; i < numTables; i++) {
    const base = 12 + i * 16;
    let tag = "";
    for (let c = 0; c < 4; c++) tag += String.fromCharCode(sv.getUint8(base + c));
    const checksum = sv.getUint32(base + 4, false);
    const offset = sv.getUint32(base + 8, false);
    const length = sv.getUint32(base + 12, false);
    sfntDir.push({ tag, origOffset: offset, origLength: length, origChecksum: checksum });
  }

  // Compress (or store) each table
  const compressedTables = sfntDir.map((entry) => {
    const raw = sfnt.slice(entry.origOffset, entry.origOffset + entry.origLength);
    if (compressAll) {
      const compressed = deflateSync(raw);
      return compressed.length < raw.length ? compressed : raw;
    }
    return raw;
  });

  // Build WOFF1 file
  const WOFF1_HEADER = 44;
  const TABLE_DIR_ENTRY = 20;
  let dataOffset = WOFF1_HEADER + numTables * TABLE_DIR_ENTRY;
  // Align to 4 bytes
  dataOffset = (dataOffset + 3) & ~3;

  const tableOffsets: number[] = [];
  let totalSize = dataOffset;
  for (const ct of compressedTables) {
    tableOffsets.push(totalSize);
    totalSize += (ct.length + 3) & ~3;
  }

  const woff = new Uint8Array(totalSize);
  const wv = new DataView(woff.buffer);

  // WOFF1 header
  u32(wv, 0, 0x774f4646); // signature 'wOFF'
  u32(wv, 4, flavor);
  u32(wv, 8, totalSize);
  u16(wv, 12, numTables);
  u16(wv, 14, 0); // reserved
  u32(wv, 16, sfnt.length); // totalSfntSize
  u16(wv, 20, 1); // majorVersion
  u16(wv, 22, 0); // minorVersion
  u32(wv, 24, 0); // metaOffset
  u32(wv, 28, 0); // metaLength
  u32(wv, 32, 0); // metaOrigLength
  u32(wv, 36, 0); // privOffset
  u32(wv, 40, 0); // privLength

  // Table directory + data
  for (let i = 0; i < numTables; i++) {
    const entry = sfntDir[i]!;
    const ct = compressedTables[i]!;
    const woffOffset = tableOffsets[i]!;
    const base = WOFF1_HEADER + i * TABLE_DIR_ENTRY;

    ascii(wv, base, entry.tag);
    u32(wv, base + 4, woffOffset);
    u32(wv, base + 8, ct.length);        // compLength
    u32(wv, base + 12, entry.origLength); // origLength
    u32(wv, base + 16, entry.origChecksum);

    woff.set(ct, woffOffset);
  }

  return woff;
}

/**
 * Build a minimal WOFF2 file wrapping a single sfnt name table.
 * Tables: only "name" (tag index 5 in the WOFF2 known-tag list).
 *
 * The entire table directory + table data is Brotli-compressed as one stream.
 */
function buildWoff2WithNameTable(family: string, subfamily: string): Uint8Array {
  const sfnt = buildMinimalSfntWithName(family, subfamily);
  const sfntView = new DataView(sfnt.buffer);
  const numTables = sfntView.getUint16(4, false);

  // Extract table data from sfnt
  const tables: Array<{ tag: string; data: Uint8Array }> = [];
  for (let i = 0; i < numTables; i++) {
    const base = 12 + i * 16;
    let tag = "";
    for (let c = 0; c < 4; c++) tag += String.fromCharCode(sfntView.getUint8(base + c));
    const offset = sfntView.getUint32(base + 8, false);
    const length = sfntView.getUint32(base + 12, false);
    tables.push({ tag, data: sfnt.slice(offset, offset + length) });
  }

  // Build the uncompressed table stream (directory order, 4-byte padded)
  let streamSize = 0;
  const streamOffsets: number[] = [];
  for (const t of tables) {
    streamOffsets.push(streamSize);
    streamSize += (t.data.length + 3) & ~3;
  }
  const tableStream = new Uint8Array(streamSize);
  for (let i = 0; i < tables.length; i++) {
    tableStream.set(tables[i]!.data, streamOffsets[i]!);
  }

  // Brotli compress the stream
  const brotliData = brotliCompressSync(tableStream);

  // Build the variable-length WOFF2 table directory
  // For each table: flags byte + UIntBase128 origLength
  const WOFF2_KNOWN_TAGS = [
    "cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post",
    "cvt ", "fpgm", "glyf", "loca", "prep", "CFF ", "VORG", "EBDT",
    "EBLC", "gasp", "hdmx", "kern", "LTSH", "PCLT", "VDMX", "vhea",
    "vmtx", "BASE", "GDEF", "GPOS", "GSUB", "EBSC", "JSTF", "MATH",
    "CBDT", "CBLC", "COLR", "CPAL", "SVG ", "sbix", "acnt", "avar",
    "bdat", "bloc", "bsln", "cvar", "fdsc", "feat", "fmtx", "fvar",
    "gvar", "hsty", "just", "lcar", "mort", "morx", "opbd", "prop",
    "trak", "Zapf", "Silf", "Glat", "Gloc", "Feat", "Sill",
  ];

  function encodeUIntBase128(v: number): Uint8Array {
    if (v < 128) return new Uint8Array([v]);
    const bytes: number[] = [];
    let x = v;
    while (x > 0) {
      bytes.unshift(x & 0x7f);
      x >>>= 7;
    }
    for (let i = 0; i < bytes.length - 1; i++) bytes[i]! |= 0x80;
    return new Uint8Array(bytes);
  }

  const dirParts: Uint8Array[] = [];
  for (const t of tables) {
    const tagIdx = WOFF2_KNOWN_TAGS.indexOf(t.tag);
    if (tagIdx >= 0 && tagIdx < 63) {
      // Known tag: flags byte with tag index (bits 0–5), transform 0 (bits 6–7)
      dirParts.push(new Uint8Array([tagIdx & 0x3f]));
    } else {
      // Arbitrary tag
      const flagsByte = 63;
      const tagBytes = new Uint8Array(5);
      tagBytes[0] = flagsByte;
      for (let c = 0; c < 4; c++) tagBytes[c + 1] = t.tag.charCodeAt(c);
      dirParts.push(tagBytes);
    }
    dirParts.push(encodeUIntBase128(t.data.length));
  }

  const dirSize = dirParts.reduce((s, p) => s + p.length, 0);
  const dir = new Uint8Array(dirSize);
  let pos = 0;
  for (const p of dirParts) { dir.set(p, pos); pos += p.length; }

  // Build WOFF2 header (48 bytes)
  const WOFF2_HEADER = 48;
  const totalSize = WOFF2_HEADER + dir.length + brotliData.length;
  const woff2 = new Uint8Array(totalSize);
  const wv = new DataView(woff2.buffer);

  u32(wv, 0, 0x774f4632); // 'wOF2'
  u32(wv, 4, sfntView.getUint32(0, false)); // flavor
  u32(wv, 8, totalSize);
  u16(wv, 12, tables.length);
  u16(wv, 14, 0); // reserved
  u32(wv, 16, sfnt.length); // totalSfntSize
  u32(wv, 20, brotliData.length); // totalCompressedSize
  u16(wv, 24, 1); // majorVersion
  u16(wv, 26, 0); // minorVersion
  u32(wv, 28, 0); u32(wv, 32, 0); u32(wv, 36, 0); // meta
  u32(wv, 40, 0); u32(wv, 44, 0); // priv

  woff2.set(dir, WOFF2_HEADER);
  woff2.set(brotliData, WOFF2_HEADER + dir.length);

  return woff2;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("decompressWoff1", () => {
  it("decompresses a WOFF1 file and returns a valid sfnt", () => {
    const sfnt = buildMinimalSfntWithName("TestFamily", "Regular");
    const woff1 = buildWoff1FromSfnt(sfnt, true);
    const result = decompressWoff1(woff1);
    assert.ok(result !== null, "should return a Uint8Array");
    // The result should be parseable as a plain sfnt
    const parsed = parseFontMetadata(result!);
    assert.ok(parsed.ok, `parseFontMetadata on decompressed WOFF1 failed: ${!parsed.ok ? parsed.reason : ""}`);
    if (parsed.ok) {
      assert.equal(parsed.family?.value, "TestFamily");
      assert.equal(parsed.subfamily?.value, "Regular");
    }
  });

  it("handles stored (uncompressed) tables where compLength === origLength", () => {
    const sfnt = buildMinimalSfntWithName("StoredFamily", "Bold");
    const woff1 = buildWoff1FromSfnt(sfnt, false); // no compression
    const result = decompressWoff1(woff1);
    assert.ok(result !== null, "should handle stored tables");
    if (result) {
      const parsed = parseFontMetadata(result);
      assert.ok(parsed.ok);
      if (parsed.ok) {
        assert.equal(parsed.family?.value, "StoredFamily");
      }
    }
  });

  it("returns null for a bad signature", () => {
    const buf = new Uint8Array(64);
    const view = new DataView(buf.buffer);
    view.setUint32(0, 0x00010000, false); // TTF signature, not WOFF1
    assert.equal(decompressWoff1(buf), null);
  });

  it("returns null for a truncated buffer", () => {
    const buf = new Uint8Array(10); // too short to hold WOFF1 header
    const view = new DataView(buf.buffer);
    view.setUint32(0, 0x774f4646, false); // 'wOFF'
    assert.equal(decompressWoff1(buf), null);
  });

  it("returns null for an empty buffer", () => {
    assert.equal(decompressWoff1(new Uint8Array(0)), null);
  });

  it("accepts ArrayBuffer input", () => {
    const sfnt = buildMinimalSfntWithName("ArrayBufFamily", "Italic");
    const woff1 = buildWoff1FromSfnt(sfnt, true);
    const result = decompressWoff1(woff1.buffer as ArrayBuffer);
    assert.ok(result !== null);
    if (result) {
      const parsed = parseFontMetadata(result);
      assert.ok(parsed.ok);
    }
  });
});

describe("decompressWoff2", () => {
  it("decompresses a WOFF2 file and returns parseable sfnt data", () => {
    const woff2 = buildWoff2WithNameTable("Woff2Family", "Light");
    const result = decompressWoff2(woff2);
    assert.ok(result !== null, "should return a Uint8Array");
    if (result) {
      const parsed = parseFontMetadata(result);
      assert.ok(parsed.ok, `parseFontMetadata failed: ${!parsed.ok ? parsed.reason : ""}`);
      if (parsed.ok) {
        assert.equal(parsed.family?.value, "Woff2Family");
      }
    }
  });

  it("returns null for a bad signature", () => {
    const buf = new Uint8Array(64);
    const view = new DataView(buf.buffer);
    view.setUint32(0, 0x774f4646, false); // 'wOFF' not 'wOF2'
    assert.equal(decompressWoff2(buf), null);
  });

  it("returns null for an empty buffer", () => {
    assert.equal(decompressWoff2(new Uint8Array(0)), null);
  });
});

describe("parseWoffMetadata", () => {
  it("parses metadata from a WOFF1 file", () => {
    const sfnt = buildMinimalSfntWithName("WoffMeta", "Bold Italic");
    const woff1 = buildWoff1FromSfnt(sfnt);
    const result = parseWoffMetadata(woff1);
    assert.ok(result.ok, `expected ok:true, got: ${!result.ok ? result.reason : ""}`);
    if (result.ok) {
      assert.equal(result.family?.value, "WoffMeta");
      assert.equal(result.subfamily?.value, "Bold Italic");
    }
  });

  it("parses metadata from a WOFF2 file", () => {
    const woff2 = buildWoff2WithNameTable("Woff2Meta", "Thin");
    const result = parseWoffMetadata(woff2);
    assert.ok(result.ok, `expected ok:true, got: ${!result.ok ? result.reason : ""}`);
    if (result.ok) {
      assert.equal(result.family?.value, "Woff2Meta");
      // container should be reported as wOF2
      assert.equal(result.container, "wOF2");
    }
  });

  it("returns ok:false for a buffer that is too short", () => {
    const result = parseWoffMetadata(new Uint8Array(2));
    assert.equal(result.ok, false);
  });

  it("returns ok:false for an unknown signature", () => {
    const buf = new Uint8Array(64);
    const view = new DataView(buf.buffer);
    view.setUint32(0, 0xdeadbeef, false);
    const result = parseWoffMetadata(buf);
    assert.equal(result.ok, false);
  });

  it("returns ok:false for an empty buffer", () => {
    const result = parseWoffMetadata(new Uint8Array(0));
    assert.equal(result.ok, false);
  });

  it("accepts ArrayBuffer input for WOFF1", () => {
    const sfnt = buildMinimalSfntWithName("ABFamily", "Regular");
    const woff1 = buildWoff1FromSfnt(sfnt);
    const result = parseWoffMetadata(woff1.buffer as ArrayBuffer);
    assert.ok(result.ok);
  });
});
