/**
 * ingest-licence-recover.ts
 *
 * Licence recovery for repos where GitHub reported NULL or NOASSERTION.
 *
 * Selects fontish, non-fork, non-archived repos with NULL/NOASSERTION
 * licence_spdx, fetches candidate licence files from the GitHub Contents
 * API, runs the OFL text detector, and writes results to:
 *   repos.license_detected_spdx
 *   repos.license_evidence_path
 *   repos.license_detected_at
 *
 * NEVER writes repos.license_spdx — that column is GitHub's classification.
 * Our detection result stays in its own column so both remain auditable.
 *
 * Usage:
 *   bun --env-file=.env.local scripts/ingest-licence-recover.ts
 *   bun --env-file=.env.local scripts/ingest-licence-recover.ts --apply
 *   bun --env-file=.env.local scripts/ingest-licence-recover.ts --apply --limit 10
 *
 * Flags:
 *   --dry-run    Default: true. Print what would be written without writing.
 *   --apply      Disable dry-run and actually write to the database.
 *   --limit <n>  Process at most n repos (default: all 78).
 */

import { neon } from "@neondatabase/serverless";
import { detectOflFromText, candidateLicencePaths } from "../src/ingest/license-detect.js";

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const dryRun = !apply;

const limitIdx = args.indexOf("--limit");
const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1] ?? "9999", 10) : 9999;

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set. Run with: bun --env-file=.env.local ...");
  process.exit(1);
}

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
if (!GITHUB_TOKEN) {
  console.error("GITHUB_TOKEN is not set.");
  process.exit(1);
}

const sql = neon(DATABASE_URL);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CandidateRepo {
  id: number;
  full_name: string;
  license_spdx: string | null;
  stars: number;
}

interface RepoResult {
  repoId: number;
  fullName: string;
  spdx: string | null;
  evidencePath: string | null;
  matchedOn: string[] | null;
  fetchedPaths: string[];
  error: string | null;
}

// ---------------------------------------------------------------------------
// GitHub Contents API
// ---------------------------------------------------------------------------

/**
 * Fetch the text content of a file from a GitHub repo via the Contents API.
 * Returns the decoded text or null if the file doesn't exist or errors.
 *
 * Uses the raw download_url from the API response to avoid base64 decoding.
 */
async function fetchGitHubFileText(
  fullName: string,
  path: string,
): Promise<string | null> {
  const url = `https://api.github.com/repos/${fullName}/contents/${path}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "sil-ofl-ingest/1.0",
    },
  });

  if (res.status === 404) return null;
  if (!res.ok) {
    // Rate limit or other error — propagate so caller can handle
    throw new Error(`GitHub API ${res.status} for ${fullName}/${path}`);
  }

  const data = await res.json() as {
    type?: string;
    download_url?: string | null;
    encoding?: string;
    content?: string;
  };

  // Directories or submodules
  if (data.type !== "file") return null;

  // Use download_url for raw text (avoids base64 decoding for large files)
  if (data.download_url) {
    const raw = await fetch(data.download_url, {
      headers: { "User-Agent": "sil-ofl-ingest/1.0" },
    });
    if (!raw.ok) return null;
    return await raw.text();
  }

  // Fall back to base64 content field
  if (data.encoding === "base64" && data.content) {
    const b64 = data.content.replace(/\n/g, "");
    return Buffer.from(b64, "base64").toString("utf-8");
  }

  return null;
}

// ---------------------------------------------------------------------------
// Per-repo recovery
// ---------------------------------------------------------------------------

async function recoverRepo(repo: CandidateRepo): Promise<RepoResult> {
  const paths = candidateLicencePaths();
  const fetchedPaths: string[] = [];

  for (const path of paths) {
    let text: string | null = null;
    try {
      text = await fetchGitHubFileText(repo.full_name, path);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Rate-limit: stop and surface
      if (msg.includes("403") || msg.includes("429")) {
        return {
          repoId: repo.id,
          fullName: repo.full_name,
          spdx: null,
          evidencePath: null,
          matchedOn: null,
          fetchedPaths,
          error: `GitHub API rate limit or auth error at ${path}: ${msg}`,
        };
      }
      // Other errors: skip this path
      continue;
    }

    if (text === null) continue;
    fetchedPaths.push(path);

    const result = detectOflFromText(text);
    if (result !== null) {
      return {
        repoId: repo.id,
        fullName: repo.full_name,
        spdx: result.spdx,
        evidencePath: path,
        matchedOn: result.matchedOn,
        fetchedPaths,
        error: null,
      };
    }

    // Text found but did not match a known OFL version — keep trying other paths
  }

  return {
    repoId: repo.id,
    fullName: repo.full_name,
    spdx: null,
    evidencePath: null,
    matchedOn: null,
    fetchedPaths,
    error: null,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(`ingest-licence-recover — ${dryRun ? "DRY RUN (no writes)" : "APPLY mode"}`);
  if (limit < 9999) console.log(`Limit: ${limit} repos`);
  console.log();

  // Load candidate repos
  const repos = (await sql`
    SELECT id, full_name, license_spdx, stars
    FROM repos
    WHERE (license_spdx IS NULL OR license_spdx = 'NOASSERTION')
      AND is_fontish = true
      AND is_fork = false
      AND is_archived = false
    ORDER BY stars DESC
    LIMIT ${limit}
  `) as CandidateRepo[];

  console.log(`Candidates: ${repos.length} repos`);
  console.log();

  const results: RepoResult[] = [];
  let resolved11 = 0;
  let resolved10 = 0;
  let unresolved = 0;
  let errors = 0;

  for (let i = 0; i < repos.length; i++) {
    const repo = repos[i]!;
    process.stdout.write(
      `[${i + 1}/${repos.length}] ${repo.full_name} (${repo.license_spdx ?? "null"}, ${repo.stars}★) ... `
    );

    const result = await recoverRepo(repo);

    if (result.error) {
      console.log(`ERROR: ${result.error}`);
      errors++;
      results.push(result);
      continue;
    }

    if (result.spdx) {
      console.log(`→ ${result.spdx} (${result.evidencePath})`);
      if (result.spdx === "OFL-1.1") resolved11++;
      else if (result.spdx === "OFL-1.0") resolved10++;

      if (!dryRun) {
        await sql`
          UPDATE repos
          SET
            license_detected_spdx = ${result.spdx},
            license_evidence_path  = ${result.evidencePath},
            license_detected_at    = now()
          WHERE id = ${result.repoId}
        `;
      }
    } else {
      const checked = result.fetchedPaths.length > 0
        ? `checked ${result.fetchedPaths.join(", ")}`
        : "no candidate files found";
      console.log(`→ unresolved (${checked})`);
      unresolved++;

      // Record that this candidate WAS examined even though nothing matched.
      // Without this stamp, "examined and correctly not OFL" is
      // indistinguishable from "never looked at": the candidate would be
      // re-fetched on every run, and DQ-LICENCE-EVIDENCE could not tell a
      // backlog from a settled exclusion. license_detected_spdx stays NULL —
      // INV-INGEST-5 requires a weak match to resolve to nothing.
      if (!dryRun) {
        await sql`
          UPDATE repos
          SET license_detected_at = now()
          WHERE id = ${result.repoId}
        `;
      }
    }

    results.push(result);

    // Small delay to avoid secondary rate limit (GitHub allows ~5000 req/hr
    // on the Contents API; we make at most 16 requests per repo)
    await new Promise((r) => setTimeout(r, 200));
  }

  console.log();
  console.log("=== Results ===");
  console.log(`OFL-1.1 resolved:  ${resolved11}`);
  console.log(`OFL-1.0 resolved:  ${resolved10}`);
  console.log(`Unresolved:        ${unresolved}`);
  console.log(`Errors:            ${errors}`);
  console.log(`Total processed:   ${repos.length}`);
  if (dryRun) {
    console.log();
    console.log("Dry run — no database writes. Re-run with --apply to write.");
  } else {
    console.log(`\nWrote ${resolved11 + resolved10} rows to repos.license_detected_spdx.`);
  }

  // Report on OFL-1.0 reachability (bead .14)
  console.log();
  console.log("=== OFL-1.0 reachability (.14) ===");
  if (resolved10 === 0) {
    console.log("No repos resolved to OFL-1.0 in this run.");
    const ofl10Repos = results.filter((r) => r.spdx === "OFL-1.0");
    if (ofl10Repos.length === 0) {
      console.log("Recommendation: OFL-1.0 may not be reachable through this path.");
      console.log("See report section in the session summary for full analysis.");
    }
  } else {
    const ofl10Repos = results.filter((r) => r.spdx === "OFL-1.0");
    console.log(`OFL-1.0 found in ${resolved10} repo(s):`);
    for (const r of ofl10Repos) {
      console.log(`  ${r.fullName} — ${r.evidencePath}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
