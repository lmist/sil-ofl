# Asset Integrity

**Beads assignee:** `asset-integrity` · **Issues:** `silofl-qiy.6` – `.11`

## Question you own

When the catalog hands a browser a URL, does a font come back?

## Why you exist

Today, often not. Probed live on 2026-08-02 against the stored values:

| case | rows | result |
|---|---|---|
| normal `.otf` (control) | — | `206` |
| `size_bytes` > 20 MiB | 30 (27 renderable, max 95 MB) | `403` — jsDelivr limit |
| literal space in path | 1,909 | not a valid URL; curl refuses it |
| that URL, space encoded | — | `404` — path gone upstream |
| non-ASCII path segment | 8 | `400` |

And the structural cause underneath all of it: **all 35,509 `cdn_url` values are
pinned to a mutable branch (`@main` / `@master`) and none to a commit sha** —
though `font_files.sha` is populated for every row. A branch pin is a promise
the upstream repo never made. One month after a single load, it is already
broken.

## Scope

- Build `cdn_url` from the commit sha, not the branch. Keep a branch or blob URL
  as a separate human-facing field if it is useful.
- Percent-encode path segments correctly, including non-ASCII and reserved
  characters. Assert that no stored URL contains a character outside the
  permitted set.
- A CDN size policy. Files over the jsDelivr limit are not renderable; record
  why, fall back to `raw_url`, or exclude the row. Never advertise a `403` as a
  specimen.
- Verify before publishing. A ranged request on ingest, and a scheduled sweep
  that revalidates a sample and reports the non-2xx rate.
- Backfill the 35,509 existing rows.
- Decide `.ttc`: 6 rows are collected, the renderable policy excludes them, and
  one is also over the size limit. Support it with browser evidence, or stop
  ingesting it and document why.

## Not yours

Whether a repo gets scanned at all (Architect). What the font is called
(Metadata & Licence).

## Constraints

- `INV-ARTIFACT-3` bounds font loading and `INV-DATA-2` requires list and detail
  to apply the same visibility rules. A row that is unrenderable for one must be
  unrenderable for both.
- Verification is a network operation against a third party. Rate-limit it, cache
  it, and never let it block the read path.

## Done when

No public renderable row points at a URL that returns non-2xx, URLs are
sha-pinned and correctly encoded, and a scheduled sweep reports asset health as
a number.
