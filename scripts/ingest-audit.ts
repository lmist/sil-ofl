/**
 * Ingest audit — reproduces every measurement in docs/INGEST_RESILIENCE.md.
 *
 *   bun --env-file=.env.local scripts/ingest-audit.ts
 *   bun --env-file=.env.local scripts/ingest-audit.ts --json
 *
 * Read-only. Never writes. Safe to run against production.
 */
import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Copy .env.example -> .env.local.");
  process.exit(1);
}
const sql = neon(url);
const asJson = process.argv.includes("--json");

type Check = { key: string; label: string; query: string };

const CHECKS: Check[] = [
  {
    key: "corpus",
    label: "Corpus size",
    query: `select (select count(*) from owners)::int owners,
                   (select count(*) from repos)::int repos,
                   (select count(*) from font_files)::int font_files,
                   (select count(distinct repo_id) from font_files)::int repos_with_files`,
  },
  {
    key: "runs",
    label: "Collection runs",
    query: `select count(*)::int runs, max(finished_at) last_finished from collection_runs`,
  },
  {
    key: "coverage",
    label: "Scan coverage",
    query: `select count(*)::int total,
                   count(*) filter (where fonts_scanned_at is null)::int never_scanned,
                   count(*) filter (where fonts_scan_error is not null)::int errored,
                   count(*) filter (where fonts_scanned_at is null
                                      and is_fontish and not is_fork and not is_archived
                                      and license_spdx in ('OFL-1.0','OFL-1.1'))::int eligible_unscanned
            from repos`,
  },
  {
    key: "freshness",
    label: "Freshness",
    query: `select max(fonts_scanned_at) newest_scan,
                   count(*) filter (where pushed_at > fonts_scanned_at)::int pushed_after_scan
            from repos`,
  },
  {
    key: "url_validity",
    label: "URL validity (expect all zero)",
    query: `select count(*) filter (where cdn_url like '% %')::int raw_space,
                   count(*) filter (where cdn_url ~ '[^\\x20-\\x7E]')::int non_ascii,
                   count(*) filter (where cdn_url !~ '@[0-9a-f]{40}/')::int not_sha_pinned
            from font_files`,
  },
  {
    key: "cdn_size_policy",
    label: "Assets above the jsDelivr limit (expect zero renderable)",
    query: `select count(*) filter (where size_bytes > 20971520)::int over_20mib,
                   count(*) filter (where size_bytes = 0)::int zero_length,
                   max(size_bytes)::bigint largest
            from font_files
            where format in ('ttf','otf','woff','woff2')`,
  },
  {
    key: "metadata",
    label: "Metadata completeness",
    query: `select count(*) filter (where family_guess is null or family_guess = '')::int missing_family,
                   count(*) filter (where weight_guess is null)::int missing_weight,
                   count(*) filter (where is_variable)::int variable_flagged
            from font_files`,
  },
  {
    key: "duplicates",
    label: "Duplicate binaries",
    query: `select coalesce(sum(n),0)::int duplicate_rows, count(*)::int duplicate_groups
            from (select sha, count(*) n from font_files where sha is not null
                  group by 1 having count(*) > 1) t`,
  },
  {
    key: "licence_recall",
    label: "Licence recall",
    query: `select count(*) filter (where license_spdx = 'OFL-1.1')::int ofl_11,
                   count(*) filter (where license_spdx = 'OFL-1.0')::int ofl_10,
                   count(*) filter (where (license_spdx is null or license_spdx = 'NOASSERTION')
                                      and is_fontish and not is_fork and not is_archived)::int unresolved_candidates
            from repos`,
  },
];

const results: Record<string, unknown> = {};
for (const check of CHECKS) {
  const rows = (await sql.query(check.query)) as Record<string, unknown>[];
  const row = rows[0] ?? {};
  results[check.key] = row;
  if (!asJson) {
    console.log(`\n${check.label}`);
    for (const [k, v] of Object.entries(row)) console.log(`  ${k.padEnd(22)} ${v}`);
  }
}
if (asJson) console.log(JSON.stringify(results, null, 2));
