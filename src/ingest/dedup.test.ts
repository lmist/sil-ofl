/**
 * dedup.test.ts
 *
 * Pure, offline tests for the duplicate-binary grouping logic.
 *
 * Coverage:
 *   - Stable canonical choice: same winner regardless of input order.
 *   - Ties broken deterministically by repo_id then path length then path.
 *   - Singleton groups untouched (no spurious deduplication).
 *   - Empty input returns empty array.
 *   - Group where highest-reputation repo is a fork: grouping still correct,
 *     fork is not silently promoted to the public catalog (visibility is
 *     caller's responsibility — this test asserts the group does NOT filter
 *     by is_fork internally).
 *   - buildDuplicateGroupQuery returns a non-empty SQL string with HAVING.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  groupBySha,
  chooseCanonical,
  buildDuplicateGroupQuery,
  type FontFileRow,
} from "./dedup.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function row(
  id: number,
  repo_id: number,
  path: string,
  sha: string,
  reputation: number,
  stars: number,
  is_fork = false,
): FontFileRow {
  return { id, repo_id, path, sha, reputation, stars, is_fork };
}

// ---------------------------------------------------------------------------
// chooseCanonical
// ---------------------------------------------------------------------------

describe("chooseCanonical", () => {
  it("picks the row with the highest reputation", () => {
    const rows = [
      row(1, 10, "fonts/a.ttf", "sha1", 50, 100),
      row(2, 20, "fonts/b.ttf", "sha1", 90, 50), // highest reputation
      row(3, 30, "fonts/c.ttf", "sha1", 30, 200),
    ];
    const winner = chooseCanonical(rows);
    assert.equal(winner.id, 2);
  });

  it("breaks ties on reputation by highest stars", () => {
    const rows = [
      row(1, 10, "fonts/a.ttf", "sha1", 80, 300), // highest stars
      row(2, 20, "fonts/b.ttf", "sha1", 80, 100),
    ];
    const winner = chooseCanonical(rows);
    assert.equal(winner.id, 1);
  });

  it("breaks ties on reputation+stars by lowest repo_id", () => {
    const rows = [
      row(1, 30, "fonts/a.ttf", "sha1", 80, 300),
      row(2, 10, "fonts/b.ttf", "sha1", 80, 300), // lowest repo_id
      row(3, 20, "fonts/c.ttf", "sha1", 80, 300),
    ];
    const winner = chooseCanonical(rows);
    assert.equal(winner.repo_id, 10);
    assert.equal(winner.id, 2);
  });

  it("breaks ties on repo_id by shortest path", () => {
    const rows = [
      row(1, 10, "fonts/x/y/z/a.ttf", "sha1", 80, 300),
      row(2, 10, "a.ttf", "sha1", 80, 300), // shortest path
    ];
    const winner = chooseCanonical(rows);
    assert.equal(winner.id, 2);
    assert.equal(winner.path, "a.ttf");
  });

  it("breaks ties on path length by lexicographic path order", () => {
    const rows = [
      row(1, 10, "fonts/z.ttf", "sha1", 80, 300),
      row(2, 10, "fonts/a.ttf", "sha1", 80, 300), // lex first
    ];
    const winner = chooseCanonical(rows);
    assert.equal(winner.path, "fonts/a.ttf");
  });

  it("is stable: same winner regardless of input order", () => {
    const base = [
      row(1, 10, "z.ttf", "sha1", 80, 300),
      row(2, 20, "a.ttf", "sha1", 90, 100), // highest reputation
      row(3, 30, "m.ttf", "sha1", 70, 500),
    ];

    // Try several permutations.
    const permutations = [
      [base[0]!, base[1]!, base[2]!],
      [base[2]!, base[0]!, base[1]!],
      [base[1]!, base[2]!, base[0]!],
      [base[1]!, base[0]!, base[2]!],
    ];

    for (const perm of permutations) {
      const winner = chooseCanonical(perm);
      assert.equal(winner.id, 2, `unstable canonical for permutation starting with id=${perm[0]!.id}`);
    }
  });

  it("handles a singleton group (returns the only row)", () => {
    const single = [row(42, 7, "only.ttf", "sha1", 100, 1000)];
    const winner = chooseCanonical(single);
    assert.equal(winner.id, 42);
  });

  it("throws on empty input (contract violation)", () => {
    assert.throws(() => chooseCanonical([]), /empty/);
  });
});

// ---------------------------------------------------------------------------
// groupBySha
// ---------------------------------------------------------------------------

describe("groupBySha", () => {
  it("returns an empty array for empty input", () => {
    const groups = groupBySha([]);
    assert.deepEqual(groups, []);
  });

  it("groups rows by sha, including singletons", () => {
    const rows = [
      row(1, 10, "a.ttf", "aaa", 50, 100),
      row(2, 20, "b.ttf", "bbb", 60, 200),
      row(3, 30, "c.ttf", "aaa", 40, 300), // same sha as row 1
    ];
    const groups = groupBySha(rows);
    assert.equal(groups.length, 2);

    const groupAaa = groups.find((g) => g.sha === "aaa");
    const groupBbb = groups.find((g) => g.sha === "bbb");
    assert.ok(groupAaa, "group aaa should exist");
    assert.ok(groupBbb, "group bbb should exist");
    assert.equal(groupAaa.rows.length, 2);
    assert.equal(groupBbb.rows.length, 1);
  });

  it("singleton groups have canonical === the single row", () => {
    const rows = [row(5, 1, "solo.otf", "solo", 100, 9999)];
    const groups = groupBySha(rows);
    assert.equal(groups.length, 1);
    assert.equal(groups[0]!.canonical.id, 5);
    assert.equal(groups[0]!.rows.length, 1);
  });

  it("canonical selection is stable under reordered input for duplicates", () => {
    const r1 = row(1, 10, "fonts/a.ttf", "dup", 80, 300);
    const r2 = row(2, 10, "fonts/b.ttf", "dup", 80, 300);
    // r2 should lose to r1 (same repo_id, same reputation, same stars,
    // but 'fonts/a.ttf' < 'fonts/b.ttf' lexicographically and same length)

    const g1 = groupBySha([r1, r2]);
    const g2 = groupBySha([r2, r1]);

    assert.equal(g1[0]!.canonical.id, g2[0]!.canonical.id);
    assert.equal(g1[0]!.canonical.path, "fonts/a.ttf");
  });

  it("groups output is sorted by sha for stable output order", () => {
    const rows = [
      row(1, 10, "a.ttf", "zzz", 50, 100),
      row(2, 20, "b.ttf", "aaa", 60, 200),
      row(3, 30, "c.ttf", "mmm", 40, 300),
    ];
    const groups = groupBySha(rows);
    const shas = groups.map((g) => g.sha);
    const sorted = [...shas].sort();
    assert.deepEqual(shas, sorted, "groups should be sorted by sha");
  });

  it("a fork with highest reputation is still selected as canonical within the group", () => {
    // Grouping does not filter by is_fork — that is the caller's job.
    // This test asserts that the fork is NOT silently excluded by dedup.ts,
    // and that visibility filtering is external to this module.
    const rows = [
      row(1, 10, "a.ttf", "sha", 200, 500, /* is_fork */ true), // fork, highest reputation
      row(2, 20, "b.ttf", "sha", 100, 300, /* is_fork */ false),
    ];
    const groups = groupBySha(rows);
    assert.equal(groups.length, 1);
    const canonical = groups[0]!.canonical;

    // The fork wins because it has the highest reputation.
    // It is then the caller's responsibility to filter it from the public catalog.
    assert.equal(canonical.is_fork, true);
    assert.equal(canonical.id, 1);

    // Explicitly assert: the group has both rows, the fork is not silently removed.
    assert.equal(groups[0]!.rows.length, 2);
  });

  it("multiple groups — each has the right canonical", () => {
    const rows = [
      row(1, 10, "a.ttf", "sha1", 90, 100),
      row(2, 20, "a.ttf", "sha1", 50, 500), // sha1 group: row 1 wins (rep)
      row(3, 30, "b.ttf", "sha2", 30, 1000),
      row(4, 40, "b.ttf", "sha2", 70, 200), // sha2 group: row 4 wins (rep)
    ];
    const groups = groupBySha(rows);
    assert.equal(groups.length, 2);
    const sha1Group = groups.find((g) => g.sha === "sha1")!;
    const sha2Group = groups.find((g) => g.sha === "sha2")!;
    assert.equal(sha1Group.canonical.id, 1);
    assert.equal(sha2Group.canonical.id, 4);
  });
});

// ---------------------------------------------------------------------------
// buildDuplicateGroupQuery
// ---------------------------------------------------------------------------

describe("buildDuplicateGroupQuery", () => {
  it("returns a non-empty SQL string", () => {
    const sql = buildDuplicateGroupQuery();
    assert.ok(typeof sql === "string");
    assert.ok(sql.trim().length > 0);
  });

  it("SQL contains HAVING COUNT(*) > 1 to filter for duplicate groups", () => {
    const sql = buildDuplicateGroupQuery();
    assert.ok(
      sql.includes("HAVING"),
      "SQL should include a HAVING clause to filter groups with > 1 row",
    );
    assert.ok(
      sql.includes("COUNT(*)"),
      "SQL should reference COUNT(*) to count duplicates",
    );
  });

  it("SQL references font_files table", () => {
    const sql = buildDuplicateGroupQuery();
    assert.ok(sql.includes("font_files"), "SQL should reference font_files table");
  });

  it("SQL contains GROUP BY sha to group duplicates", () => {
    const sql = buildDuplicateGroupQuery();
    assert.ok(sql.toLowerCase().includes("group by"), "SQL should have GROUP BY");
    assert.ok(sql.includes("sha"), "SQL should group by sha");
  });

  it("SQL is read-only (no INSERT/UPDATE/DELETE/DROP)", () => {
    const sql = buildDuplicateGroupQuery().toUpperCase();
    for (const keyword of ["INSERT", "UPDATE", "DELETE", "DROP", "TRUNCATE", "ALTER"]) {
      assert.ok(!sql.includes(keyword), `SQL must not contain ${keyword}`);
    }
  });
});
