/**
 * dedup.ts
 *
 * Duplicate-binary grouping and canonical selection for the sil-ofl catalog.
 *
 * Scope (issue silofl-qiy.15):
 *   - Group font_files rows that share a sha (identical binary).
 *   - Pick one canonical row per group for display.
 *   - Provide a read-only SQL query that reproduces the 503 / 1,030 finding.
 *
 * This module is read-only / grouping-only. It does not delete rows, design
 * migrations, or write to the database. Retiring duplicate rows is out of scope.
 *
 * Canonical selection is deterministic and stable across runs:
 *   1. Highest repo reputation (descending).
 *   2. Highest repo stars (descending).
 *   3. Lowest repo_id (ascending) — tie-break on the repo level.
 *   4. Shortest path length (ascending) — prefer the shorter path.
 *   5. Lexicographic path order (ascending) — fully deterministic last resort.
 *
 * Stability matters because a canonical pick that flips between runs churns
 * the catalog (cache misses, URL changes, confusing diffs).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Minimal shape of a font_files row plus the repo columns needed for ranking. */
export interface FontFileRow {
  id: number;
  repo_id: number;
  path: string;
  sha: string;

  // Repo-level ranking signals (joined from repos table).
  reputation: number;
  stars: number;

  // Optional visibility signals — used only for assertions, not for selection.
  // Selection is purely by ranking; visibility filtering is the caller's job.
  is_fork?: boolean;
}

/** A group of rows that share an identical sha. */
export interface DuplicateGroup {
  sha: string;
  rows: FontFileRow[];
  /** The row a user should be shown, as selected by chooseCanonical(). */
  canonical: FontFileRow;
}

// ---------------------------------------------------------------------------
// groupBySha
// ---------------------------------------------------------------------------

/**
 * Group `rows` by their `sha` field.
 *
 * - Singletons (only one row with a given sha) are included as groups of one.
 * - Input order does not affect grouping or canonical selection.
 * - Empty input returns an empty array.
 */
export function groupBySha(rows: FontFileRow[]): DuplicateGroup[] {
  if (rows.length === 0) return [];

  const map = new Map<string, FontFileRow[]>();
  for (const row of rows) {
    const existing = map.get(row.sha);
    if (existing) {
      existing.push(row);
    } else {
      map.set(row.sha, [row]);
    }
  }

  const groups: DuplicateGroup[] = [];
  for (const [sha, members] of map) {
    const canonical = chooseCanonical(members);
    groups.push({ sha, rows: members, canonical });
  }

  // Sort groups by sha for stable output order.
  groups.sort((a, b) => (a.sha < b.sha ? -1 : a.sha > b.sha ? 1 : 0));

  return groups;
}

// ---------------------------------------------------------------------------
// chooseCanonical
// ---------------------------------------------------------------------------

/**
 * Pick the canonical row from a duplicate group.
 *
 * Ordering (all criteria applied in sequence until a unique winner emerges):
 *   1. Highest reputation (descending).
 *   2. Highest stars (descending).
 *   3. Lowest repo_id (ascending).
 *   4. Shortest path length (ascending).
 *   5. Lexicographic path (ascending).
 *
 * The caller is responsible for visibility filtering (is_fork, is_archived,
 * license_spdx, etc.). This function selects purely by ranking signals so
 * that the grouping layer stays decoupled from the public-catalog policy.
 * A fork may legitimately be canonical within its duplicate group even though
 * it will be excluded from the public catalog by the visibility clauses.
 */
export function chooseCanonical(rows: FontFileRow[]): FontFileRow {
  if (rows.length === 0) {
    throw new Error("chooseCanonical: rows must not be empty");
  }
  if (rows.length === 1) {
    // Safety: noUncheckedIndexedAccess — rows[0] is guaranteed by length check.
    return rows[0]!;
  }

  const sorted = [...rows].sort((a, b) => {
    // 1. Highest reputation first.
    if (b.reputation !== a.reputation) return b.reputation - a.reputation;
    // 2. Highest stars first.
    if (b.stars !== a.stars) return b.stars - a.stars;
    // 3. Lowest repo_id first.
    if (a.repo_id !== b.repo_id) return a.repo_id - b.repo_id;
    // 4. Shortest path first.
    if (a.path.length !== b.path.length) return a.path.length - b.path.length;
    // 5. Lexicographic path order.
    return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
  });

  // sorted[0] is guaranteed: rows.length >= 2 implies sorted.length >= 2.
  return sorted[0]!;
}

// ---------------------------------------------------------------------------
// buildDuplicateGroupQuery
// ---------------------------------------------------------------------------

/**
 * Return the read-only SQL that reproduces the "1,030 rows in 503 groups"
 * finding from the 2026-08-02 audit.
 *
 * Running this query against the live database should return the same result
 * (or a delta since the audit) so the finding is verifiable rather than
 * asserted in prose.
 *
 * The query returns one row per duplicate group with the sha, group size,
 * and the minimum font_file id for stable ordering.
 */
export function buildDuplicateGroupQuery(): string {
  return `
-- Duplicate binary groups: rows that share a sha with at least one other row.
-- Reproduces the 503 groups / 1,030 rows finding from the 2026-08-02 audit.
-- Read-only; no writes.
SELECT
    ff.sha,
    COUNT(*)          AS duplicate_count,
    MIN(ff.id)        AS min_file_id,
    MIN(ff.repo_id)   AS min_repo_id
FROM font_files ff
WHERE ff.sha IS NOT NULL
  AND ff.sha != ''
GROUP BY ff.sha
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC, ff.sha ASC;
`.trim();
}
