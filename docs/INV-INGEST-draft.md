<!-- DRAFT — staged for silofl-qiy.18 — NOT YET BINDING -->
<!--
  This file is a draft of the INV-INGEST-* section for INVARIANTS.md.
  It was produced as part of silofl-qiy.20 (pipeline-observability).

  Status: DRAFT. Not yet merged into INVARIANTS.md and not yet enforced.
  The orchestrator will merge it once the other agents' contracts (upsert,
  asset-url, cdn-policy, font-metadata, dedup, scan-errors) have landed and
  the enforcement references can be filled in completely.

  Format: identical to INVARIANTS.md — same heading levels, same MUST/MUST NOT
  language, same enforcement-reference structure. The Enforcement map section
  at the bottom follows the same pattern as the existing map in INVARIANTS.md.

  Do not edit INVARIANTS.md directly; edit this file and let the orchestrator
  merge it.
-->

## Ingest pipeline and data quality

These invariants govern the correctness, completeness, and freshness of the
data the ingest pipeline writes into the Neon catalog database. They apply to
every run of the collector, every upsert, and every row visible to the public
GraphQL API.

The words **MUST**, **MUST NOT**, **SHOULD**, and **MAY** are normative. Each
invariant has a stable identifier. Code and tests reference these identifiers.
The `DQ-*` check that enforces each invariant is named in parentheses.

### INV-INGEST-IDEMPOTENCY — Repeated runs are side-effect-free

A re-run of the ingest pipeline against the same upstream state MUST produce
the same database state as the first run. Upserts MUST use `UNIQUE(repo_id,
path)` as the conflict target and MUST NOT insert duplicate rows. Deletions of
rows that no longer exist upstream MUST use tombstones or hard deletes applied
in a subsequent pass, not left as dead rows. A re-run MUST NOT create
additional `collection_runs` rows for work that was already completed.

`DQ-DUPLICATE-SHA` detects cross-repo binary duplicates that indicate an
idempotency violation in the sha-deduplication step.

### INV-INGEST-URL-VALIDITY — Every CDN URL is a well-formed, durable, sha-pinned URL

Every `cdn_url` stored in `font_files` MUST:

1. Contain no raw (unencoded) space characters. (`DQ-URL-ENCODING`)
2. Contain only printable ASCII characters (U+0020–U+007E). (`DQ-NON-ASCII`)
3. Reference a specific commit SHA (40 lowercase hex characters) in the path
   segment following the `@` sigil, not a branch name such as `main` or
   `master`. (`DQ-SHA-PINNED`) The `font_files.sha` column is always populated
   and MUST be used as the pin value.

A row that violates any of these conditions MUST NOT be written to the
database. The URL MUST be corrected before the row is inserted or updated.

Branch-pinned URLs silently rot when upstream repositories restructure.
Non-ASCII and space-containing URLs are rejected by CDN and browser HTTP
clients before any byte is transferred. Both failure modes are confirmed live
against the catalog as of 2026-08-02.

### INV-INGEST-RENDERABLE-HEALTH — Renderable assets must be fetchable

Every `font_files` row in a renderable format (`ttf`, `otf`, `woff`, `woff2`)
MUST satisfy all of the following conditions before being committed:

1. `size_bytes` MUST be greater than 0. A row with `size_bytes = 0` is an
   empty git blob (well-known SHA `e69de29bb2d1d6434b8b29ae775ad8c2e48c5391`)
   and MUST NOT be written as a renderable font file. (`DQ-ZERO-LENGTH`)
2. `size_bytes` MUST NOT exceed 20,971,520 bytes (20 MiB). jsDelivr returns
   HTTP 403 for any file above this limit; such a file cannot be loaded by any
   browser and MUST NOT be published to the public catalog. (`DQ-CDN-SIZE`)

A ranged HEAD probe (`Range: bytes=0-1`) MUST return a 2xx response before the
row is considered verified. Rows that fail a live probe MUST be flagged with
a `fonts_scan_error` entry and excluded from `v_renderable_fonts`.

### INV-INGEST-LICENCE-EVIDENCE — Licence must be resolved from text, not just the GitHub classifier

A repo MUST NOT be excluded from the catalog solely because GitHub's API
returns `NOASSERTION` or `null` for its `license.spdx_id` field. When a repo
is fontish, non-fork, and non-archived and carries `NULL` or `NOASSERTION` for
`license_spdx`, the ingest pipeline MUST attempt to read the raw licence file
from the repository root (typically `OFL.txt`, `LICENSE`, `LICENSE.txt`, or
`LICENCE`) and classify it. (`DQ-LICENCE-EVIDENCE`)

`OFL-1.0` is an accepted licence (`src/graphql/schema/public-font-policy.ts`)
and the pipeline MUST produce rows with `license_spdx = 'OFL-1.0'` when the
licence text matches. The absence of any `OFL-1.0` rows in the catalog as of
2026-08-02 is a pipeline defect, not a property of the data.

### INV-INGEST-COVERAGE — Every eligible repo must be font-scanned

Every repo with `is_fontish = true`, `is_fork = false`, `is_archived = false`,
and an accepted `license_spdx` MUST have a non-null `fonts_scanned_at`
timestamp. The view `v_repos_missing_fonts` MUST return zero rows when coverage
is complete. (`DQ-COVERAGE`)

Coverage MUST be measured and asserted in CI. The baseline of 12,617 unscanned
repos measured on 2026-08-02 is the starting point; CI MUST fail if the count
increases rather than decreases between runs.

### INV-INGEST-FRESHNESS — Scan results must not silently age

A repo whose upstream `pushed_at` timestamp is newer than its `fonts_scanned_at`
timestamp MUST be re-queued for font scanning. The ingest runner MUST update
`fonts_scanned_at` on every successful scan pass and MUST record a typed error
in `fonts_scan_error` on every failure so that staleness can be distinguished
from an absence of work. (`DQ-FRESHNESS`)

A `collection_runs` row MUST be written at the start and updated at the end of
every run, recording at minimum: `started_at`, `finished_at`, `workers`,
`unique_count`, and a machine-readable `note` or outcome field sufficient to
distinguish success, partial completion, and failure.


### INV-INGEST-RUN-TELEMETRY — Every run must open and close with a terminal outcome

A run MUST open with `outcome = 'running'` and MUST close with a terminal
outcome (`completed`, `failed`, or `aborted`). A run whose `outcome` column
is `NULL` is a crashed run, indistinguishable from a run that finished successfully
without recording its result. (`DQ-RUN-FRESHNESS`, `DQ-RUN-CRASHED`)

The `buildRunOpen` and `buildRunClose` functions in `src/ingest/telemetry.ts`
provide the parameterised SQL for opening and closing runs. The scan worker
MUST call `buildRunClose` in a `try/finally` block so that even an aborted
or failed run records a terminal outcome. A run left in `outcome = 'running'`
past `CRASHED_RUN_THRESHOLD_MINUTES` (240 minutes) is treated as a crash.

The condition that made the 2026-07-28 outage invisible was exactly this:
the run recorded `finished_at` but no `outcome`, so no automated check
could distinguish it from a completed run.

### INV-INGEST-DELIVERY — Every non-retired renderable row must have a delivery classification

Every `font_files` row with `retired_at IS NULL` and a renderable format
(`ttf`, `otf`, `woff`, `woff2`) MUST have a non-null `delivery` value
(`cdn` | `raw_fallback` | `not_renderable`). A `NULL` delivery means the
row has not been through the classification pipeline and cannot be safely
served. (`DQ-DELIVERY-CLASSIFIED`)

### INV-INGEST-RETIRED-EXCLUDED — Retired rows must never appear in the public catalog

A row with `retired_at IS NOT NULL` MUST NOT appear in any public GraphQL
query, font list, or detail view. The public visibility clauses from
`src/graphql/schema/public-font-policy.ts` do not include a `retired_at IS
NULL` guard as of 2026-08-02 — the tombstone path has not landed — but MUST
add one when the tombstone path is active. (`DQ-RETIRED-EXCLUDED`)

---

## Enforcement map — Ingest pipeline and data quality

- `INV-INGEST-IDEMPOTENCY` — Production:
  [upsert logic](src/ingest/upsert.ts) and
  [deduplication](src/ingest/dedup.ts).
  Regression: [data-quality check suite](src/ingest/data-quality.test.ts)
  via `DQ-DUPLICATE-SHA`, and
  [ingest-checks runner](scripts/ingest-checks.ts).

- `INV-INGEST-URL-VALIDITY` — Production:
  [asset URL construction](src/ingest/asset-url.ts) and
  [CDN policy](src/ingest/cdn-policy.ts).
  Regression: [data-quality check suite](src/ingest/data-quality.test.ts)
  via `DQ-URL-ENCODING`, `DQ-NON-ASCII`, and `DQ-SHA-PINNED`, and
  [ingest-checks runner](scripts/ingest-checks.ts).

- `INV-INGEST-RENDERABLE-HEALTH` — Production:
  [asset URL construction](src/ingest/asset-url.ts),
  [CDN policy](src/ingest/cdn-policy.ts), and
  [font metadata](src/ingest/font-metadata.ts).
  Regression: [data-quality check suite](src/ingest/data-quality.test.ts)
  via `DQ-ZERO-LENGTH` and `DQ-CDN-SIZE`, and
  [ingest-checks runner](scripts/ingest-checks.ts).

- `INV-INGEST-LICENCE-EVIDENCE` — Production:
  [font metadata](src/ingest/font-metadata.ts) and
  [upsert logic](src/ingest/upsert.ts).
  Regression: [data-quality check suite](src/ingest/data-quality.test.ts)
  via `DQ-LICENCE-EVIDENCE`, and
  [ingest-checks runner](scripts/ingest-checks.ts).

- `INV-INGEST-COVERAGE` — Production:
  [font metadata](src/ingest/font-metadata.ts),
  [upsert logic](src/ingest/upsert.ts), and
  [scan error recording](src/ingest/scan-errors.ts).
  Regression: [data-quality check suite](src/ingest/data-quality.test.ts)
  via `DQ-COVERAGE`, and
  [ingest-checks runner](scripts/ingest-checks.ts).

- `INV-INGEST-FRESHNESS` — Production:
  [scan error recording](src/ingest/scan-errors.ts) and
  [upsert logic](src/ingest/upsert.ts).
  Regression: [data-quality check suite](src/ingest/data-quality.test.ts)
  via `DQ-FRESHNESS`, and
  [ingest-checks runner](scripts/ingest-checks.ts).

- `INV-INGEST-RUN-TELEMETRY` — Production:
  [telemetry](src/ingest/telemetry.ts) (`buildRunOpen`, `buildRunClose`,
  `buildHealthQuery`, `evaluateHealth`).
  Regression: [telemetry tests](src/ingest/telemetry.test.ts) and
  [data-quality check suite](src/ingest/data-quality.test.ts)
  via `DQ-RUN-FRESHNESS` and `DQ-RUN-CRASHED`, and
  [ingest-checks runner](scripts/ingest-checks.ts).

- `INV-INGEST-DELIVERY` — Production:
  [CDN policy](src/ingest/cdn-policy.ts) (`classifyDelivery`).
  Regression: [data-quality check suite](src/ingest/data-quality.test.ts)
  via `DQ-DELIVERY-CLASSIFIED`, and
  [ingest-checks runner](scripts/ingest-checks.ts).

- `INV-INGEST-RETIRED-EXCLUDED` — Production:
  [public-font-policy](src/graphql/schema/public-font-policy.ts) (must add
  `retired_at IS NULL` clause when tombstone path lands).
  Regression: [data-quality check suite](src/ingest/data-quality.test.ts)
  via `DQ-RETIRED-EXCLUDED`, and
  [ingest-checks runner](scripts/ingest-checks.ts).
