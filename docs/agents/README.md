# Ingest working group

Four specialised agents own the font ingestion resilience epic (`silofl-qiy`).
The split follows the failure classes found in
[`../INGEST_RESILIENCE.md`](../INGEST_RESILIENCE.md), so each agent owns one
kind of failure end to end rather than one layer of the stack.

| agent | owns | beads assignee |
|---|---|---|
| [Ingest Architect](./ingest-architect.md) | Does the pipeline run, resume, and stay correct on re-run? | `ingest-architect` |
| [Asset Integrity](./asset-integrity.md) | Does the URL we publish actually serve a font? | `asset-integrity` |
| [Metadata & Licence](./metadata-license.md) | Is what we say about the font true? | `metadata-license` |
| [Pipeline Observability](./pipeline-observability.md) | Would we know if any of the above broke? | `pipeline-observability` |

## Working agreement

- `INVARIANTS.md` is binding (see `AGENTS.md`). An intentional contract change
  updates the invariant, its enforcement reference, and its regression test in
  the same commit.
- Beads is the only task tracker. `bd ready` to find work, `bd update <id>
  --claim` to take it, `bd close <id>` when the acceptance criteria are met.
  No TODO lists, no markdown checklists.
- Ingest code is read-only against production until its tests pass against a
  disposable database. `scripts/ingest-audit.ts` is read-only by construction
  and is the shared measurement tool — extend it rather than writing one-off SQL.
- Claims are measurements. Every number in an issue, commit message or PR body
  must be reproducible by a command someone else can run.
- Cross-cutting decisions go to Observability, because they end up as an
  invariant.

## Dependency order

Architect unblocks everyone: there is no point verifying assets for repos that
are never scanned. Observability runs alongside from day one, because the
regression suite is what stops each fixed case from coming back.

```
ingest-architect  ──┬──►  asset-integrity  ──┐
                    └──►  metadata-license ──┴──►  pipeline-observability
                                                    (invariants + CI, continuous)
```
