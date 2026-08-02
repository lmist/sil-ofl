/**
 * ingest-metadata-backfill.ts
 *
 * Metadata backfill for font_files rows.
 *
 * For a bounded set of font_files, fetches the font bytes (range-requesting
 * only the header + tables needed), parses binary metadata, and writes:
 *   family_guess, subfamily_guess, weight_guess, style_guess,
 *   is_variable, axes, metadata_source
 *
 * WOFF1 and WOFF2 files are decompressed via woff.ts. TTF/OTF files are
 * read directly. Other formats (ttc) are skipped.
 *
 * Usage:
 *   bun --env-file=.env.local scripts/ingest-metadata-backfill.ts
 *   bun --env-file=.env.local scripts/ingest-metadata-backfill.ts --apply --limit 50
 *   bun --env-file=.env.local scripts/ingest-metadata-backfill.ts --apply --limit 500 --concurrency 8
 *
 * Flags:
 *   --dry-run        Default: true. Parse and print without writing.
 *   --apply          Disable dry-run and write to the database.
 *   --limit <n>      Process at most n rows (default: 100).
 *   --concurrency <n> Max parallel fetches (default: 4).
 */

import { neon } from "@neondatabase/serverless";
import { parseWoffMetadata } from "../src/ingest/woff.js";
import {
  parseFontMetadata,
  parseTableDirectory,
} from "../src/ingest/font-metadata.js";
import type { FvarAxis } from "../src/ingest/font-metadata.js";

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const dryRun = !apply;

const limitIdx = args.indexOf("--limit");
const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1] ?? "100", 10) : 100;

const concIdx = args.indexOf("--concurrency");
const concurrency = concIdx >= 0 ? parseInt(args[concIdx + 1] ?? "4", 10) : 4;

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set. Run with: bun --env-file=.env.local ...");
  process.exit(1);
}

const sql = neon(DATABASE_URL);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FontFileRow {
  id: number;
  repo_id: number;
  path: string;
  format: string;
  raw_url: string | null;
  cdn_url: string | null;
  family_guess: string | null;
  subfamily_guess: string | null;
  weight_guess: number | null;
  style_guess: string | null;
  is_variable: boolean;
}

interface ParseResult {
  fileId: number;
  family: string | null;
  subfamily: string | null;
  weightClass: number | null;
  isItalic: boolean | null;
  isVariable: boolean;
  axes: FvarAxis[] | null;
  metadataSource: "binary" | "sibling" | "filename";
  ok: boolean;
  reason: string;
}

// ---------------------------------------------------------------------------
// Range-fetching helpers
// ---------------------------------------------------------------------------

/**
 * Fetch the first `bytes` bytes of a URL using a Range request.
 * Falls back to a full fetch if the server does not support ranges.
 */
async function fetchRangeOrFull(url: string, bytes: number): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url, {
      headers: { Range: `bytes=0-${bytes - 1}` },
    });
    if (!res.ok && res.status !== 206) return null;
    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
  } catch {
    return null;
  }
}

/**
 * Fetch a specific byte range from a URL.
 */
async function fetchByteRange(
  url: string,
  start: number,
  end: number,
): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url, {
      headers: { Range: `bytes=${start}-${end}` },
    });
    if (!res.ok && res.status !== 206) return null;
    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Metadata extraction
// ---------------------------------------------------------------------------

/**
 * Extract metadata from a font URL using minimal byte fetches.
 *
 * Strategy (TTF/OTF):
 *   1. Fetch 12 bytes (sfnt offset table) to get numTables.
 *   2. Fetch 12 + 16*numTables bytes to get full table directory.
 *   3. From directory, identify byte ranges for name/OS·2/post/fvar.
 *   4. Fetch only those ranges (one range-request covers them all if close).
 *
 * Strategy (WOFF1/WOFF2):
 *   Fetch the full file — these are compressed and we need the whole stream.
 *   WOFF files in this catalog are typically 20–500 KB.
 *
 * Returns a ParseResult with provenance set correctly.
 */
async function extractMetadata(row: FontFileRow): Promise<ParseResult> {
  const url = row.raw_url ?? row.cdn_url;
  const emptyResult: ParseResult = {
    fileId: row.id,
    family: null,
    subfamily: null,
    weightClass: null,
    isItalic: null,
    isVariable: false,
    axes: null,
    metadataSource: "filename",
    ok: false,
    reason: "no URL",
  };

  if (!url) return emptyResult;

  const fmt = row.format.toLowerCase();

  try {
    if (fmt === "woff" || fmt === "woff2") {
      // Fetch the full WOFF file (compressed — we need the whole thing)
      // Cap at 4 MB to protect memory; legitimate fonts are rarely larger
      const res = await fetch(url, { headers: { Range: "bytes=0-4194303" } });
      if (!res.ok && res.status !== 206) {
        return { ...emptyResult, reason: `HTTP ${res.status}` };
      }
      const buf = await res.arrayBuffer();
      const parsed = parseWoffMetadata(buf);

      if (!parsed.ok) {
        return { ...emptyResult, reason: parsed.reason };
      }

      const axes = parsed.variableAxes.length > 0 ? parsed.variableAxes : null;
      return {
        fileId: row.id,
        family: parsed.family?.value ?? null,
        subfamily: parsed.subfamily?.value ?? null,
        weightClass: parsed.weightClass?.value ?? null,
        isItalic: parsed.isItalic?.value ?? null,
        isVariable: parsed.isVariable,
        axes,
        metadataSource: "binary",
        ok: true,
        reason: "ok",
      };
    }

    if (fmt === "ttf" || fmt === "otf") {
      // Step 1: fetch 12 bytes to get numTables
      const header = await fetchRangeOrFull(url, 12);
      if (!header || header.byteLength < 12) {
        return { ...emptyResult, reason: "could not fetch sfnt header" };
      }

      const headerView = new DataView(header.buffer);
      const numTables = headerView.getUint16(4, false);
      if (numTables === 0 || numTables > 256) {
        return { ...emptyResult, reason: "invalid numTables in sfnt header" };
      }

      // Step 2: fetch full table directory
      const dirSize = 12 + 16 * numTables;
      const dirBuf = await fetchRangeOrFull(url, dirSize);
      if (!dirBuf || dirBuf.byteLength < dirSize) {
        return { ...emptyResult, reason: "could not fetch table directory" };
      }

      const dir = parseTableDirectory(dirBuf);
      if (!dir || dir.entries.length === 0) {
        return { ...emptyResult, reason: "could not parse table directory" };
      }

      // Step 3: find byte ranges for the tables we need
      const WANTED = ["name", "OS/2", "post", "fvar"];
      const neededEntries = dir.entries.filter((e) => WANTED.includes(e.tag));
      if (neededEntries.length === 0) {
        return { ...emptyResult, reason: "no metadata tables in directory" };
      }

      // Find min start and max end to do a single range request
      const minOffset = Math.min(...neededEntries.map((e) => e.offset));
      const maxEnd = Math.max(...neededEntries.map((e) => e.offset + e.length));

      // Step 4: fetch the combined range
      const dataBuf = await fetchByteRange(url, minOffset, maxEnd - 1);
      if (!dataBuf) {
        return { ...emptyResult, reason: "could not fetch table data" };
      }

      // Build a minimal buffer: directory prefix + the data slice
      // We pad the directory to minOffset so table offsets remain valid
      const combined = new Uint8Array(maxEnd);
      combined.set(dirBuf, 0);
      combined.set(dataBuf, minOffset);

      const parsed = parseFontMetadata(combined);
      if (!parsed.ok) {
        return { ...emptyResult, reason: parsed.reason };
      }

      const axes = parsed.variableAxes.length > 0 ? parsed.variableAxes : null;
      return {
        fileId: row.id,
        family: parsed.family?.value ?? null,
        subfamily: parsed.subfamily?.value ?? null,
        weightClass: parsed.weightClass?.value ?? null,
        isItalic: parsed.isItalic?.value ?? null,
        isVariable: parsed.isVariable,
        axes,
        metadataSource: "binary",
        ok: true,
        reason: "ok",
      };
    }

    // ttc or other: skip
    return { ...emptyResult, reason: `format '${fmt}' not supported for binary read` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ...emptyResult, reason: `fetch/parse error: ${msg}` };
  }
}

// ---------------------------------------------------------------------------
// Concurrency helper
// ---------------------------------------------------------------------------

async function runConcurrent<T, R>(
  items: T[],
  worker: (item: T) => Promise<R>,
  maxConcurrent: number,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIdx = 0;

  async function runWorker(): Promise<void> {
    while (nextIdx < items.length) {
      const idx = nextIdx++;
      const item = items[idx]!;
      results[idx] = await worker(item);
    }
  }

  const workers = Array.from({ length: Math.min(maxConcurrent, items.length) }, runWorker);
  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------------------
// DB write
// ---------------------------------------------------------------------------

async function writeParsed(result: ParseResult): Promise<void> {
  const axesJson = result.axes ? JSON.stringify(
    result.axes.map((a) => ({
      tag: a.tag,
      min: a.minValue,
      default: a.defaultValue,
      max: a.maxValue,
    }))
  ) : null;

  const styleGuess = result.isItalic === true ? "italic" : result.isItalic === false ? "regular" : null;

  await sql`
    UPDATE font_files
    SET
      family_guess    = ${result.family},
      subfamily_guess = ${result.subfamily},
      weight_guess    = ${result.weightClass},
      style_guess     = ${styleGuess},
      is_variable     = ${result.isVariable},
      axes            = ${axesJson ? sql`${axesJson}::jsonb` : sql`NULL`},
      metadata_source = ${result.metadataSource}
    WHERE id = ${result.fileId}
  `;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(`ingest-metadata-backfill — ${dryRun ? "DRY RUN" : "APPLY"} | limit=${limit} concurrency=${concurrency}`);
  console.log();

  // Load candidate rows spread evenly across the four formats.
  // Each format contributes up to limit/4 rows (with any remainder going to
  // woff2) so we never burn the whole budget on a single format cluster.
  const perFmt = Math.ceil(limit / 4);
  const rows = (await sql`
    WITH ranked AS (
      SELECT
        id, repo_id, path, format,
        raw_url, cdn_url,
        family_guess, subfamily_guess, weight_guess, style_guess, is_variable,
        ROW_NUMBER() OVER (PARTITION BY format ORDER BY id) AS rn
      FROM font_files
      WHERE metadata_source IS NULL
        AND format IN ('ttf', 'otf', 'woff', 'woff2')
        AND (raw_url IS NOT NULL OR cdn_url IS NOT NULL)
    )
    SELECT id, repo_id, path, format, raw_url, cdn_url,
           family_guess, subfamily_guess, weight_guess, style_guess, is_variable
    FROM ranked
    WHERE rn <= ${perFmt}
    ORDER BY rn, format
    LIMIT ${limit}
  `) as FontFileRow[];

  console.log(`Processing ${rows.length} rows...`);
  console.log();

  let successCount = 0;
  let failCount = 0;
  let variableCount = 0;
  let variableChanged = 0;
  const failReasons: Record<string, number> = {};

  let processed = 0;

  const results = await runConcurrent(rows, async (row) => {
    const result = await extractMetadata(row);
    processed++;
    if (processed % 10 === 0 || processed === rows.length) {
      process.stdout.write(`\r  ${processed}/${rows.length} processed...`);
    }
    return result;
  }, concurrency);

  console.log("\n");

  for (let i = 0; i < results.length; i++) {
    const result = results[i]!;
    const row = rows[i]!;

    if (result.ok) {
      successCount++;
      if (result.isVariable) variableCount++;
      // Check if is_variable changed from what was in DB
      if (result.isVariable !== row.is_variable) variableChanged++;

      if (dryRun) {
        console.log(
          `[DRY] ${row.format.padEnd(5)} ${row.path.substring(0, 60).padEnd(60)} ` +
          `family=${result.family ?? "?"} weight=${result.weightClass ?? "?"} ` +
          `variable=${result.isVariable}`
        );
      } else {
        await writeParsed(result);
      }
    } else {
      failCount++;
      const r = result.reason;
      failReasons[r] = (failReasons[r] ?? 0) + 1;

      if (dryRun) {
        console.log(`[FAIL] ${row.format.padEnd(5)} ${row.path.substring(0, 60).padEnd(60)} ${r}`);
      }
    }
  }

  console.log();
  console.log("=== Results ===");
  console.log(`Success:           ${successCount} / ${rows.length}`);
  console.log(`Failed:            ${failCount}`);
  console.log(`Variable fonts:    ${variableCount}`);
  console.log(`is_variable changed: ${variableChanged}`);

  if (Object.keys(failReasons).length > 0) {
    console.log("\nFailure reasons:");
    for (const [reason, count] of Object.entries(failReasons).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${count.toString().padStart(4)}  ${reason}`);
    }
  }

  // Projection
  const total = 35509;
  const supported = 5814 + 3004 + 11984 + 14701; // ttf + otf + woff + woff2
  const successRate = successCount / (rows.length || 1);
  const projectedSuccess = Math.round(supported * successRate);
  console.log();
  console.log("=== Projection ===");
  console.log(`Supported formats:     ${supported} of ${total} total rows`);
  console.log(`Success rate (sample): ${(successRate * 100).toFixed(1)}%`);
  console.log(`Projected coverage:    ~${projectedSuccess} of ${supported} rows`);

  if (dryRun) {
    console.log("\nDry run — no writes. Re-run with --apply to write.");
  } else {
    console.log(`\nWrote ${successCount} rows.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
