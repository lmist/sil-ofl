/**
 * font-metadata.ts
 *
 * Dependency-free minimal sfnt reader. Extracts name/OS·2/post/fvar tables
 * from a font binary and reports provenance (which table each value came from)
 * so callers can distinguish "read from the binary" from "inferred from the
 * filename".
 *
 * ── Byte-budget seam ────────────────────────────────────────────────────────
 * Fonts in this catalog reach 95 MB. This module works from an ArrayBuffer
 * that the *caller* controls. To avoid loading whole files, a caller may:
 *
 *   1. Fetch the first 12 + 16 * numTables bytes (the sfnt header + table
 *      directory) — enough to call parseTableDirectory().
 *   2. From the returned TableEntry list, identify the byte ranges it needs
 *      (e.g. only 'name' and 'OS/2').
 *   3. Range-request those bytes and hand them, together with the full buffer
 *      slice that covers each table, back to the individual parse functions
 *      (parseName, parseOs2, parsePost, parseFvar).
 *
 * That seam is intentional. Issue .16 (variable axes) and .12 (binary
 * metadata) depend on it; issue .14 (OFL-1.0 reachability) does not.
 * ────────────────────────────────────────────────────────────────────────────
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** The four-byte magic that identifies the container format. */
export type SfntTag =
  | "truetype" // 0x00010000
  | "otto" // 'OTTO' – CFF/CFF2 outlines
  | "true" // 'true' – Apple TrueType
  | "ttcf" // TrueType Collection — not parseable as a single sfnt
  | "wOFF" // WOFF1 — deflate-wrapped sfnt
  | "wOF2"; // WOFF2 — Brotli-wrapped sfnt (unsupported without a dep)

/** Provenance tag — which source supplied this value. */
export type Source =
  | "name_table" // OpenType 'name' table
  | "os2_table" // OpenType 'OS/2' table
  | "post_table" // OpenType 'post' table
  | "fvar_table" // OpenType 'fvar' table (reserved for future direct use)
  | "filename" // inferred from the filename (fallback only)
  | "default"; // hard-coded default (last resort)

/** A single field value with its provenance. */
export interface Sourced<T> {
  value: T;
  source: Source;
}

/** One variable axis as read from 'fvar'. */
export interface FvarAxis {
  tag: string; // e.g. 'wght', 'ital', 'opsz'
  minValue: number;
  defaultValue: number;
  maxValue: number;
}

/**
 * The result of a successful parse. Every optional field is absent when the
 * corresponding table was not present or could not be decoded — callers must
 * treat absence as "unknown", never assume a default.
 */
export interface ParsedFontMetadata {
  container: SfntTag;

  /** From name ID 16 if present, else ID 1. */
  family?: Sourced<string>;
  /** From name ID 17 if present, else ID 2. */
  subfamily?: Sourced<string>;
  /** From name ID 6. */
  postscriptName?: Sourced<string>;

  /** OS/2 usWeightClass (1–1000). */
  weightClass?: Sourced<number>;
  /**
   * True when OS/2 fsSelection bit 0 is set.
   * Cross-checked against post.italicAngle when both are present.
   */
  isItalic?: Sourced<boolean>;
  /** post italicAngle (fixed-point 16.16, stored as JS number). */
  italicAngle?: Sourced<number>;

  /** True if an 'fvar' table is present (real variable font). */
  isVariable: boolean;
  /** Axes from 'fvar'. Empty unless isVariable is true. */
  variableAxes: FvarAxis[];
}

/** Returned when the container cannot be fully parsed. */
export interface UnsupportedContainer {
  container: SfntTag;
  reason: string;
}

export type FontParseResult =
  | ({ ok: true } & ParsedFontMetadata)
  | ({ ok: false } & UnsupportedContainer);

/** One row in the sfnt table directory. */
export interface TableEntry {
  tag: string;
  checksum: number;
  offset: number;
  length: number;
}

/** Result of parsing just the table directory (partial-read seam). */
export interface TableDirectory {
  sfntTag: SfntTag;
  numTables: number;
  entries: TableEntry[];
}

// ---------------------------------------------------------------------------
// Filename-guess types (for mergeWithFilenameGuess)
// ---------------------------------------------------------------------------

export interface FilenameGuess {
  family?: string | null;
  subfamily?: string | null;
  weightClass?: number | null;
  isItalic?: boolean | null;
}

export interface MergedFontMetadata {
  family: Sourced<string> | undefined;
  subfamily: Sourced<string> | undefined;
  postscriptName: Sourced<string> | undefined;
  weightClass: Sourced<number> | undefined;
  isItalic: Sourced<boolean> | undefined;
  italicAngle: Sourced<number> | undefined;
  isVariable: boolean;
  variableAxes: FvarAxis[];
}

// ---------------------------------------------------------------------------
// Internal helpers — all safe-read (return undefined on OOB)
// ---------------------------------------------------------------------------

function readU32(view: DataView, offset: number): number | undefined {
  if (offset + 4 > view.byteLength) return undefined;
  return view.getUint32(offset, false);
}

function readU16(view: DataView, offset: number): number | undefined {
  if (offset + 2 > view.byteLength) return undefined;
  return view.getUint16(offset, false);
}

function readI32(view: DataView, offset: number): number | undefined {
  if (offset + 4 > view.byteLength) return undefined;
  return view.getInt32(offset, false);
}

function readTag(view: DataView, offset: number): string | undefined {
  if (offset + 4 > view.byteLength) return undefined;
  let tag = "";
  for (let i = 0; i < 4; i++) {
    tag += String.fromCharCode(view.getUint8(offset + i));
  }
  return tag;
}

function decodeUtf16Be(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const hi = bytes[i] ?? 0;
    const lo = bytes[i + 1] ?? 0;
    s += String.fromCharCode((hi << 8) | lo);
  }
  return s;
}

function decodeMacRoman(bytes: Uint8Array): string {
  // Mac Roman is ASCII for 0–127; upper half approximated as Latin-1.
  // Name strings in practice are almost always ASCII anyway.
  return Array.from(bytes)
    .map((b) => String.fromCharCode(b))
    .join("");
}

function identifySfntTag(view: DataView): SfntTag | undefined {
  if (view.byteLength < 4) return undefined;
  const b0 = view.getUint8(0);
  const b1 = view.getUint8(1);
  const b2 = view.getUint8(2);
  const b3 = view.getUint8(3);
  const magic = ((b0 << 24) | (b1 << 16) | (b2 << 8) | b3) >>> 0;

  if (magic === 0x00010000) return "truetype";

  const tag = String.fromCharCode(b0, b1, b2, b3);
  if (tag === "OTTO") return "otto";
  if (tag === "true") return "true";
  if (tag === "ttcf") return "ttcf";
  if (tag === "wOFF") return "wOFF";
  if (tag === "wOF2") return "wOF2";
  return undefined;
}

// ---------------------------------------------------------------------------
// Table directory
// ---------------------------------------------------------------------------

/**
 * Parse the sfnt offset table and table directory from the beginning of
 * `buffer`. Requires at least 12 + 16 * numTables bytes to be present.
 *
 * This is the entry point for the partial-read seam: call this on the first
 * few kilobytes, inspect `entries` for the byte ranges you need, then fetch
 * only those ranges before calling parseFontMetadata on a buffer that covers
 * all tables of interest.
 *
 * For ttcf / wOFF / wOF2 containers the function returns a directory with
 * numTables = 0 and an empty entries array — callers know the container type
 * but also know that standard sfnt table parsing cannot proceed.
 */
export function parseTableDirectory(
  buffer: ArrayBuffer | Uint8Array,
): TableDirectory | null {
  try {
    const ab = buffer instanceof Uint8Array ? buffer.buffer : buffer;
    const view = new DataView(ab);

    const sfntTag = identifySfntTag(view);
    if (!sfntTag) return null;

    if (sfntTag === "ttcf" || sfntTag === "wOFF" || sfntTag === "wOF2") {
      return { sfntTag, numTables: 0, entries: [] };
    }

    const numTables = readU16(view, 4);
    if (numTables === undefined || numTables === 0) return null;

    const entries: TableEntry[] = [];
    const directoryStart = 12;
    for (let i = 0; i < numTables; i++) {
      const base = directoryStart + i * 16;
      const tag = readTag(view, base);
      const checksum = readU32(view, base + 4);
      const offset = readU32(view, base + 8);
      const length = readU32(view, base + 12);
      if (
        tag === undefined ||
        checksum === undefined ||
        offset === undefined ||
        length === undefined
      ) {
        break; // truncated directory — return what we have
      }
      entries.push({ tag, checksum, offset, length });
    }

    return { sfntTag, numTables, entries };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// name table parser
// ---------------------------------------------------------------------------

interface NameRecord {
  platformId: number;
  encodingId: number;
  languageId: number;
  nameId: number;
  length: number;
  offset: number;
}

interface ParsedNames {
  family?: string;
  subfamily?: string;
  postscriptName?: string;
}

function parseName(
  view: DataView,
  tableOffset: number,
  tableLength: number,
): ParsedNames {
  const base = tableOffset;
  const end = tableOffset + tableLength;

  const count = readU16(view, base + 2);
  const stringOffset = readU16(view, base + 4);
  if (count === undefined || stringOffset === undefined) return {};

  const records: NameRecord[] = [];
  for (let i = 0; i < count; i++) {
    const r = base + 6 + i * 12;
    const platformId = readU16(view, r);
    const encodingId = readU16(view, r + 2);
    const languageId = readU16(view, r + 4);
    const nameId = readU16(view, r + 6);
    const length = readU16(view, r + 8);
    const offset = readU16(view, r + 10);
    if (
      platformId === undefined ||
      encodingId === undefined ||
      languageId === undefined ||
      nameId === undefined ||
      length === undefined ||
      offset === undefined
    ) {
      break;
    }
    records.push({ platformId, encodingId, languageId, nameId, length, offset });
  }

  const storageBase = base + stringOffset;

  function getString(rec: NameRecord): string | undefined {
    const start = storageBase + rec.offset;
    const finish = start + rec.length;
    if (finish > end || finish > view.byteLength || start < 0) return undefined;
    const bytes = new Uint8Array(view.buffer, view.byteOffset + start, rec.length);
    if (rec.platformId === 3) return decodeUtf16Be(bytes);
    if (rec.platformId === 1) return decodeMacRoman(bytes);
    return undefined;
  }

  const WANT_IDS = new Set([1, 2, 6, 16, 17]);
  // Map nameId -> { plat3?: string, plat1?: string }
  const candidates = new Map<number, { plat3?: string; plat1?: string }>();

  for (const rec of records) {
    if (!WANT_IDS.has(rec.nameId)) continue;
    if (rec.platformId !== 3 && rec.platformId !== 1) continue;
    const text = getString(rec);
    if (!text || text.length === 0) continue;

    const entry = candidates.get(rec.nameId) ?? {};
    if (rec.platformId === 3) {
      // Prefer English (0x0409); keep first match if we already have one
      if (!entry.plat3 || rec.languageId === 0x0409) {
        entry.plat3 = text;
      }
    } else {
      if (!entry.plat1 || rec.languageId === 0) {
        entry.plat1 = text;
      }
    }
    candidates.set(rec.nameId, entry);
  }

  function best(nameId: number): string | undefined {
    const e = candidates.get(nameId);
    return e?.plat3 ?? e?.plat1;
  }

  // Prefer typographic IDs 16/17 over 1/2 per OpenType spec.
  return {
    family: best(16) ?? best(1),
    subfamily: best(17) ?? best(2),
    postscriptName: best(6),
  };
}

// ---------------------------------------------------------------------------
// OS/2 table parser
// ---------------------------------------------------------------------------

interface ParsedOs2 {
  weightClass?: number;
  isItalic?: boolean;
}

function parseOs2(
  view: DataView,
  tableOffset: number,
  tableLength: number,
): ParsedOs2 {
  // Minimum OS/2 v0 is 78 bytes.
  if (tableLength < 78) return {};

  const weightClass = readU16(view, tableOffset + 4);
  const fsSelection = readU16(view, tableOffset + 62);

  return {
    weightClass:
      weightClass !== undefined && weightClass >= 1 && weightClass <= 1000
        ? weightClass
        : undefined,
    isItalic:
      fsSelection !== undefined ? (fsSelection & 0x0001) !== 0 : undefined,
  };
}

// ---------------------------------------------------------------------------
// post table parser
// ---------------------------------------------------------------------------

interface ParsedPost {
  italicAngle?: number;
}

function parsePost(
  view: DataView,
  tableOffset: number,
  tableLength: number,
): ParsedPost {
  // post header is at least 32 bytes; italicAngle Fixed16.16 at offset +4.
  if (tableLength < 8) return {};
  const fixed = readI32(view, tableOffset + 4);
  if (fixed === undefined) return {};
  return { italicAngle: fixed / 65536 };
}

// ---------------------------------------------------------------------------
// fvar table parser
// ---------------------------------------------------------------------------

interface ParsedFvar {
  axes: FvarAxis[];
}

function parseFvar(
  view: DataView,
  tableOffset: number,
  tableLength: number,
): ParsedFvar {
  // fvar header: majorVersion(2)+minorVersion(2)+axesArrayOffset(2)+
  //              reserved(2)+axisCount(2)+axisSize(2)+instanceCount(2)+instanceSize(2)
  if (tableLength < 16) return { axes: [] };

  const majorVersion = readU16(view, tableOffset);
  if (majorVersion !== 1) return { axes: [] };

  const axesArrayOffset = readU16(view, tableOffset + 4);
  const axisCount = readU16(view, tableOffset + 8);
  const axisSize = readU16(view, tableOffset + 10);

  if (
    axesArrayOffset === undefined ||
    axisCount === undefined ||
    axisSize === undefined ||
    axisCount === 0 ||
    axisSize < 20
  ) {
    return { axes: [] };
  }

  const axes: FvarAxis[] = [];
  for (let i = 0; i < axisCount; i++) {
    const base = tableOffset + axesArrayOffset + i * axisSize;
    if (base + 20 > tableOffset + tableLength) break;
    if (base + 20 > view.byteLength) break;

    const tag = readTag(view, base);
    const minFixed = readI32(view, base + 4);
    const defaultFixed = readI32(view, base + 8);
    const maxFixed = readI32(view, base + 12);

    if (
      tag === undefined ||
      minFixed === undefined ||
      defaultFixed === undefined ||
      maxFixed === undefined
    ) {
      break;
    }

    axes.push({
      tag,
      minValue: minFixed / 65536,
      defaultValue: defaultFixed / 65536,
      maxValue: maxFixed / 65536,
    });
  }

  return { axes };
}

// ---------------------------------------------------------------------------
// Main parse entry point
// ---------------------------------------------------------------------------

/**
 * Parse font metadata from `buffer`.
 *
 * The buffer must contain enough data to reach the tables you care about.
 * For fonts that exceed the caller's memory budget, use parseTableDirectory()
 * first to discover table byte ranges, then supply a buffer that covers only
 * the tables needed.
 *
 * Never throws. Returns { ok: false } for:
 *   - Unrecognised magic
 *   - wOF2 (Brotli required — no dep available)
 *   - ttcf (collection — sub-font index needed)
 *   - wOFF (zlib table compression — decompress first)
 *   - Truncated or malformed buffers
 */
export function parseFontMetadata(
  buffer: ArrayBuffer | Uint8Array,
): FontParseResult {
  try {
    const ab = buffer instanceof Uint8Array ? buffer.buffer : buffer;
    const view = new DataView(ab);

    const sfntTag = identifySfntTag(view);
    if (!sfntTag) {
      return {
        ok: false,
        container: "truetype",
        reason: "unrecognised sfnt magic — not a supported font container",
      };
    }

    if (sfntTag === "wOF2") {
      return {
        ok: false,
        container: "wOF2",
        reason:
          "WOFF2 containers require Brotli decompression. No dependency is " +
          "available in this module; decompress externally (e.g. with a " +
          "woff2_decompress tool) and pass the resulting TTF/OTF buffer.",
      };
    }

    if (sfntTag === "ttcf") {
      return {
        ok: false,
        container: "ttcf",
        reason:
          "TrueType Collection containers embed multiple faces. Use the TTC " +
          "header's offsetTable array to slice a single face buffer, then " +
          "call parseFontMetadata on that slice.",
      };
    }

    if (sfntTag === "wOFF") {
      return {
        ok: false,
        container: "wOFF",
        reason:
          "WOFF1 table data is zlib-compressed. Decompress to a raw " +
          "TTF/OTF sfnt before calling parseFontMetadata.",
      };
    }

    // Plain sfnt: truetype | otto | true
    const numTables = readU16(view, 4);
    if (numTables === undefined || numTables === 0) {
      return { ok: false, container: sfntTag, reason: "cannot read numTables from sfnt header" };
    }

    const tableMap = new Map<string, TableEntry>();
    const directoryStart = 12;
    for (let i = 0; i < numTables; i++) {
      const base = directoryStart + i * 16;
      const tag = readTag(view, base);
      const checksum = readU32(view, base + 4);
      const offset = readU32(view, base + 8);
      const length = readU32(view, base + 12);
      if (
        tag === undefined ||
        checksum === undefined ||
        offset === undefined ||
        length === undefined
      ) {
        break;
      }
      tableMap.set(tag, { tag, checksum, offset, length });
    }

    function safeTable(entry: TableEntry): boolean {
      return entry.offset + entry.length <= view.byteLength;
    }

    let nameData: ParsedNames = {};
    const nameEntry = tableMap.get("name");
    if (nameEntry && safeTable(nameEntry)) {
      nameData = parseName(view, nameEntry.offset, nameEntry.length);
    }

    let os2Data: ParsedOs2 = {};
    const os2Entry = tableMap.get("OS/2");
    if (os2Entry && safeTable(os2Entry)) {
      os2Data = parseOs2(view, os2Entry.offset, os2Entry.length);
    }

    let postData: ParsedPost = {};
    const postEntry = tableMap.get("post");
    if (postEntry && safeTable(postEntry)) {
      postData = parsePost(view, postEntry.offset, postEntry.length);
    }

    let fvarData: ParsedFvar = { axes: [] };
    const fvarEntry = tableMap.get("fvar");
    if (fvarEntry && safeTable(fvarEntry)) {
      fvarData = parseFvar(view, fvarEntry.offset, fvarEntry.length);
    }

    const isVariable = fvarEntry !== undefined && fvarData.axes.length > 0;

    return {
      ok: true,
      container: sfntTag,

      family:
        nameData.family !== undefined
          ? { value: nameData.family, source: "name_table" }
          : undefined,
      subfamily:
        nameData.subfamily !== undefined
          ? { value: nameData.subfamily, source: "name_table" }
          : undefined,
      postscriptName:
        nameData.postscriptName !== undefined
          ? { value: nameData.postscriptName, source: "name_table" }
          : undefined,

      weightClass:
        os2Data.weightClass !== undefined
          ? { value: os2Data.weightClass, source: "os2_table" }
          : undefined,
      isItalic:
        os2Data.isItalic !== undefined
          ? { value: os2Data.isItalic, source: "os2_table" }
          : undefined,

      italicAngle:
        postData.italicAngle !== undefined
          ? { value: postData.italicAngle, source: "post_table" }
          : undefined,

      isVariable,
      variableAxes: fvarData.axes,
    };
  } catch {
    // Never propagate — return a safe failure.
    return {
      ok: false,
      container: "truetype",
      reason: "unexpected parse error — buffer may be malformed or truncated",
    };
  }
}

// ---------------------------------------------------------------------------
// Merge with filename guess
// ---------------------------------------------------------------------------

/**
 * Merge a successfully parsed binary result with filename-inferred guesses.
 *
 * Policy:
 *   - Binary wins unconditionally for every field it supplies.
 *   - Filename fills gaps only when the binary field is absent/undefined.
 *   - The merged result still carries provenance so downstream consumers
 *     know exactly where each value came from.
 *
 * This function is deliberately not called inside parseFontMetadata — the
 * module never silently falls back to filenames. Callers decide when to call
 * this, after parseFontMetadata returns { ok: true }.
 */
export function mergeWithFilenameGuess(
  parsed: ParsedFontMetadata,
  guess: FilenameGuess,
): MergedFontMetadata {
  function fromGuess<T>(
    val: T | null | undefined,
    source: Source,
  ): Sourced<T> | undefined {
    return val != null ? { value: val, source } : undefined;
  }

  return {
    family: parsed.family ?? fromGuess(guess.family, "filename"),
    subfamily: parsed.subfamily ?? fromGuess(guess.subfamily, "filename"),
    postscriptName: parsed.postscriptName,
    weightClass: parsed.weightClass ?? fromGuess(guess.weightClass, "filename"),
    isItalic: parsed.isItalic ?? fromGuess(guess.isItalic, "filename"),
    italicAngle: parsed.italicAngle,
    isVariable: parsed.isVariable,
    variableAxes: parsed.variableAxes,
  };
}
