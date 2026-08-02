/**
 * reconcile.ts — beads silofl-qiy.5
 *
 * Tombstone reconciliation: compares the observed font file set against the
 * stored rows and decides what to upsert, retire, or leave unchanged.
 *
 * SAFETY INVARIANT — never retire from an incomplete observation.
 * ──────────────────────────────────────────────────────────────
 * Retirement wipes rows from the public catalog. Getting it wrong on a
 * truncated tree or a failed request would empty the catalog silently.
 *
 * Protection: callers must obtain a `CompleteObservation` token by calling
 * `markObservationComplete(fonts)`. That function is the only place the type
 * is constructed. It is impossible to pass `true` or any ad-hoc object — the
 * type is a branded nominal opaque type that only this module produces.
 *
 * Workflow:
 *   1. scanRepo() succeeds → call markObservationComplete(fonts)
 *   2. Pass the token to reconcileFiles()
 *   3. reconcileFiles() produces { toUpsert, toRetire, unchanged }
 *   4. Pass toRetire rows to buildRetireQuery() to get parameterised SQL
 */

import type { FontFileInput, QueryResult } from "@/ingest/upsert";

// ---------------------------------------------------------------------------
// Opaque "complete observation" token
// ---------------------------------------------------------------------------

/**
 * Runtime brand symbol. Not exported — the key is a private Symbol that
 * cannot be forged from outside this module.
 *
 * We use a module-scoped Symbol (not `unique symbol` via `declare const`)
 * because Bun's transpiler does not inject a runtime binding for
 * `declare const` — only the type exists, not the value. A module-scoped
 * `const` with `Symbol()` gives us both the type-level brand and a real
 * runtime key so the computed property `[BRAND]` resolves correctly.
 */
const COMPLETE_OBS_BRAND: unique symbol = Symbol("CompleteObservation");

/**
 * A branded wrapper that proves the observation was explicitly marked complete.
 * Only constructible via `markObservationComplete`.
 */
export type CompleteObservation = {
  readonly [COMPLETE_OBS_BRAND]: true;
  readonly fonts: readonly FontFileInput[];
};

/**
 * Mark an observation as complete and wrap the font list in the safety token.
 *
 * Call this ONLY when:
 *  - The git tree was fully fetched (truncated === false), AND
 *  - No error occurred during the scan.
 *
 * Never call it after a truncated tree, a network error, or any partial result.
 */
export function markObservationComplete(fonts: FontFileInput[]): CompleteObservation {
  return {
    [COMPLETE_OBS_BRAND]: true,
    fonts,
  } as CompleteObservation;
}

// ---------------------------------------------------------------------------
// Stored row shape
// ---------------------------------------------------------------------------

/**
 * Minimal shape of a stored font_files row needed for reconciliation.
 * Callers project these columns from the database.
 */
export interface StoredFontFile {
  /** font_files.id — needed to build the retire UPDATE. */
  id: bigint | number;
  /** Repo-relative path — the reconciliation key. */
  path: string;
  /** Non-null means the row is already retired. */
  retired_at: Date | null;
}

// ---------------------------------------------------------------------------
// Reconciliation result
// ---------------------------------------------------------------------------

export interface ReconcileResult {
  /**
   * Observed files that should be upserted (new or changed).
   * Includes files that were previously retired and have reappeared.
   */
  toUpsert: FontFileInput[];
  /**
   * Stored rows that were NOT observed in the complete tree and should be
   * retired (set retired_at, retired_reason).
   * Only non-retired rows are included — already-retired rows are skipped.
   */
  toRetire: StoredFontFile[];
  /**
   * Paths present both observed and stored, with no change needed.
   * (toUpsert contains those where something changed; unchanged is truly
   *  identical rows where the idempotency WHERE clause in upsert would be
   *  false — we still run upsert for them, this is informational.)
   */
  unchanged: StoredFontFile[];
}

// ---------------------------------------------------------------------------
// Core reconciliation function
// ---------------------------------------------------------------------------

/**
 * Reconcile an observed (complete) font file set against stored rows.
 *
 * Rules:
 *  1. Every observed file goes into `toUpsert` — the upsert is idempotent,
 *     so running it on an unchanged file is safe.
 *  2. A non-retired stored row whose path is absent from the observed set
 *     goes into `toRetire`.
 *  3. A previously retired path that reappears goes into `toUpsert` — the
 *     upsert query must clear `retired_at` and `retired_reason` to un-retire.
 *     It does NOT go into `toRetire`.
 *  4. Already-retired rows absent from the observation stay retired (no-op).
 *
 * The caller must separately execute `buildRetireQuery` for each `toRetire`
 * row, and `buildFontFileUpsertWithUnretire` (or the standard upsert) for
 * `toUpsert`.
 *
 * @param observed  A `CompleteObservation` token — proves the observation
 *                  is trustworthy enough to retire from.
 * @param stored    All font_files rows currently stored for this repo
 *                  (retired and non-retired alike).
 */
export function reconcileFiles({
  observed,
  stored,
}: {
  observed: CompleteObservation;
  stored: StoredFontFile[];
}): ReconcileResult {
  const observedFonts = observed.fonts;

  // Build a Set of observed paths for O(1) lookup
  const observedPaths = new Set(observedFonts.map((f) => f.path));

  // Build a Map of stored rows by path for O(1) lookup
  const storedByPath = new Map<string, StoredFontFile>();
  for (const row of stored) {
    storedByPath.set(row.path, row);
  }

  const toUpsert: FontFileInput[] = [];
  const toRetire: StoredFontFile[] = [];
  const unchanged: StoredFontFile[] = [];

  // Every observed file goes to upsert (idempotent)
  // Reappeared retired files are naturally handled: upsert will clear retired_at
  for (const font of observedFonts) {
    toUpsert.push(font);
    // Track as unchanged if it's an existing non-retired row
    // (purely informational — toUpsert still includes it for idempotency)
    const stored = storedByPath.get(font.path);
    if (stored && stored.retired_at === null) {
      unchanged.push(stored);
    }
  }

  // Stored non-retired rows absent from the observation → retire
  for (const row of stored) {
    if (row.retired_at !== null) continue; // already retired, skip
    if (!observedPaths.has(row.path)) {
      toRetire.push(row);
    }
  }

  return { toUpsert, toRetire, unchanged };
}

// ---------------------------------------------------------------------------
// SQL builders
// ---------------------------------------------------------------------------

/**
 * Build a parameterised UPDATE to retire a single font_files row.
 *
 * Sets `retired_at = NOW()` and `retired_reason = 'path-not-observed'`.
 * Never DELETEs — retirement is always a tombstone per the schema design.
 *
 * Shape matches the `{ text, values }` contract used by upsert.ts.
 *
 * @param id            font_files.id of the row to retire
 * @param reason        Machine-readable reason string for retired_reason
 */
export function buildRetireQuery(
  id: bigint | number,
  reason = "path-not-observed",
): QueryResult {
  return {
    text: `
UPDATE font_files
SET retired_at     = NOW(),
    retired_reason = $2
WHERE id = $1
  AND retired_at IS NULL
`.trim(),
    values: [id, reason],
  };
}

/**
 * Build a parameterised UPDATE to un-retire a font_files row.
 *
 * Used when a previously retired path reappears in a complete scan.
 * The upsert (ON CONFLICT DO UPDATE) handles the data columns; this clears
 * the tombstone markers so the row becomes live again.
 *
 * @param id  font_files.id to un-retire
 */
export function buildUnretireQuery(id: bigint | number): QueryResult {
  return {
    text: `
UPDATE font_files
SET retired_at     = NULL,
    retired_reason = NULL
WHERE id = $1
  AND retired_at IS NOT NULL
`.trim(),
    values: [id],
  };
}

/**
 * Build a parameterised SELECT to load all stored font_files rows for a repo.
 *
 * Returns (id, path, retired_at) — the minimal columns needed for
 * reconciliation. Callers execute this before calling reconcileFiles.
 */
export function buildLoadStoredFilesQuery(repoId: bigint | number): QueryResult {
  return {
    text: `
SELECT id, path, retired_at
FROM font_files
WHERE repo_id = $1
`.trim(),
    values: [repoId],
  };
}
