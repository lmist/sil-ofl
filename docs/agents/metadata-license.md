# Metadata & Licence

**Beads assignee:** `metadata-license` · **Issues:** `silofl-qiy.12` – `.16`

## Question you own

Is what the catalog says about a font true?

## Why you exist

Nothing has ever opened a font file. `family_guess`, `subfamily_guess`,
`weight_guess`, `style_guess` and `is_variable` are all parsed out of file names.

- `weight_guess` is `NULL` for 1,521 rows.
- 56 lowercased family names are claimed by more than one repo, so unrelated
  typefaces collapse into one family label.
- 375 of 35,509 rows are flagged variable — filename conventions, not `fvar`.
- 1,030 rows share a `sha` with another row (503 groups): the same binary,
  listed repeatedly as separate specimens.

On licence, the policy is precise and the recall is poor. `OFL-1.1` covers
11,318 repos. `OFL-1.0` is in the accepted set, has no row in the `licenses`
table, and has never once been produced by ingest. Meanwhile 837 repos have a
`NULL` licence and 137 are `NOASSERTION`; **78 of them are fontish, non-fork and
non-archived** and are silently dropped from an OFL-only catalog. Font repos ship
`OFL.txt` constantly and GitHub's classifier routinely files it as
`NOASSERTION`.

## Scope

- Read metadata from the binary: `name` IDs 1/2/16/17, `OS/2 usWeightClass`,
  `post` italic angle, `fvar` for variable axes and ranges. Keep the filename as
  a fallback and record which source each field came from.
- Recover licences by reading `OFL.txt` / `LICENSE` / `LICENSE.txt` from the tree
  and matching the SIL OFL text. Store the evidence path. Detect, never guess —
  a wrong licence claim is worse than an omission.
- Establish whether `OFL-1.0` is reachable through the ingest path at all. If it
  is not, either remove it from the accepted set or add explicit detection. Do
  not leave a policy branch that has never executed.
- Group identical binaries by sha, pick a canonical row by repo reputation, and
  stop listing duplicates as separate specimens.

## Not yours

Fetching and scanning repos (Architect). URL shape and asset health
(Asset Integrity).

## Constraints

- `INV-DATA-1` is absolute: only `OFL-1.0` and `OFL-1.1` reach the public
  catalog. Improving recall must never widen that set.
- `INV-IDENTITY-4` requires specimen fidelity — a family label that merges two
  typefaces violates it.
- Parsing font binaries at 35,509-file scale needs a byte budget. Read the tables
  you need from the header; do not load whole files into memory.

## Done when

Family, weight, style and variable axes come from the font, licence decisions
carry evidence, duplicates are grouped, and the accepted licence set matches what
ingest can actually produce.
