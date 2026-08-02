/**
 * woff.ts
 *
 * WOFF1 and WOFF2 decompression for the sil-ofl ingest pipeline.
 *
 * Both formats are handled without any external dependency:
 *   - WOFF1: per-table zlib/deflate via node:zlib inflateSync
 *   - WOFF2: single Brotli stream via node:zlib brotliDecompressSync
 *
 * Verified under Bun 1.3.14: both inflateSync and brotliDecompressSync
 * are available in node:zlib as native built-ins. Confirmed with a
 * roundtrip smoke-test before committing to this approach.
 *
 * ── WOFF2 scope note ─────────────────────────────────────────────────────
 * The WOFF2 spec applies a custom transform to glyf and loca tables.
 * Reconstructing those is non-trivial. However, the tables we actually
 * need for metadata — name, OS/2, post, fvar — are stored untransformed.
 * We decompress the Brotli stream, walk the table directory, locate those
 * four tables by offset, and extract them into a minimal sfnt buffer that
 * parseFontMetadata can read. We do not reconstruct glyf/loca.
 *
 * Provenance:
 *   - Data read from the decompressed font → metadata_source = 'binary'
 *   - Data propagated from a sibling TTF/OTF → metadata_source = 'sibling'
 * ─────────────────────────────────────────────────────────────────────────
 */

import { inflateSync, brotliDecompressSync } from "node:zlib";

// ---------------------------------------------------------------------------
// Re-export result types so callers only need one import
// ---------------------------------------------------------------------------
export type { FontParseResult, ParsedFontMetadata } from "./font-metadata.js";
import { parseFontMetadata } from "./font-metadata.js";
import type { FontParseResult } from "./font-metadata.js";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function readU32(view: DataView, offset: number): number | undefined {
  if (offset + 4 > view.byteLength) return undefined;
  return view.getUint32(offset, false);
}

function readU16(view: DataView, offset: number): number | undefined {
  if (offset + 2 > view.byteLength) return undefined;
  return view.getUint16(offset, false);
}

function writeU32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value >>> 0, false);
}

function writeU16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value & 0xffff, false);
}

// ---------------------------------------------------------------------------
// WOFF1 decompression
// ---------------------------------------------------------------------------

/**
 * WOFF1 table directory entry (from the file, before decompression).
 */
interface Woff1TableEntry {
  tag: string;
  offset: number;    // offset into WOFF file
  compLength: number;
  origLength: number;
  origChecksum: number;
}

/**
 * Parse a WOFF1 file and reassemble a plain sfnt/TTF buffer.
 *
 * WOFF1 header layout (44 bytes):
 *   0  signature   uint32  0x774F4646 'wOFF'
 *   4  flavor      uint32  sfnt version / 'OTTO'
 *   8  length      uint32  total WOFF file size
 *  12  numTables   uint16
 *  14  reserved    uint16  (must be 0)
 *  16  totalSfntSize uint32
 *  20  majorVersion uint16
 *  22  minorVersion uint16
 *  24  metaOffset  uint32
 *  28  metaLength  uint32
 *  32  metaOrigLength uint32
 *  36  privOffset  uint32
 *  40  privLength  uint32
 *
 * Table directory (20 bytes per entry):
 *   0  tag         uint32
 *   4  offset      uint32  (into WOFF file)
 *   8  compLength  uint32
 *  12  origLength  uint32
 *  16  origChecksum uint32
 *
 * Returns a Uint8Array containing a valid sfnt, or null on error.
 */
export function decompressWoff1(buffer: ArrayBuffer | Uint8Array): Uint8Array | null {
  try {
    const abSlice = buffer instanceof Uint8Array
      ? buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
      : buffer;
    // slice() always returns a fresh ArrayBuffer (not SharedArrayBuffer)
    const ab = abSlice as ArrayBuffer;
    const view = new DataView(ab);

    // Verify signature
    const sig = readU32(view, 0);
    if (sig !== 0x774f4646) return null; // 'wOFF'

    const flavor = readU32(view, 4);
    const numTables = readU16(view, 12);
    const totalSfntSize = readU32(view, 16);

    if (
      flavor === undefined ||
      numTables === undefined ||
      numTables === 0 ||
      totalSfntSize === undefined
    ) return null;

    // Parse table directory
    const WOFF1_HEADER = 44;
    const TABLE_DIR_ENTRY = 20;
    const entries: Woff1TableEntry[] = [];

    for (let i = 0; i < numTables; i++) {
      const base = WOFF1_HEADER + i * TABLE_DIR_ENTRY;
      if (base + TABLE_DIR_ENTRY > view.byteLength) return null;

      // Read tag as 4 chars
      let tag = "";
      for (let c = 0; c < 4; c++) {
        tag += String.fromCharCode(view.getUint8(base + c));
      }
      const offset = readU32(view, base + 4);
      const compLength = readU32(view, base + 8);
      const origLength = readU32(view, base + 12);
      const origChecksum = readU32(view, base + 16);

      if (
        offset === undefined ||
        compLength === undefined ||
        origLength === undefined ||
        origChecksum === undefined
      ) return null;

      entries.push({ tag, offset, compLength, origLength, origChecksum });
    }

    // Build sfnt output buffer.
    // sfnt offset table: 12 bytes
    // sfnt table directory: 16 bytes × numTables
    // table data: sum of origLengths, each padded to 4-byte boundary
    const sfntHeaderSize = 12 + 16 * numTables;

    // Calculate table offsets in output sfnt (4-byte aligned)
    let dataOffset = sfntHeaderSize;
    const outputOffsets: number[] = [];
    for (const entry of entries) {
      outputOffsets.push(dataOffset);
      // Pad to 4-byte boundary
      dataOffset += (entry.origLength + 3) & ~3;
    }

    const outputSize = dataOffset;
    const output = new Uint8Array(outputSize);
    const outView = new DataView(output.buffer);

    // Write sfnt offset table
    writeU32(outView, 0, flavor);
    writeU16(outView, 4, numTables);
    // Compute searchRange, entrySelector, rangeShift
    const maxPow2 = Math.floor(Math.log2(numTables));
    const searchRange = Math.pow(2, maxPow2) * 16;
    const entrySelector = maxPow2;
    const rangeShift = numTables * 16 - searchRange;
    writeU16(outView, 6, searchRange);
    writeU16(outView, 8, entrySelector);
    writeU16(outView, 10, rangeShift);

    // Write table directory entries and decompress table data
    const DIR_START = 12;
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]!;
      const outOffset = outputOffsets[i]!;
      const dirBase = DIR_START + i * 16;

      // Write tag
      for (let c = 0; c < 4; c++) {
        outView.setUint8(dirBase + c, entry.tag.charCodeAt(c));
      }
      writeU32(outView, dirBase + 4, entry.origChecksum);
      writeU32(outView, dirBase + 8, outOffset);
      writeU32(outView, dirBase + 12, entry.origLength);

      // Decompress or copy table data
      const tableData = new Uint8Array(ab, entry.offset, entry.compLength);
      let decompressed: Uint8Array;

      if (entry.compLength === entry.origLength) {
        // Stored raw (no compression)
        decompressed = tableData;
      } else {
        // zlib compressed
        decompressed = inflateSync(tableData);
        if (decompressed.byteLength !== entry.origLength) {
          // Decompressed size mismatch — corrupted or truncated
          return null;
        }
      }

      output.set(decompressed, outOffset);
    }

    return output;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// WOFF2 decompression
// ---------------------------------------------------------------------------

/**
 * Read a WOFF2 UIntBase128-encoded variable-length integer.
 * Returns { value, bytesRead } or null on overflow/error.
 *
 * UIntBase128 spec (WOFF2):
 *   - Each byte has 7 payload bits + 1 continuation bit (MSB)
 *   - Big-endian payload
 *   - Max value fits in uint32 (4 bytes of payload, but spec allows up to 5
 *     continuation bytes; we cap at 5 bytes and 32-bit max)
 *   - Leading 0x80 byte is invalid (no unnecessary padding)
 */
function readUIntBase128(
  view: DataView,
  offset: number,
): { value: number; bytesRead: number } | null {
  let accum = 0;
  for (let i = 0; i < 5; i++) {
    if (offset + i >= view.byteLength) return null;
    const b = view.getUint8(offset + i);
    // First byte must not be 0x80 (padding not allowed)
    if (i === 0 && b === 0x80) return null;
    // Shift and accumulate; check for 32-bit overflow
    if (accum > 0x0fffffff) return null; // would overflow on next shift
    accum = (accum << 7) | (b & 0x7f);
    if ((b & 0x80) === 0) {
      // Continuation bit clear — this is the last byte
      return { value: accum >>> 0, bytesRead: i + 1 };
    }
  }
  return null; // Too many continuation bytes
}

/**
 * WOFF2 known-tag table. Index 0–62 maps to these SFNT table tags.
 * From the WOFF2 spec, Table 3.
 */
const WOFF2_KNOWN_TAGS: readonly string[] = [
  "cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post",
  "cvt ", "fpgm", "glyf", "loca", "prep", "CFF ", "VORG", "EBDT",
  "EBLC", "gasp", "hdmx", "kern", "LTSH", "PCLT", "VDMX", "vhea",
  "vmtx", "BASE", "GDEF", "GPOS", "GSUB", "EBSC", "JSTF", "MATH",
  "CBDT", "CBLC", "COLR", "CPAL", "SVG ", "sbix", "acnt", "avar",
  "bdat", "bloc", "bsln", "cvar", "fdsc", "feat", "fmtx", "fvar",
  "gvar", "hsty", "just", "lcar", "mort", "morx", "opbd", "prop",
  "trak", "Zapf", "Silf", "Glat", "Gloc", "Feat", "Sill",
];

/**
 * Parse a WOFF2 file and reassemble the metadata tables (name, OS/2, post,
 * fvar) into a minimal sfnt buffer.
 *
 * We do NOT reconstruct glyf/loca (which use a WOFF2-specific transform).
 * name, OS/2, post, and fvar are stored untransformed per the spec, so
 * we can extract them directly from the decompressed Brotli stream.
 *
 * WOFF2 header layout (48 bytes):
 *   0  signature     uint32  0x774F4632 'wOF2'
 *   4  flavor        uint32  sfnt version
 *   8  length        uint32  total WOFF2 file size
 *  12  numTables     uint16
 *  14  reserved      uint16
 *  16  totalSfntSize uint32  (uncompressed sfnt size hint)
 *  20  totalCompressedSize uint32  (Brotli compressed stream size)
 *  24  majorVersion  uint16
 *  26  minorVersion  uint16
 *  28  metaOffset    uint32
 *  32  metaLength    uint32
 *  36  metaOrigLength uint32
 *  40  privOffset    uint32
 *  44  privLength    uint32
 *
 * Returns a Uint8Array containing a minimal sfnt (with only the metadata
 * tables), or null on error.
 */
export function decompressWoff2(buffer: ArrayBuffer | Uint8Array): Uint8Array | null {
  try {
    const abSlice = buffer instanceof Uint8Array
      ? buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
      : buffer;
    // slice() always returns a fresh ArrayBuffer (not SharedArrayBuffer)
    const ab = abSlice as ArrayBuffer;
    const view = new DataView(ab);

    // Verify signature
    const sig = readU32(view, 0);
    if (sig !== 0x774f4632) return null; // 'wOF2'

    const flavor = readU32(view, 4);
    const numTables = readU16(view, 12);
    const totalCompressedSize = readU32(view, 20);

    if (
      flavor === undefined ||
      numTables === undefined ||
      numTables === 0 ||
      totalCompressedSize === undefined
    ) return null;

    // Parse variable-length table directory (starts at byte 48)
    const WOFF2_HEADER = 48;
    let dirPos = WOFF2_HEADER;

    interface Woff2TableEntry {
      tag: string;
      transformVersion: number; // 0 = no transform, 3 = glyf/loca null-transform
      origLength: number;       // uncompressed size
    }

    const entries: Woff2TableEntry[] = [];
    for (let i = 0; i < numTables; i++) {
      if (dirPos >= view.byteLength) return null;

      const flags = view.getUint8(dirPos++);
      const tagIndex = flags & 0x3f;         // 6-bit table tag index
      const transformVersion = (flags >> 6) & 0x3; // 2-bit transform version

      let tag: string;
      if (tagIndex === 63) {
        // Arbitrary tag: next 4 bytes
        if (dirPos + 4 > view.byteLength) return null;
        tag = String.fromCharCode(
          view.getUint8(dirPos),
          view.getUint8(dirPos + 1),
          view.getUint8(dirPos + 2),
          view.getUint8(dirPos + 3),
        );
        dirPos += 4;
      } else {
        tag = WOFF2_KNOWN_TAGS[tagIndex] ?? `\x00\x00\x00${tagIndex}`;
      }

      // origLength: UIntBase128
      const origResult = readUIntBase128(view, dirPos);
      if (!origResult) return null;
      dirPos += origResult.bytesRead;

      // transformLength is present only when transformVersion != 0 AND
      // the tag is NOT glyf or loca (which use the WOFF2 glyph transform).
      // For glyf/loca: transformVersion=0 means "with glyph transform" (the
      // normal WOFF2 case); transformVersion=3 means "null transform" (stored
      // as-is). For other tables: transformVersion=0 means no transform;
      // transformVersion>0 means a transform length follows (currently unused
      // in spec v1.0 for non-glyph tables).
      //
      // For our purposes: we only care about name/OS·2/post/fvar. These are
      // always stored with transformVersion=0 (no transform). We skip the
      // transform-length field for any other case.
      let transformLength: number | undefined;
      const isGlyfOrLoca = tag === "glyf" || tag === "loca";
      if (!isGlyfOrLoca && transformVersion !== 0) {
        const tfResult = readUIntBase128(view, dirPos);
        if (!tfResult) return null;
        dirPos += tfResult.bytesRead;
        transformLength = tfResult.value;
      }
      if (isGlyfOrLoca && transformVersion === 3) {
        // Null transform: treat like any untransformed table
        // (transformLength field is present)
        const tfResult = readUIntBase128(view, dirPos);
        if (!tfResult) return null;
        dirPos += tfResult.bytesRead;
        transformLength = tfResult.value;
      }

      entries.push({
        tag,
        transformVersion: isGlyfOrLoca ? (transformVersion === 3 ? 0 : 1) : transformVersion,
        origLength: transformLength ?? origResult.value,
      });
    }

    // The Brotli-compressed table data starts right after the table directory
    const brotliOffset = dirPos;
    if (brotliOffset + totalCompressedSize > view.byteLength) return null;

    const brotliData = new Uint8Array(ab, brotliOffset, totalCompressedSize);
    const decompressed = brotliDecompressSync(brotliData);

    // Walk the decompressed stream, assigning offsets to each table
    // Tables are stored in directory order, each 4-byte-padded
    const tableOffsets = new Map<string, { offset: number; length: number }>();
    let streamOffset = 0;
    for (const entry of entries) {
      tableOffsets.set(entry.tag, { offset: streamOffset, length: entry.origLength });
      // Advance by origLength, padded to 4-byte boundary
      streamOffset += (entry.origLength + 3) & ~3;
    }

    // Extract only the metadata tables we need
    const METADATA_TAGS = ["name", "OS/2", "post", "fvar"];
    const needed: Array<{ tag: string; data: Uint8Array }> = [];

    for (const tag of METADATA_TAGS) {
      const loc = tableOffsets.get(tag);
      if (!loc) continue;
      if (loc.offset + loc.length > decompressed.byteLength) continue;
      needed.push({
        tag,
        data: decompressed.slice(loc.offset, loc.offset + loc.length),
      });
    }

    if (needed.length === 0) return null;

    // Build a minimal sfnt containing only the extracted tables
    const sfntHeaderSize = 12 + 16 * needed.length;
    let sfntDataSize = 0;
    const dataOffsets: number[] = [];
    for (const t of needed) {
      dataOffsets.push(sfntHeaderSize + sfntDataSize);
      sfntDataSize += (t.data.length + 3) & ~3;
    }

    const output = new Uint8Array(sfntHeaderSize + sfntDataSize);
    const outView = new DataView(output.buffer);

    // sfnt offset table
    writeU32(outView, 0, flavor);
    writeU16(outView, 4, needed.length);
    const maxPow2 = needed.length > 0 ? Math.floor(Math.log2(needed.length)) : 0;
    writeU16(outView, 6, Math.pow(2, maxPow2) * 16);
    writeU16(outView, 8, maxPow2);
    writeU16(outView, 10, needed.length * 16 - Math.pow(2, maxPow2) * 16);

    // Table directory entries
    for (let i = 0; i < needed.length; i++) {
      const t = needed[i]!;
      const offset = dataOffsets[i]!;
      const base = 12 + i * 16;
      for (let c = 0; c < 4; c++) {
        outView.setUint8(base + c, t.tag.charCodeAt(c));
      }
      writeU32(outView, base + 4, 0); // checksum (not verified by our parser)
      writeU32(outView, base + 8, offset);
      writeU32(outView, base + 12, t.data.length);
      output.set(t.data, offset);
    }

    return output;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Parse font metadata from a WOFF1 or WOFF2 buffer.
 *
 * Decompresses the container and delegates to parseFontMetadata on the
 * resulting sfnt buffer. Returns the same FontParseResult shape so callers
 * can treat all formats uniformly.
 *
 * Never throws.
 */
export function parseWoffMetadata(
  buffer: ArrayBuffer | Uint8Array,
): FontParseResult {
  try {
    const abRaw = buffer instanceof Uint8Array
      ? buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
      : buffer;
    // Cast to ArrayBuffer — slice always returns a new ArrayBuffer, never SharedArrayBuffer
    const ab = abRaw as ArrayBuffer;
    const view = new DataView(ab);

    if (ab.byteLength < 4) {
      return {
        ok: false,
        container: "wOFF",
        reason: "buffer too short to identify WOFF container",
      };
    }

    const sig = readU32(view, 0);

    if (sig === 0x774f4646) {
      // WOFF1
      const sfnt = decompressWoff1(ab);
      if (!sfnt) {
        return {
          ok: false,
          container: "wOFF",
          reason: "WOFF1 decompression failed — buffer may be truncated or corrupt",
        };
      }
      return parseFontMetadata(sfnt);
    }

    if (sig === 0x774f4632) {
      // WOFF2
      const sfnt = decompressWoff2(ab);
      if (!sfnt) {
        return {
          ok: false,
          container: "wOF2",
          reason: "WOFF2 decompression failed — buffer may be truncated, corrupt, or use an unsupported transform",
        };
      }
      // parseFontMetadata will see a plain sfnt (truetype/otto/true flavor)
      const result = parseFontMetadata(sfnt);
      // Rewrite the container tag to reflect the original format
      if (result.ok) {
        return { ...result, container: "wOF2" };
      }
      return result;
    }

    return {
      ok: false,
      container: "wOFF",
      reason: "buffer does not begin with a WOFF1 or WOFF2 signature",
    };
  } catch {
    return {
      ok: false,
      container: "wOFF",
      reason: "unexpected error during WOFF parsing",
    };
  }
}
