/**
 * cdn-policy.ts — beads silofl-qiy.7 + .11
 *
 * CDN delivery policy for font assets: size limits, renderable format rules,
 * and a delivery-classification helper used by the ingest pipeline.
 *
 * ── Decision record: .ttc (TrueType Collection) ─────────────────────────────
 *
 * Issue: silofl-qiy.11
 * Date: 2026-08-02
 * Evidence: 6 rows with format = 'ttc' in font_files; 1 of those is also over
 *   the jsDelivr size limit.
 *
 * Question: can browsers use a .ttc file via @font-face?
 *
 * Conclusion: NO — do not serve .ttc files and stop ingesting them.
 *
 * Reasoning:
 *   A TrueType Collection (.ttc) bundles multiple distinct typefaces into one
 *   binary. The @font-face `src:` descriptor expects a reference to a single
 *   font face.  The CSS Fonts Level 4 spec defines a `collection-index` hint
 *   via the `tech()` function, but browser support for it is essentially zero
 *   as of 2026: Chromium and Safari do not implement it, and Firefox only
 *   partially.  In practice, loading a .ttc via @font-face either fails
 *   silently (the browser picks face 0 unpredictably) or is refused entirely.
 *
 *   Even when a browser does load face 0 it is not the face the catalog
 *   intends to display — font family, weight, and style metadata come from
 *   whichever face happens to be first in the collection.
 *
 *   The existing PUBLIC_RENDERABLE_FONT_CLAUSE already excludes 'ttc'; this
 *   module makes that exclusion explicit and machine-readable.
 *
 *   Action: ingest should skip .ttc files at collection time.  The 6 existing
 *   rows are non-renderable and can remain as dead records or be tombstoned
 *   by silofl-qiy.2.  The orchestrator should close .11 as "excluded — no
 *   browser path to a deterministic single face".
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { PUBLIC_RENDERABLE_FONT_CLAUSE } from "@/graphql/schema/public-font-policy";

/**
 * The maximum file size that jsDelivr will serve without returning 403.
 *
 * jsDelivr enforces a ~20 MiB hard limit per file.  Files above this limit
 * return HTTP 403.  The limit is documented at https://www.jsdelivr.com/terms
 * and confirmed empirically: all 30 rows with size_bytes > 20 MiB return 403
 * when probed (measured 2026-08-02 against the live CDN).
 *
 * We use 20 * 1024 * 1024 = 20,971,520 bytes.  Files AT this threshold are
 * allowed through to avoid off-by-one false positives.
 */
export const JSDELIVR_MAX_BYTES = 20 * 1024 * 1024; // 20 MiB = 20,971,520 bytes

// ── Renderable format set ────────────────────────────────────────────────────

/**
 * The four formats a browser can load via @font-face.
 *
 * Must agree with PUBLIC_RENDERABLE_FONT_CLAUSE in public-font-policy.ts
 * (INV-DATA-2: list and detail apply the same visibility rules).
 * The test file asserts this alignment at runtime — if the policy changes,
 * the test fails before production is affected.
 */
const RENDERABLE_FORMATS = new Set(["ttf", "otf", "woff", "woff2"]);

/**
 * Returns `true` when the format can be served as a @font-face source in a
 * browser.  Agrees exactly with PUBLIC_RENDERABLE_FONT_CLAUSE.
 *
 * .ttc is explicitly excluded: see decision record at the top of this file.
 */
export function isRenderableFormat(format: string | null | undefined): boolean {
  if (!format) return false;
  return RENDERABLE_FORMATS.has(format.toLowerCase());
}

// ── Delivery classification ──────────────────────────────────────────────────

/**
 * Machine-readable reason codes for non-CDN-servable files.
 *
 * Stored in the database so queries can group on reason without string parsing.
 */
export type DeliveryExclusionReason =
  | "NOT_RENDERABLE_FORMAT" // format not in ttf|otf|woff|woff2
  | "EXCEEDS_CDN_SIZE_LIMIT"; // file > JSDELIVR_MAX_BYTES → jsDelivr 403

/**
 * A file the CDN can serve directly.  No fallback needed.
 */
export interface CdnServable {
  kind: "cdn";
}

/**
 * A file that is renderable but too large for jsDelivr.
 * The ingest pipeline must fall back to `raw_url` for these rows.
 * (See INV-ARTIFACT-3: font loading MAY fall back once to raw URL.)
 */
export interface CdnFallbackToRaw {
  kind: "raw_fallback";
  reason: "EXCEEDS_CDN_SIZE_LIMIT";
}

/**
 * A file that cannot be rendered at all.
 * Do not publish these rows to the public catalog.
 */
export interface NotRenderable {
  kind: "not_renderable";
  reason: DeliveryExclusionReason;
}

export type DeliveryClassification =
  | CdnServable
  | CdnFallbackToRaw
  | NotRenderable;

export interface ClassifyDeliveryInput {
  /** From font_files.size_bytes.  null means unknown; 0 means recorded as zero. */
  sizeBytes: number | null;
  /** From font_files.format, e.g. "otf", "ttc", "ttf". */
  format: string | null | undefined;
}

/**
 * Classify how a font file can be delivered to the browser.
 *
 * Rules (applied in order):
 *  1. If the format is not renderable → not_renderable / NOT_RENDERABLE_FORMAT.
 *  2. If size_bytes is known and exceeds the CDN limit → raw_fallback.
 *  3. Otherwise → cdn (includes null/unknown size and size_bytes = 0).
 *
 * The `raw_fallback` case still permits the font to appear in the catalog via
 * raw_url; `not_renderable` means the row must be excluded entirely.
 *
 * `sizeBytes = null` is treated as unknown (not too large), preserving existing
 * rows that were imported before size was populated.  If those rows later fail
 * with 403, the health-check sweep (silofl-qiy.10) will reclassify them.
 *
 * `sizeBytes = 0` is treated as "effectively empty / unknown" and allowed
 * through to CDN, consistent with the one real row that carries this value
 * (it is likely a metadata placeholder, not a zero-byte font).
 */
export function classifyDelivery({
  sizeBytes,
  format,
}: ClassifyDeliveryInput): DeliveryClassification {
  if (!isRenderableFormat(format)) {
    return { kind: "not_renderable", reason: "NOT_RENDERABLE_FORMAT" };
  }

  if (sizeBytes !== null && sizeBytes > JSDELIVR_MAX_BYTES) {
    return { kind: "raw_fallback", reason: "EXCEEDS_CDN_SIZE_LIMIT" };
  }

  return { kind: "cdn" };
}

// ── Internal: policy drift guard ─────────────────────────────────────────────
// Exported so the test can verify it without re-importing the policy module.
// Do not use this in application code; import isRenderableFormat directly.

/**
 * Parses the format list out of PUBLIC_RENDERABLE_FONT_CLAUSE.
 * Used by cdn-policy.test.ts to assert the two sources stay in sync.
 * @internal
 */
export function parseRenderableFormatsFromClause(
  clause: typeof PUBLIC_RENDERABLE_FONT_CLAUSE,
): Set<string> {
  // Clause shape: "f.format IN ('ttf', 'otf', 'woff', 'woff2')"
  const match = clause.match(/IN \(([^)]+)\)/);
  if (!match || !match[1]) {
    throw new Error(
      `Cannot parse renderable formats from clause: ${clause}`,
    );
  }
  return new Set(
    match[1]
      .split(",")
      .map((s) => s.trim().replace(/^'|'$/g, "")),
  );
}
