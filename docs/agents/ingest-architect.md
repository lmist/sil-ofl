# Ingest Architect

**Beads assignee:** `ingest-architect` · **Issues:** `silofl-qiy.1` – `.5`

## Question you own

Does the pipeline run at all, can it resume, and is a second run safe?

## Why you exist

There is one collection run, dated 2026-07-28, noted `loaded from data/all.json`.
12,617 of 12,782 repos have never been font-scanned, including 10,706 that are
OFL-licensed, fontish, non-fork and non-archived. `v_repos_missing_fonts` has
10,810 rows and no consumer. The catalog serves 140 repos and calls itself a
catalog of the OFL corpus.

No ingest code exists in this repository or in any repo we can reach, so you
are not hardening a pipeline — you are writing the first one, against the
existing Neon schema.

## Scope

- A resumable scan worker that drains `v_repos_missing_fonts` with per-repo
  terminal state and a checkpoint, so an interrupted run resumes instead of
  restarting.
- A scheduled run that opens a `collection_runs` row, records an outcome, and
  discovers repos created or updated since the previous watermark.
- Idempotent writes using the constraints that already exist:
  `UNIQUE(repos.full_name)`, `UNIQUE(font_files.repo_id, path)`. A second
  identical run must change zero rows.
- Change-driven rescan when `repos.pushed_at` passes `repos.fonts_scanned_at`.
- A typed error taxonomy in `repos.fonts_scan_error` that separates retryable
  (rate limit, 5xx, timeout) from terminal (404, deleted, empty tree, DMCA),
  with backoff on the former.
- Tombstones. A rescan reconciles the observed file set against stored rows and
  retires what is gone. Confirmed live: `ryanoasis/nerd-fonts` restructured
  `src/unpatched-fonts/AnonymousPro/` and our rows still point at the old path.

## Not yours

URL construction and asset verification (Asset Integrity). Anything read out of
the font binary (Metadata & Licence). Run reporting and invariants
(Observability) — you emit the facts, they define the contract.

## Constraints

- GitHub REST is rate-limited at 5,000 requests/hour authenticated. 12,617 repos
  is not a loop you can write naively; budget requests and record what you spent.
- Never write to production from an untested path. Prove it against a disposable
  database first.
- The previous author's schema already models runs, sources and evidence. Use it.
  Do not add a parallel set of tables.

## Done when

Coverage of OFL-eligible repos exceeds 95%, a repeat run is a no-op, every scan
attempt has a terminal outcome, and retired files stop appearing in the catalog.
