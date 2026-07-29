import { unstable_cache } from "next/cache";
import { getSql } from "@/lib/db";

export type CatalogStats = {
  repos: number;
  fontFiles: number;
  owners: number;
  reposWithFiles: number;
};

/**
 * Neon aggregate counts for the catalog header / GraphQL `stats` field.
 * Cached on the server (Data Cache) so warm requests avoid repeated COUNTs.
 *
 * Revalidate every 60s — counts change slowly; p95 target < 100ms warm.
 */
async function queryCatalogStats(): Promise<CatalogStats> {
  const sql = getSql();
  const rows = await sql`
    SELECT
      (SELECT COUNT(*)::int FROM repos) AS repos,
      (SELECT COUNT(*)::int FROM font_files) AS font_files,
      (SELECT COUNT(*)::int FROM owners) AS owners,
      (SELECT COUNT(DISTINCT repo_id)::int FROM font_files) AS repos_with_files
  `;
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
  ["catalog-stats"],
  {
    revalidate: 60,
    tags: ["catalog-stats"],
  },
);
