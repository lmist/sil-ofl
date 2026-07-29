import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { queryCatalogStats } from "./cached-stats";

describe("catalog statistics", () => {
  it("counts only publicly visible OFL font data", async () => {
    const calls: { text: string; params: unknown[] }[] = [];
    const sql = {
      query: async (text: string, params: unknown[] = []) => {
        calls.push({ text: normalizeSql(text), params });
        return [
          {
            repos: 12,
            font_files: 22,
            owners: 7,
            repos_with_files: 11,
          },
        ];
      },
    };

    const result = await queryCatalogStats(sql);

    assert.deepEqual(result, {
      repos: 12,
      fontFiles: 22,
      owners: 7,
      reposWithFiles: 11,
    });
    assert.equal(calls.length, 1);
    assert.match(
      calls[0]!.text,
      /WITH public_repos AS \( SELECT r\.id, r\.owner_id FROM repos r WHERE NOT r\.is_archived AND r\.is_fontish AND NOT r\.is_fork AND r\.license_spdx IN \('OFL-1\.0', 'OFL-1\.1'\) \)/,
    );
    assert.match(
      calls[0]!.text,
      /public_fonts AS \( SELECT f\.id, f\.repo_id FROM font_files f JOIN public_repos r ON r\.id = f\.repo_id WHERE f\.format IN \('ttf', 'otf', 'woff', 'woff2'\) \)/,
    );
    assert.match(
      calls[0]!.text,
      /\(SELECT COUNT\(\*\)::int FROM public_repos\) AS repos/,
    );
    assert.match(
      calls[0]!.text,
      /\(SELECT COUNT\(\*\)::int FROM public_fonts\) AS font_files/,
    );
    assert.match(
      calls[0]!.text,
      /\(SELECT COUNT\(DISTINCT owner_id\)::int FROM public_repos\) AS owners/,
    );
    assert.match(
      calls[0]!.text,
      /\(SELECT COUNT\(DISTINCT repo_id\)::int FROM public_fonts\) AS repos_with_files/,
    );
    assert.deepEqual(calls[0]!.params, []);
  });
});

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}
