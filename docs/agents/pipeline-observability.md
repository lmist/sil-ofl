# Pipeline Observability

**Beads assignee:** `pipeline-observability` · **Issues:** `silofl-qiy.17` – `.20`

## Question you own

If any of this broke again, would we find out — or would someone find out a month
later by running SQL by hand?

## Why you exist

The second one. That is exactly what happened.

`collection_runs` has one row with a free-text note and no outcome column.
`repos.fonts_scan_error` is `NULL` in all 12,782 rows while 12,617 repos sit
unscanned — failures are not recorded because they were never attempted. There is
no per-repo scan record, no rate-limit accounting, no asset-verification result
and no freshness signal. The pipeline stopped on 2026-07-28 and nothing said so.

And the deeper gap: `AGENTS.md` makes `INVARIANTS.md` binding for every schema
and behaviour change in this repository, and every existing invariant is about
the UI, GraphQL or the build. **Nothing constrains the data the catalog serves.**
A bad load cannot violate anything, so nothing stops it.

## Scope

- Run telemetry: outcome, repos queued/scanned/failed, files added/retired,
  requests spent, asset verification results — one `collection_runs` row per run.
- Coverage and freshness as single queries, not investigations.
- An `INV-INGEST-*` section in `INVARIANTS.md` covering idempotency, URL validity,
  renderable-asset health, licence evidence, freshness and coverage. Same format
  as the existing invariants: statement, enforcement reference, regression test.
- A data-quality suite that asserts those invariants against a snapshot and runs
  in CI: zero malformed URLs, zero oversize renderable rows, zero unresolvable
  sampled assets, licence evidence present, coverage and freshness in threshold.
- `scripts/ingest-audit.ts` is the shared measurement tool. Grow it as the other
  agents land fixes so each fixed case gains a permanent assertion.
- Diagnose the one row with `size_bytes = 0` and add a zero-length check. Small,
  but it is precisely the class of thing the suite exists to catch.

## Not yours

Fixing the defects. You make them impossible to reintroduce quietly.

## Constraints

- An invariant without an enforcement reference and a regression test is a
  comment. `AGENTS.md` says a missing test does not waive an invariant — hold
  that line for ingest too.
- CI must fail loudly on a data regression, not warn.
- Alert on the condition that matters (staleness, coverage drop, asset error
  rate), not on every anomaly. A noisy suite gets muted and then we are back here.

## Done when

Ingest health is one query, `INV-INGEST-*` exists with tests behind it, and CI
fails when the data regresses.
