import { unstable_cache } from "next/cache";
import { getSql } from "@/lib/db";
import {
  PUBLIC_RENDERABLE_FONT_CLAUSE,
  publicRepoVisibilityClauses,
} from "@/graphql/schema/public-font-policy";

export type CatalogStats = {
  repos: number;
  fontFiles: number;
  owners: number;
  reposWithFiles: number;
};

export type CatalogStatsSql = {
  query(
    text: string,
    params?: unknown[],
  ): Promise<readonly Record<string, unknown>[]>;
};

/**
 * Neon aggregate counts for the catalog header / GraphQL `stats` field.
 * Cached on the server (Data Cache) so warm requests avoid repeated COUNTs.
 *
 * Revalidate every 60s — counts change slowly; p95 target < 100ms warm.
 */
export async function queryCatalogStats(
  sql: CatalogStatsSql = getSql(),
): Promise<CatalogStats> {
  const query = `
    WITH public_repos AS (
      SELECT r.id, r.owner_id
      FROM repos r
      WHERE ${publicRepoVisibilityClauses().join("\n        AND ")}
    ),
    public_fonts AS (
      SELECT f.id, f.repo_id
      FROM font_files f
      JOIN public_repos r ON r.id = f.repo_id
      WHERE ${PUBLIC_RENDERABLE_FONT_CLAUSE}
    )
    SELECT
      (SELECT COUNT(*)::int FROM public_repos) AS repos,
      (SELECT COUNT(*)::int FROM public_fonts) AS font_files,
      (SELECT COUNT(DISTINCT owner_id)::int FROM public_repos) AS owners,
      (SELECT COUNT(DISTINCT repo_id)::int FROM public_fonts) AS repos_with_files
  `;
  const rows = await sql.query(query);
  const row = rows[0] as
    | {
        repos: number;
        font_files: number;
        owners: number;
        repos_with_files: number;
      }
    | undefined;

  if (!row) {
    return { repos: 0, fontFiles: 0, owners: 0, reposWithFiles: 0 };
  }

  return {
    repos: row.repos,
    fontFiles: row.font_files,
    owners: row.owners,
    reposWithFiles: row.repos_with_files,
  };
}

export const getCachedCatalogStats = unstable_cache(
  queryCatalogStats,
  ["catalog-stats-ofl-v1"],
  {
    revalidate: 60,
    tags: ["catalog-stats"],
  },
);
