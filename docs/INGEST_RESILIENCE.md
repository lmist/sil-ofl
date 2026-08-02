# Font ingestion: current state and resilience plan

Investigated 2026-08-02 against the live catalog database and the public CDN.
Every number below is a measurement, not an estimate. Reproduction SQL is in
`scripts/ingest-audit.ts`.

## 1. Is there a pipeline?

Partly, and not in this repository.

This repo is the read side only: Next.js → GraphQL Yoga → Pothos → Neon. It
never writes. The write side is an external collector that produced exactly one
run:

| collection_runs | value |
|---|---|
| id | 1 |
| started_at | 2026-07-28 23:11:19Z |
| finished_at | 2026-07-29 01:32:08Z |
| workers | 38 |
| cap | 1,000,000 |
| unique_count | 12,782 |
| note | `loaded from data/all.json` |

That is a one-shot bulk import, not a pipeline. There is no second run, no
schedule, no watermark, and no ingest source we control. The Go service at
`sil-ofl-fonts.vercel.app` still answers, but its source is not in `lmist/*` or
in this fork, so we cannot patch it.

**Conclusion: there is nothing to harden. The ingest layer has to be built, and
it has to be built here, in the fork, against the same Neon schema.**

The schema is already shaped for a real pipeline and the shape is unused:
`collection_runs`, `sources`, `repo_sources`, `code_evidence`,
`repos.fonts_scanned_at`, `repos.fonts_scan_error`, and the view
`v_repos_missing_fonts`. We should populate what the previous author designed
rather than invent a parallel structure.

## 2. What the data actually looks like

```
owners       8,035
repos       12,782
font_files  35,509      across only 140 distinct repos
```

### Coverage — the pipeline stalled at 1%

| measure | count |
|---|---|
| repos never font-scanned (`fonts_scanned_at IS NULL`) | 12,617 / 12,782 (98.7%) |
| repos scanned | 165 |
| repos that yielded files | 140 |
| `v_repos_missing_fonts` | 10,810 |
| OFL-eligible, fontish, non-fork, non-archived, **unscanned** | 10,706 |
| of those, ≥100 stars | 165 |

The catalog is not a catalog of 12,782 repos. It is a catalog of 140, and
21,944 of its 35,509 files (62%) come from `IBM/plex` alone. Median files per
repo is 22; the mean is 254.

### Assets — verified broken, not theoretically fragile

Every `cdn_url` points at `cdn.jsdelivr.net`. All 35,509 are pinned to a
**mutable branch** (`@main` / `@master`); zero are pinned to a commit sha, even
though `font_files.sha` is populated for every single row.

Probed live:

| case | rows | stored URL result |
|---|---|---|
| control, normal `.otf` | — | `206` |
| file > 20 MiB | 30 total, 27 in renderable formats (2 > 50 MiB, max 95 MB) | **`403`** — jsDelivr size limit |
| raw space in path | 1,909 | **invalid URL**, curl refuses it |
| same URL, space encoded | — | **`404`** — path no longer exists upstream |
| non-ASCII in path (en-dash, `:`) | 8 | **`400`** |

The 404 is the important one. `ryanoasis/nerd-fonts` restructured
`src/unpatched-fonts/AnonymousPro/` and dropped the `Bold/` level. GitHub still
serves the font; our row still points at the old path on `@master`. Branch pins
rot silently and nothing notices. That is link rot we can prove today, one
month after a single load.

### Metadata — filename inference, unverified

| measure | count |
|---|---|
| `weight_guess IS NULL` | 1,521 |
| lowercased family names claimed by >1 repo | 56 |
| rows sharing a `sha` with another row | 1,030 (503 groups) |
| rows flagged `is_variable` | 375 of 35,509 |
| `size_bytes = 0` | 1 |

Nothing reads the `name`, `OS/2`, `post` or `fvar` tables. `family_guess`,
`weight_guess`, `style_guess` and `is_variable` are all parsed out of file
names, so "Recursive" and someone's fork of Recursive collapse into one family
label.

### Licence — recall problem, not a precision problem

The public policy accepts `OFL-1.0` and `OFL-1.1` and correctly excludes
everything else. But:

- `OFL-1.1`: 11,318 repos
- `OFL-1.0`: **0** repos, and the `licenses` table has no such row — the
  accepted set contains a value the ingest path has never once produced
- `NULL`: 837 · `NOASSERTION`: 137
- of those, **78 are fontish, non-fork and non-archived** — plausible OFL fonts
  dropped because GitHub's classifier did not recognise the licence file

Repos ship `OFL.txt` constantly and GitHub often files it as `NOASSERTION`.
Reading the licence text is the fix; guessing is not.

### Observability — none

`fonts_scan_error` is `NULL` in all 12,782 rows while 12,617 repos are
unscanned. Failures are not recorded because they were never attempted. There is
no run outcome, no rate-limit accounting, no freshness signal. Nobody could have
known the pipeline stopped on 2026-07-28, and nobody did.

`INVARIANTS.md` is binding for the whole repo, and every one of its invariants
is about the UI, GraphQL or the build. Nothing constrains the data. A bad load
violates no contract.

## 3. Target design

Four properties, in dependency order.

1. **Resumable.** Work is a queue drained from `v_repos_missing_fonts`, one
   repo at a time, with per-repo terminal state. Killing the process loses one
   repo, not a run.
2. **Idempotent.** Re-running changes nothing. `UNIQUE(repo_id, path)` and
   `UNIQUE(full_name)` already exist; the writer must use them as conflict
   targets and reconcile deletions with tombstones rather than leaving dead rows.
3. **Verified.** A row is publishable only when its asset has been fetched and
   its metadata came from the binary. URL encoding, CDN size policy, sha pinning
   and a ranged HEAD are preconditions of publication, not a later sweep.
4. **Observable.** Every run writes a `collection_runs` row with an outcome and
   counts. Every repo writes a scan result or a typed error. Coverage, freshness
   and asset health are one query each, asserted in CI.

The gate on all of it is a new `INV-INGEST-*` section in `INVARIANTS.md` with
enforcement references and regression tests, in the format the existing
invariants use. Without that, item 4 is a dashboard nobody reads.

## 4. Work breakdown

Tracked in beads under epic `silofl-qiy`, 20 children across four owners.
See `docs/agents/` for the charters.

| owner | scope | issues |
|---|---|---|
| `ingest-architect` | queue, scheduling, idempotency, error taxonomy, tombstones | `.1`–`.5` |
| `asset-integrity` | URL correctness, sha pinning, CDN limits, health checks | `.6`–`.11` |
| `metadata-license` | binary metadata, OFL detection, dedup, variable axes | `.12`–`.16` |
| `pipeline-observability` | telemetry, `INV-INGEST-*`, data-quality CI | `.17`–`.20` |

`bd ready` lists all of it. `bd show silofl-qiy.7` for any single case.
