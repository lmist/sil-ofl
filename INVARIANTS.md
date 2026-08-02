# Application invariants

These statements are the hard contract for the SIL OFL Fonts application.
They apply to the browser UI, URL state, GraphQL schema and transport, data
queries, copied artifacts, and developer workflows.

The words **MUST**, **MUST NOT**, **SHOULD**, and **MAY** are normative. Each
invariant has a stable identifier. Code and tests reference these identifiers.

## Catalog identity and state

### INV-IDENTITY-1 — One selected font

At most one font MUST be selected. When a font is selected, the selected row,
`font` URL parameter, specimen metadata, rendered face, and use panel MUST
identify that same font.

Transient hover or focus preview MAY render another face only when it is
visually identified as a preview and MUST NOT replace selected metadata, copied
snippets, or the selected URL.

### INV-IDENTITY-2 — Deep links are complete

A valid `font` URL parameter MUST either hydrate enough font detail to render a
coherent specimen and use panel or be removed with a safe explanation. The UI
MUST NOT claim a selection that it cannot represent.

### INV-IDENTITY-3 — Reset is atomic

Every visible deselect, clear-all, or reset action MUST clear the selected row,
selected URL, specimen identity, face state, and use panel together. Filter-only
removal MUST leave selection intact unless the action is explicitly labeled as
a full reset.

### INV-IDENTITY-4 — Specimen fidelity

The specimen MUST apply the selected face's resolved family, weight, and style.
Metadata, computed CSS, snippets, and download links MUST agree.

### INV-IDENTITY-5 — Superseded work cannot win

A superseded font request, face load, search, or navigation MUST NOT commit
after a newer request for the same surface. Aborted work MUST remain
observationally inert, including during client retry backoff. Only the exact
active catalog query MAY revise selected metadata; inactive, disabled, cached,
or draft-query data and events MUST be inert across every selected surface.

## Filters, sorting, and URL state

### INV-FILTER-1 — Input and request agree

Every committed displayed filter value MUST equal the normalized value used in
the query. A focused search control MAY retain outer whitespace as a transient
edit draft so a paused word separator is not deleted; that draft MUST only
reach the URL, query key, and GraphQL request in normalized form and MUST
normalize visibly on blur or explicit commit. Invalid, ambiguous, non-finite,
negative, fractional, or out-of-range numeric input MUST be rejected or
normalized visibly before it becomes active.

### INV-FILTER-2 — Actions use current state

Toggle and removal actions MUST transition from current machine state, not a
stale render closure. Repeated rapid actions MUST have deterministic parity.

### INV-FILTER-3 — Every sort is representable

Every sort state reachable from any control MUST have a matching value and
label in every controlled sort UI. A controlled select MUST never hold a value
for which it has no option.

### INV-FILTER-4 — URL round trips

All URL-backed state MUST round-trip through parse and serialize without loss.
Removing a parameter MUST clear its corresponding state. Same-route browser
Back and Forward navigation MUST converge the machine and URL.

### INV-FILTER-5 — URL persistence is explicit

Shareable catalog state is `q`, `format`, `owner`, `after`, non-default `sort`,
and `font`. Session-only state is minimum stars, Webfont-only, Variable-only,
dense mode, and specimen text. Moving state between these sets is a contract
change and requires updated stories and tests.

### INV-FILTER-6 — Arbitrary text is layout-safe

User-controlled search, owner, filenames, family names, repository names, and
active-filter labels MUST NOT create document-level horizontal overflow at any
supported viewport. Browser-visible safe error copy MUST remain layout-safe and
MUST comply with `INV-ERROR-1`; arbitrary backend error text MUST NOT be
rendered merely to exercise containment.

## Pagination and result truth

### INV-PAGE-1 — A cursor is consumed once

A forward cursor MUST be pushed at most once. Previous navigation MUST pop at
most one entry. Controls MUST be unavailable while the destination cursor or
page identity is unresolved.

### INV-PAGE-2 — Page labels are truthful

The displayed page number, Previous availability, current cursor, visible rows,
and URL cursor MUST describe the same settled page. During a replacement fetch
permitted by `INV-PAGE-6`, the displayed page number, current cursor, and URL
cursor MAY describe the pending destination while visible rows retain the
previous settled page only when those rows are explicitly labeled as retained,
the result surface is marked busy or placeholder, and pagination actions are
locked. Once the request settles, every page-identity field and the visible rows
MUST transition atomically. A deep-linked non-empty cursor MUST NOT be presented
as Page 1 with Previous disabled.

### INV-PAGE-3 — Criteria reset the cursor

Changing search, format, owner, stars, boolean filters, or sort MUST reset
pagination to the first page and clear the cursor stack.

### INV-PAGE-4 — Keyset traversal is lossless

For every supported sort and nullable sort value, traversing pages MUST return
each matching row exactly once: no omissions, repeats, or reorderings between
adjacent pages.

### INV-PAGE-5 — Count and rows share a predicate

`totalCount` MUST use exactly the same public visibility and active filter
predicate as the returned edges, excluding only cursor and page limit.

### INV-PAGE-6 — Retained data is labeled

Placeholder or retained rows MAY remain visible during replacement work, but
MUST be identified as loading or stale. They MUST NOT be presented as current
success after a replacement request fails.

## Errors and recovery

### INV-ERROR-1 — Safe messages only

Browser-visible errors MUST NOT contain GraphQL documents, variables, response
bodies, stack traces, SQL, environment values, credentials, or internal
implementation details.

### INV-ERROR-2 — Expected failure is actionable

Initial load, statistics, refetch, pagination, face load, clipboard, and
malformed URL failures MUST expose an accessible status and an appropriate
Retry, Reset, or alternative action. Statistics failure MUST NOT prevent
catalog use, and its recovery action MUST retry statistics without replacing
the catalog request.

### INV-ERROR-3 — Recovery works in every view

List and dense modes MUST offer equivalent failure and recovery behavior.
Retry MUST request the current state and clear the stale error only after
success.

### INV-ERROR-4 — Clipboard success is confirmed

The UI MUST report copied state only after a clipboard API confirms success.
A rejected promise or `execCommand("copy") === false` MUST be reported as
failure.

## Public data and GraphQL

### INV-DATA-1 — The public catalog is OFL-only

Every public font list, detail, total, and catalog statistic MUST use the
documented accepted SIL Open Font License set. Rows with unknown,
`NOASSERTION`, Apache, proprietary, or other licenses MUST NOT appear.

The accepted set is `OFL-1.0` and `OFL-1.1`.

### INV-DATA-2 — Visibility is consistent

Public list and detail operations MUST apply the same archived, fontish,
renderable-format, and license visibility rules unless an intentional
difference is documented in the schema.

### INV-DATA-3 — SQL stays parameterized

User-controlled values MUST remain bound parameters. Dynamic SQL identifiers
and ordering MUST originate only from closed, reviewed enums.

### INV-GQL-1 — Schema and clients agree

GraphQL nullability, scalar ranges, enum values, defaults, and handwritten or
generated client types MUST agree. The generated SDL and every shipped
operation MUST be contract-tested.

### INV-GQL-2 — Pagination is bounded

Connection page size MUST have an explicit validated policy with a maximum of
100. Invalid cursors, identifiers, variables, and other malformed client input
MUST fail as safe client input, not as internal server errors.

### INV-GQL-3 — Liveness is database-independent

The `health` operation is a process liveness check and MUST execute without
initializing the database. Database readiness, when exposed, MUST be a distinct
contract.

### INV-GQL-4 — Shared caching is earned

Only a successful, anonymous, cache-safe GET operation selected from a parsed
GraphQL document MAY receive shared public cache headers. POST responses,
validation errors, execution errors, malformed input, authenticated requests,
and cookie-varying responses MUST be private `no-store`.

### INV-GQL-5 — CORS is explicit

The API MUST NOT reflect arbitrary origins with credentials. Allowed origins,
methods, headers, and credentials MUST be explicit, and every negotiated
request dimension MUST be retained in `Vary`.

### INV-GQL-6 — Production internals stay private

Production MUST NOT expose GraphiQL, raw unexpected errors, database details, or
secrets. Development diagnostics MUST NOT change cache or CORS safety.

### INV-GQL-7 — One request has bounded work

GraphQL document bytes, nesting, field count, aliases, and repeated expensive
root connections MUST have explicit server-enforced limits. An over-budget
request MUST be rejected before resolver or database work and MUST receive
private `no-store` caching.

### INV-GQL-8 — Executed operations return sanitized JSON

The query-only API MUST execute operations through a JSON result processor.
Requests that cannot negotiate `application/graphql-response+json` or
`application/json` MUST receive a safe private `406` response before execution.
Negotiation MUST parse quoted values and valid media-range grammar, honor valid
unquoted quality weights in any parameter position, retain every non-quality
parameter's specificity, and recognize only SP/HTAB as HTTP optional
whitespace. RFC-valid empty parameter slots MUST remain no-ops. The policy MUST
apply to early request failures as well as execution results. SSE, multipart,
invalid wildcard, whitespace, or quality parameters MUST NOT bypass error
sanitization. Development GraphiQL MAY serve HTML before an operation is
submitted only for a genuinely acceptable parsed `text/html` range, and its
quality MUST NOT lose to an acceptable JSON representation. Its declared
`Content-Type` parameters MUST match the representation used during
negotiation.

### INV-GQL-9 — Request media types are unambiguous UTF-8

GraphQL POST requests MUST declare one supported media type and UTF-8-compatible
encoding. Combined or conflicting `Content-Type` values and unsupported
charsets MUST receive a safe private `415` before body parsing or execution.
Valid media-type casing, optional whitespace, and quoted UTF-8 charset spelling
MUST retain equivalent behavior.

## Accessibility and interaction

### INV-A11Y-1 — Valid semantics

Native interactive elements MUST retain valid semantics. ARIA roles and
attributes MUST be supported by the element or composite widget on which they
appear. An interactive control's accessible name MUST contain its visible
label. List and dense modes MUST pass automated ARIA validation.

### INV-A11Y-2 — Keyboard parity

Every pointer action MUST have an equivalent keyboard path. Focus order MUST be
logical, focus indication MUST be visible, and row selection MUST work with
Enter and Space where the control contract advertises both.

### INV-A11Y-3 — One page heading

The catalog route MUST expose one descriptive level-one heading and a unique,
descriptive document title.

### INV-A11Y-4 — Perceivable content

Normal text MUST meet WCAG 2.2 AA contrast. Interactive targets MUST be at
least 24 by 24 CSS pixels without target overlap. Information MUST NOT rely on
color alone.

### INV-A11Y-5 — Announcements are scoped

Loading, result-count, copied, and error announcements MUST be concise and
non-duplicative. Decorative or redundant text MUST NOT create competing live
regions.

### INV-A11Y-6 — Responsive access

At 320 CSS pixels and above, all primary tasks MUST remain available without
document-level horizontal scrolling. Dense data regions MAY scroll internally.
At 200% zoom, controls and text MUST NOT overlap or become unreachable. Header
content, including the statistics recovery surface, MUST reflow without
overlapping or clipping the following filter controls.

### INV-A11Y-7 — Reduced motion

Non-essential motion and transitions MUST honor `prefers-reduced-motion`.

## Generated artifacts and external actions

### INV-ARTIFACT-1 — Copied code is valid

CSS, HTML, React, URLs, and other copied artifacts MUST be syntactically valid
for their labeled target and MUST describe the selected font.

### INV-ARTIFACT-2 — External links are safe

Repository, raw, CDN, and download targets MUST use policy-approved HTTPS
origins. New-tab links MUST prevent opener access.

### INV-ARTIFACT-3 — Font loading is bounded

Font loading MUST use the selected record's approved CDN URL and MAY fall back
once to its approved raw URL. Failure MUST stop with a recoverable state; it
MUST NOT loop or silently load an unrelated face. Equivalent hover, focus, and
selection events for the current face MUST NOT start duplicate face work.

## Repository and verification

### INV-REPO-1 — Bun is authoritative

JavaScript and TypeScript setup, development, tests, and build commands MUST use
Bun. The repository MUST carry one authoritative Bun lockfile and declare its
Bun package manager version. Automated JavaScript dependency version updates
MUST use Dependabot's Bun ecosystem. Routine automated version-update pull
requests MUST be limited to SemVer minor and patch releases. Coupled runtimes,
including React and React DOM, MUST update atomically; major migrations MUST be
deliberate and validated against their consumers' peer ranges.

### INV-REPO-2 — Workspaces are isolated

Conductor workspaces MUST start from the repository root, copy only explicitly
listed local environment files, and use their allocated `CONDUCTOR_PORT` range.
Parallel workspaces MUST NOT share a fixed development port.

### INV-REPO-3 — Quality gates stay green

`bun run audit`, `bun run lint`, `bun run typecheck`, `bun run test`,
`bun run test:e2e`, and `bun run build` MUST pass before integration. A bug fix
MUST include a regression test that failed against the faulty behavior and
passes with the fix. A gate runner with an active child MUST forward every
registered termination signal until cleanup, remove its signal listeners
during cleanup, and retain the first received signal as the parent outcome.

### INV-REPO-4 — Browser tests use public semantics

Browser tests MUST locate interactive behavior through accessible roles and
names or an explicitly documented public DOM contract. Tests MUST NOT require
an overriding accessible label that conflicts with visible content, and
screen-reader-only instructions MUST NOT be mistaken for application identity.
## Ingest pipeline and data quality

These invariants govern the correctness, completeness, and freshness of the data
the ingest pipeline writes into the catalog database. They apply to every
collector run, every upsert, and every row the public GraphQL API can reach.

### INV-INGEST-1 — Re-running changes nothing

A run against unchanged upstream state MUST leave the database byte-identical.
Upserts MUST use the existing unique constraints as conflict targets and MUST
guard the update so unchanged rows are not written. Metadata read from a font
binary MUST NOT be overwritten by a filename guess, and an upsert carrying a
null MUST NOT erase a populated value.

### INV-INGEST-2 — Stored asset URLs are well formed

Every `cdn_url` and `raw_url` MUST be a valid URL. Path segments MUST be
percent-encoded. A stored URL MUST NOT contain a raw space or a character
outside printable ASCII. A row whose URL cannot be constructed validly MUST NOT be
published.

Unencoded URLs are not merely untidy: an HTTP client refuses them before any
byte is transferred, and non-ASCII segments are rejected by the CDN with `400`.

### INV-INGEST-3 — Published assets are pinned to an immutable ref

A published asset URL MUST reference an immutable commit-ish — the commit sha
resolved when the repository was scanned — and MUST NOT reference a mutable
branch such as `main` or `master`.

`font_files.sha` MUST NOT be used as the pin. It is the git **blob** sha of the
file, not a commit. Verified against the live CDN on 2026-08-02: the branch ref
returned `206`, the identical path with the blob sha as ref returned `404`, and
GitHub's commit API does not recognise the value as a commit object. The pin
therefore originates only from the scan that resolved the repository's head
commit, which is why immutability arrives with coverage rather than as a
standalone URL migration.

Branch pins rot silently. Measured on a 500-row sample: every `404` was a
branch-pinned row whose upstream path had moved, while every row already
rescanned onto a commit sha returned `206`.

### INV-INGEST-4 — A renderable row can actually be fetched

Every non-retired row in a renderable format MUST carry a delivery
classification recording whether it is CDN-servable, must fall back to
`raw_url`, or is not renderable at all, together with a machine-readable reason.

A file above the CDN size limit MUST NOT be advertised as CDN-servable; the CDN
answers `403`. A zero-length blob MUST NOT be published — the canonical git
empty-blob sha is not a font.

### INV-INGEST-5 — Licence claims carry evidence

A licence MUST be either reported by the upstream host or resolved by matching
licence text, and a text-resolved licence MUST record the repository path that
produced it. A weak or ambiguous match MUST resolve to nothing.

Recovered licences MUST be stored separately from the upstream classification so
the two remain distinguishable and auditable. `INV-DATA-1` is unaffected: only
the accepted OFL set reaches the public catalog, and improving recall MUST NOT
widen that set.

### INV-INGEST-6 — Every eligible repository is scanned

Every repository eligible for the public catalog MUST reach a terminal scan
outcome. Every scan attempt MUST record either a success timestamp or a
classified error; a repository MUST NOT be left silently unattempted.

Retryable failures — rate limiting, `5xx`, timeouts — MUST be distinguished from
terminal ones and retried with bounded backoff. Terminal failures MUST NOT be
retried indefinitely.

### INV-INGEST-7 — Every run opens and closes

Every run MUST create a run record before doing work and MUST close it with a
terminal outcome and its counters. A run left open past the expected window MUST
be treated as crashed, not as healthy or absent.

Ingest health — last outcome, freshness, coverage, failures by class, asset
verification rate — MUST be answerable in a single query.

### INV-INGEST-8 — Retired rows are never public

A file whose path a **completed** rescan no longer observes upstream MUST be
retired rather than deleted, and a retired row MUST NOT appear in any public
list, detail, total, or statistic.

Retirement MUST NOT run on an incomplete observation. A truncated tree, an
errored scan, or an unreachable repository MUST retire nothing — that
distinction is what stops a transient upstream failure from emptying the
catalog. A retired path that reappears MUST be restored, not duplicated.

### INV-INGEST-9 — Data quality is asserted, not assumed

Each invariant above MUST have a corresponding automated check with an explicit
threshold, and those checks MUST run against the catalog on a schedule and in
CI. A check MUST fail loudly rather than warn.

A threshold MUST record the value measured when it was set, so a reader can see
both the target and the starting point. A check that passes on known-bad data is
not enforcement.

## Enforcement map

Every stable invariant is mapped to production enforcement and retained
regressions. A contract change MUST update the relevant entry and its linked
tests in the same commit.

### Identity

- `INV-IDENTITY-1` — Production: [catalog machine](src/machines/catalog-machine.ts),
  [specimen machine](src/machines/specimen-machine.ts),
  [catalog shell](src/hooks/use-font-catalog-shell.ts), and
  [specimen controller](src/hooks/use-font-specimen.ts). Regressions:
  [catalog machine tests](src/machines/catalog-machine.test.ts),
  [catalog state browser suite](e2e/catalog-state.spec.ts), and
  [specimen/export browser suite](e2e/specimen-export.spec.ts).
- `INV-IDENTITY-2` — Production: [URL codec](src/machines/catalog-url.ts),
  [catalog URL controller](src/hooks/use-catalog-machine.ts),
  [catalog shell](src/hooks/use-font-catalog-shell.ts),
  [specimen machine](src/machines/specimen-machine.ts), and
  [font fetch actor](src/machines/actors/fetch-fonts.ts). Regressions:
  [URL codec tests](src/machines/catalog-url.test.ts),
  [specimen machine tests](src/machines/specimen-machine.test.ts), and
  [catalog state browser suite](e2e/catalog-state.spec.ts).
- `INV-IDENTITY-3` — Production:
  [catalog machine](src/machines/catalog-machine.ts),
  [specimen machine](src/machines/specimen-machine.ts),
  [font-face loader](src/machines/actors/load-font-face.ts),
  [catalog shell](src/hooks/use-font-catalog-shell.ts), and
  [filter chip controller](src/hooks/use-filter-chips.ts). Regressions:
  [catalog machine tests](src/machines/catalog-machine.test.ts),
  [font-face loader tests](src/machines/load-font-face.test.ts),
  [catalog state browser suite](e2e/catalog-state.spec.ts), and
  [specimen/export browser suite](e2e/specimen-export.spec.ts).
- `INV-IDENTITY-4` — Production:
  [font-face descriptors](src/lib/font-face-descriptors.ts),
  [specimen machine](src/machines/specimen-machine.ts),
  [font-face loader](src/machines/actors/load-font-face.ts),
  [specimen controller](src/hooks/use-font-specimen.ts),
  [snippet builder](src/lib/font-use-snippets.ts), and
  [font-use controller](src/hooks/use-font-use-panel.ts). Regressions:
  [font-face descriptor tests](src/lib/font-face-descriptors.test.ts),
  [specimen machine tests](src/machines/specimen-machine.test.ts),
  [snippet tests](src/lib/font-use-snippets.test.ts),
  [specimen/export browser suite](e2e/specimen-export.spec.ts), and
  [catalog state browser suite](e2e/catalog-state.spec.ts).
- `INV-IDENTITY-5` — Production:
  [catalog machine](src/machines/catalog-machine.ts),
  [specimen machine](src/machines/specimen-machine.ts),
  [font fetch actor](src/machines/actors/fetch-fonts.ts),
  [font-face loader](src/machines/actors/load-font-face.ts),
  [catalog URL controller](src/hooks/use-catalog-machine.ts), and
  [catalog shell](src/hooks/use-font-catalog-shell.ts). Regressions:
  [specimen machine tests](src/machines/specimen-machine.test.ts),
  [font fetch actor tests](src/machines/actors/fetch-fonts.test.ts), and
  [catalog state browser suite](e2e/catalog-state.spec.ts).

### Filters and URL state

- `INV-FILTER-1` — Production: [catalog machine](src/machines/catalog-machine.ts),
  [URL codec](src/machines/catalog-url.ts),
  [query identity](src/lib/query-keys.ts),
  [catalog shell](src/hooks/use-font-catalog-shell.ts), and
  [font fetch actor](src/machines/actors/fetch-fonts.ts). Regressions:
  [catalog machine tests](src/machines/catalog-machine.test.ts),
  [URL codec tests](src/machines/catalog-url.test.ts),
  [query identity tests](src/lib/query-keys.test.ts), and
  [catalog state browser suite](e2e/catalog-state.spec.ts).
- `INV-FILTER-2` — Production: [catalog machine](src/machines/catalog-machine.ts),
  [catalog shell](src/hooks/use-font-catalog-shell.ts), and
  [filter chip controller](src/hooks/use-filter-chips.ts). Regressions:
  [catalog machine tests](src/machines/catalog-machine.test.ts) and
  [catalog state browser suite](e2e/catalog-state.spec.ts).
- `INV-FILTER-3` — Production: [catalog types](src/types/catalog.ts),
  [filter controller](src/hooks/use-font-filter-bar.ts), and
  [dense table controller](src/hooks/use-dense-font-table.ts). Regression:
  [catalog state browser suite](e2e/catalog-state.spec.ts).
- `INV-FILTER-4` — Production: [URL codec](src/machines/catalog-url.ts),
  [catalog machine](src/machines/catalog-machine.ts), and
  [catalog URL controller](src/hooks/use-catalog-machine.ts). Regressions:
  [URL codec tests](src/machines/catalog-url.test.ts),
  [catalog machine tests](src/machines/catalog-machine.test.ts),
  [catalog state browser suite](e2e/catalog-state.spec.ts), and
  [URL synchronization browser suite](e2e/url-sync.spec.ts).
- `INV-FILTER-5` — Production: [URL codec](src/machines/catalog-url.ts),
  [catalog URL controller](src/hooks/use-catalog-machine.ts),
  [query identity](src/lib/query-keys.ts), and
  [catalog shell](src/hooks/use-font-catalog-shell.ts). Regressions:
  [URL codec tests](src/machines/catalog-url.test.ts),
  [query identity tests](src/lib/query-keys.test.ts), and
  [catalog state browser suite](e2e/catalog-state.spec.ts).
- `INV-FILTER-6` — Production:
  [font search field](src/components/catalog/font-search-field.tsx),
  [font filter bar](src/components/catalog/font-filter-bar.tsx),
  [filter chips](src/components/catalog/filter-chips.tsx),
  [font row](src/components/catalog/font-row.tsx),
  [font list](src/components/catalog/font-list.tsx),
  [dense table](src/components/catalog/dense-font-table.tsx),
  [font specimen](src/components/catalog/font-specimen.tsx),
  [font use panel](src/components/catalog/font-use-panel.tsx), and
  [catalog error boundary](src/components/catalog/catalog-error-boundary.tsx).
  Regressions:
  [accessibility/layout browser suite](e2e/a11y-layout.spec.ts) and
  [specimen/export browser suite](e2e/specimen-export.spec.ts).

### Pagination and result truth

- `INV-PAGE-1` — Production: [catalog machine](src/machines/catalog-machine.ts),
  [catalog shell](src/hooks/use-font-catalog-shell.ts), and
  [pagination controller](src/hooks/use-pagination-controls.ts). Regressions:
  [catalog machine tests](src/machines/catalog-machine.test.ts) and
  [catalog state browser suite](e2e/catalog-state.spec.ts).
- `INV-PAGE-2` — Production: [catalog machine](src/machines/catalog-machine.ts),
  [catalog URL controller](src/hooks/use-catalog-machine.ts),
  [catalog shell](src/hooks/use-font-catalog-shell.ts),
  [pagination controller](src/hooks/use-pagination-controls.ts), and
  [font list projection](src/hooks/use-font-list.ts). Regressions:
  [catalog machine tests](src/machines/catalog-machine.test.ts) and
  [catalog state browser suite](e2e/catalog-state.spec.ts).
- `INV-PAGE-3` — Production: [catalog machine](src/machines/catalog-machine.ts).
  Regressions: [catalog machine tests](src/machines/catalog-machine.test.ts)
  and [catalog state browser suite](e2e/catalog-state.spec.ts).
- `INV-PAGE-4` — Production: [cursor codec](src/graphql/schema/cursor.ts),
  [font pagination](src/graphql/schema/font-pagination.ts), and
  [GraphQL resolvers](src/graphql/schema/types.ts). Regressions:
  [cursor contract tests](src/graphql/cursor-contract.test.ts),
  [resolver contract tests](src/graphql/resolver-contract.test.ts), and
  [pagination SQL contract tests](src/graphql/font-pagination-contract.test.ts).
- `INV-PAGE-5` — Production:
  [public font policy](src/graphql/schema/public-font-policy.ts) and
  [GraphQL resolvers](src/graphql/schema/types.ts). Regressions:
  [public policy tests](src/graphql/public-font-policy.test.ts) and
  [resolver contract tests](src/graphql/resolver-contract.test.ts).
- `INV-PAGE-6` — Production: [catalog machine](src/machines/catalog-machine.ts),
  [font query](src/hooks/use-fonts-query.ts),
  [catalog shell](src/hooks/use-font-catalog-shell.ts),
  [font list projection](src/hooks/use-font-list.ts),
  [font list](src/components/catalog/font-list.tsx), and
  [dense table](src/components/catalog/dense-font-table.tsx). Regressions:
  [catalog machine tests](src/machines/catalog-machine.test.ts),
  [catalog state browser suite](e2e/catalog-state.spec.ts), and
  [accessibility/layout browser suite](e2e/a11y-layout.spec.ts).

### Errors and recovery

- `INV-ERROR-1` — Production: [catalog machine](src/machines/catalog-machine.ts),
  [specimen machine](src/machines/specimen-machine.ts),
  [catalog shell](src/hooks/use-font-catalog-shell.ts),
  [catalog error boundary](src/components/catalog/catalog-error-boundary.tsx),
  and [GraphQL route](src/app/api/graphql/route.ts). Regressions:
  [catalog machine tests](src/machines/catalog-machine.test.ts),
  [specimen machine tests](src/machines/specimen-machine.test.ts),
  [GraphQL route tests](src/graphql/route.test.ts),
  [catalog state browser suite](e2e/catalog-state.spec.ts), and
  [accessibility/layout browser suite](e2e/a11y-layout.spec.ts).
- `INV-ERROR-2` — Production: [catalog shell](src/hooks/use-font-catalog-shell.ts),
  [statistics controller](src/hooks/use-stats-strip.ts),
  [statistics strip](src/components/catalog/stats-strip.tsx),
  [specimen machine](src/machines/specimen-machine.ts),
  [font list](src/components/catalog/font-list.tsx),
  [dense table](src/components/catalog/dense-font-table.tsx),
  [font specimen](src/components/catalog/font-specimen.tsx),
  [clipboard controller](src/hooks/use-font-use-panel.ts),
  [font use panel](src/components/catalog/font-use-panel.tsx), and
  [catalog error boundary](src/components/catalog/catalog-error-boundary.tsx).
  Regressions: [catalog state browser suite](e2e/catalog-state.spec.ts),
  [accessibility/layout browser suite](e2e/a11y-layout.spec.ts), and
  [specimen/export browser suite](e2e/specimen-export.spec.ts).
- `INV-ERROR-3` — Production: [catalog machine](src/machines/catalog-machine.ts),
  [catalog shell](src/hooks/use-font-catalog-shell.ts),
  [font list](src/components/catalog/font-list.tsx),
  [dense table](src/components/catalog/dense-font-table.tsx), and
  [catalog error boundary](src/components/catalog/catalog-error-boundary.tsx).
  Regressions: [catalog machine tests](src/machines/catalog-machine.test.ts),
  [catalog state browser suite](e2e/catalog-state.spec.ts), and
  [accessibility/layout browser suite](e2e/a11y-layout.spec.ts).
- `INV-ERROR-4` — Production:
  [clipboard controller](src/hooks/use-font-use-panel.ts) and
  [font use panel](src/components/catalog/font-use-panel.tsx). Regression:
  [specimen/export browser suite](e2e/specimen-export.spec.ts).

### Public data

- `INV-DATA-1` — Production:
  [public font policy](src/graphql/schema/public-font-policy.ts),
  [GraphQL resolvers](src/graphql/schema/types.ts), and
  [catalog statistics](src/lib/cached-stats.ts). Regressions:
  [public policy tests](src/graphql/public-font-policy.test.ts),
  [resolver contract tests](src/graphql/resolver-contract.test.ts), and
  [statistics tests](src/lib/cached-stats.test.ts).
- `INV-DATA-2` — Production:
  [public font policy](src/graphql/schema/public-font-policy.ts) and
  [GraphQL resolvers](src/graphql/schema/types.ts). Regression:
  [resolver contract tests](src/graphql/resolver-contract.test.ts).
- `INV-DATA-3` — Production: [GraphQL resolvers](src/graphql/schema/types.ts)
  and [font pagination](src/graphql/schema/font-pagination.ts). Regressions:
  [resolver contract tests](src/graphql/resolver-contract.test.ts),
  [cursor contract tests](src/graphql/cursor-contract.test.ts), and
  [schema contract tests](src/graphql/schema-contract.test.ts).

### GraphQL

- `INV-GQL-1` — Production: [schema builder](src/graphql/schema/builder.ts),
  [GraphQL types](src/graphql/schema/types.ts),
  [schema](src/graphql/schema/index.ts), and
  [shipped documents](src/graphql/documents.ts). Regressions:
  [schema contract tests](src/graphql/schema-contract.test.ts),
  [operation result tests](src/graphql/operation-result-contract.test.ts), and
  [resolver contract tests](src/graphql/resolver-contract.test.ts).
- `INV-GQL-2` — Production: [GraphQL types](src/graphql/schema/types.ts),
  [cursor codec](src/graphql/schema/cursor.ts),
  [database text scalar](src/graphql/schema/database-text.ts),
  [positive integer policy](src/lib/positive-safe-integer.ts), and
  [GraphQL route](src/app/api/graphql/route.ts). Regressions:
  [resolver contract tests](src/graphql/resolver-contract.test.ts),
  [cursor contract tests](src/graphql/cursor-contract.test.ts), and
  [GraphQL route tests](src/graphql/route.test.ts).
- `INV-GQL-3` — Production: [GraphQL types](src/graphql/schema/types.ts),
  [GraphQL route](src/app/api/graphql/route.ts), and
  [database loader](src/lib/db.ts). Regressions:
  [GraphQL route tests](src/graphql/route.test.ts) and
  [production route contract tests](src/graphql/route-production-contract.test.ts).
- `INV-GQL-4` — Production: [GraphQL route](src/app/api/graphql/route.ts).
  Regression: [GraphQL route tests](src/graphql/route.test.ts).
- `INV-GQL-5` — Production: [GraphQL route](src/app/api/graphql/route.ts).
  Regression: [GraphQL route tests](src/graphql/route.test.ts).
- `INV-GQL-6` — Production: [GraphQL route](src/app/api/graphql/route.ts).
  Regressions: [GraphQL route tests](src/graphql/route.test.ts) and
  [production route contract tests](src/graphql/route-production-contract.test.ts).
- `INV-GQL-7` — Production: [GraphQL route](src/app/api/graphql/route.ts).
  Regression: [GraphQL route tests](src/graphql/route.test.ts).
- `INV-GQL-8` — Production: [GraphQL route](src/app/api/graphql/route.ts).
  Regression: [GraphQL route tests](src/graphql/route.test.ts).
- `INV-GQL-9` — Production: [GraphQL route](src/app/api/graphql/route.ts).
  Regression: [GraphQL route tests](src/graphql/route.test.ts).

### Accessibility

- `INV-A11Y-1` — Production: [font list projection](src/hooks/use-font-list.ts),
  [font row](src/components/catalog/font-row.tsx),
  [dense table controller](src/hooks/use-dense-font-table.ts), and
  [dense table](src/components/catalog/dense-font-table.tsx). Regression:
  [accessibility/layout browser suite](e2e/a11y-layout.spec.ts).
- `INV-A11Y-2` — Production: [catalog composition](src/components/catalog/catalog-island.tsx),
  [filter bar](src/components/catalog/font-filter-bar.tsx),
  [specimen](src/components/catalog/font-specimen.tsx),
  [catalog shell](src/hooks/use-font-catalog-shell.ts),
  [font row](src/components/catalog/font-row.tsx),
  [dense table controller](src/hooks/use-dense-font-table.ts), and
  [dense table](src/components/catalog/dense-font-table.tsx). Regressions:
  [catalog state browser suite](e2e/catalog-state.spec.ts) and
  [accessibility/layout browser suite](e2e/a11y-layout.spec.ts).
- `INV-A11Y-3` — Production: [root layout metadata](src/app/layout.tsx),
  [catalog heading](src/components/catalog/catalog-island.tsx), and
  [catalog skeleton](src/components/catalog/catalog-skeleton.tsx).
  Regressions: [catalog browser suite](e2e/catalog.spec.ts) and
  [accessibility/layout browser suite](e2e/a11y-layout.spec.ts).
- `INV-A11Y-4` — Production: [global styles](src/app/globals.css),
  [filter bar](src/components/catalog/font-filter-bar.tsx),
  [filter chips](src/components/catalog/filter-chips.tsx),
  [pagination controls](src/components/catalog/pagination-controls.tsx),
  [font row](src/components/catalog/font-row.tsx),
  [dense table](src/components/catalog/dense-font-table.tsx),
  [font specimen](src/components/catalog/font-specimen.tsx),
  [font use panel](src/components/catalog/font-use-panel.tsx), and
  [catalog error boundary](src/components/catalog/catalog-error-boundary.tsx).
  Regression:
  [accessibility/layout browser suite](e2e/a11y-layout.spec.ts).
- `INV-A11Y-5` — Production:
  [filter chip controller](src/hooks/use-filter-chips.ts),
  [filter chips](src/components/catalog/filter-chips.tsx),
  [font list](src/components/catalog/font-list.tsx),
  [dense table](src/components/catalog/dense-font-table.tsx),
  [font specimen](src/components/catalog/font-specimen.tsx), and
  [font use panel](src/components/catalog/font-use-panel.tsx). Regressions:
  [accessibility/layout browser suite](e2e/a11y-layout.spec.ts) and
  [specimen/export browser suite](e2e/specimen-export.spec.ts).
- `INV-A11Y-6` — Production:
  [catalog composition](src/components/catalog/catalog-island.tsx),
  [statistics strip](src/components/catalog/stats-strip.tsx),
  [font filter bar](src/components/catalog/font-filter-bar.tsx),
  [filter chips](src/components/catalog/filter-chips.tsx),
  [font row](src/components/catalog/font-row.tsx),
  [font list](src/components/catalog/font-list.tsx),
  [dense table](src/components/catalog/dense-font-table.tsx),
  [font specimen](src/components/catalog/font-specimen.tsx), and
  [font use panel](src/components/catalog/font-use-panel.tsx). Regression:
  [accessibility/layout browser suite](e2e/a11y-layout.spec.ts), including its
  statistics-recovery geometry scenario at 200% zoom.
- `INV-A11Y-7` — Production: [global styles](src/app/globals.css). Regression:
  [accessibility/layout browser suite](e2e/a11y-layout.spec.ts).

### Generated artifacts and external actions

- `INV-ARTIFACT-1` — Production:
  [snippet builder](src/lib/font-use-snippets.ts) and
  [font-use controller](src/hooks/use-font-use-panel.ts). Regressions:
  [snippet tests](src/lib/font-use-snippets.test.ts) and
  [specimen/export browser suite](e2e/specimen-export.spec.ts).
- `INV-ARTIFACT-2` — Production:
  [external URL policy](src/lib/external-url-policy.ts),
  [snippet builder](src/lib/font-use-snippets.ts),
  [font-face loader](src/machines/actors/load-font-face.ts), and
  [font-use controller](src/hooks/use-font-use-panel.ts). Regressions:
  [snippet tests](src/lib/font-use-snippets.test.ts),
  [font-face loader tests](src/machines/load-font-face.test.ts), and
  [specimen/export browser suite](e2e/specimen-export.spec.ts).
- `INV-ARTIFACT-3` — Production:
  [font-face loader](src/machines/actors/load-font-face.ts),
  [specimen machine](src/machines/specimen-machine.ts), and
  [catalog shell](src/hooks/use-font-catalog-shell.ts). Regressions:
  [font-face loader tests](src/machines/load-font-face.test.ts),
  [specimen machine tests](src/machines/specimen-machine.test.ts),
  [catalog state browser suite](e2e/catalog-state.spec.ts), and
  [specimen/export browser suite](e2e/specimen-export.spec.ts).

### Repository and verification

- `INV-REPO-1` — Production: [package scripts](package.json),
  [Bun lockfile](bun.lock),
  [Dependabot version-update policy](.github/dependabot.yml),
  [Conductor settings](.conductor/settings.toml), and
  [unit-test runner](scripts/run-tests.ts). Regression:
  [repository contract tests](scripts/repository-contract.test.ts).
- `INV-REPO-2` — Production: [Conductor settings](.conductor/settings.toml),
  [worktree include policy](.worktreeinclude),
  [Playwright configuration](playwright.config.ts),
  [isolated E2E policy](scripts/isolated-e2e.ts), and
  [isolated E2E runner](scripts/run-isolated-e2e.ts). Regressions:
  [repository contract tests](scripts/repository-contract.test.ts) and
  [isolated E2E tests](scripts/isolated-e2e.test.ts).
- `INV-REPO-3` — Production: [package scripts](package.json),
  [dependency audit workflow](.github/workflows/dependency-audit.yml),
  [child-process lifecycle](scripts/live-child-process.ts),
  [live GraphQL smoke](scripts/live-graphql-smoke.ts),
  [unit-test runner](scripts/run-tests.ts),
  [Playwright configuration](playwright.config.ts), and
  [isolated E2E runner](scripts/run-isolated-e2e.ts). Regressions:
  [repository contract tests](scripts/repository-contract.test.ts),
  [isolated E2E tests](scripts/isolated-e2e.test.ts), and
  [child-process lifecycle tests](scripts/live-child-process.test.ts),
  [artifact contract tests](scripts/artifact-contract.test.ts).
- `INV-REPO-4` — Production: [Playwright configuration](playwright.config.ts),
  [font row](src/components/catalog/font-row.tsx), and
  [dense table](src/components/catalog/dense-font-table.tsx). Regressions:
  [repository contract tests](scripts/repository-contract.test.ts),
  [catalog browser suite](e2e/catalog.spec.ts),
  [catalog state browser suite](e2e/catalog-state.spec.ts),
  [accessibility/layout browser suite](e2e/a11y-layout.spec.ts), and
  [specimen/export browser suite](e2e/specimen-export.spec.ts).

### Ingest pipeline and data quality

- `INV-INGEST-1` — Production: [upsert builders](src/ingest/upsert.ts) and
  [duplicate grouping](src/ingest/dedup.ts). Regressions:
  [upsert tests](src/ingest/upsert.test.ts) and
  [dedup tests](src/ingest/dedup.test.ts).
- `INV-INGEST-2` — Production: [asset URL builder](src/ingest/asset-url.ts) and
  [URL backfill](src/ingest/url-backfill.ts). Regressions:
  [asset URL tests](src/ingest/asset-url.test.ts),
  [URL backfill tests](src/ingest/url-backfill.test.ts), and
  [data-quality checks](src/ingest/data-quality.test.ts) via `DQ-URL-ENCODING`
  and `DQ-NON-ASCII`.
- `INV-INGEST-3` — Production: [GitHub client](src/ingest/github-client.ts) and
  [scan worker](src/ingest/scan-worker.ts), which resolve the head commit and
  build pinned URLs. Regressions:
  [scan worker tests](src/ingest/scan-worker.test.ts),
  [URL backfill tests](src/ingest/url-backfill.test.ts), which assert the blob
  sha is never used as a ref, and
  [data-quality checks](src/ingest/data-quality.test.ts) via `DQ-SHA-PINNED`.
- `INV-INGEST-4` — Production: [CDN delivery policy](src/ingest/cdn-policy.ts)
  and [asset verification](src/ingest/asset-verify.ts). Regressions:
  [CDN policy tests](src/ingest/cdn-policy.test.ts), which include a drift guard
  against [the public font policy](src/graphql/schema/public-font-policy.ts),
  [asset verification tests](src/ingest/asset-verify.test.ts), and
  [data-quality checks](src/ingest/data-quality.test.ts) via `DQ-CDN-SIZE`,
  `DQ-ZERO-LENGTH`, `DQ-DELIVERY-CLASSIFIED`, and `DQ-ASSET-VERIFIED`.
- `INV-INGEST-5` — Production: [licence detection](src/ingest/license-detect.ts),
  [licence recovery runner](scripts/ingest-licence-recover.ts), and
  [the ingest schema](sql/002_ingest.sql), which keeps recovered licences in
  their own columns. Regressions:
  [licence detection tests](src/ingest/license-detect.test.ts) and
  [data-quality checks](src/ingest/data-quality.test.ts) via
  `DQ-LICENCE-EVIDENCE`.
- `INV-INGEST-6` — Production: [scan error taxonomy](src/ingest/scan-errors.ts),
  [scan worker](src/ingest/scan-worker.ts), and
  [scan runner](scripts/ingest-scan.ts). Regressions:
  [scan error tests](src/ingest/scan-errors.test.ts),
  [scan worker tests](src/ingest/scan-worker.test.ts), and
  [data-quality checks](src/ingest/data-quality.test.ts) via `DQ-COVERAGE`.
- `INV-INGEST-7` — Production: [run telemetry](src/ingest/telemetry.ts) and
  [scan runner](scripts/ingest-scan.ts). Regressions:
  [telemetry tests](src/ingest/telemetry.test.ts) and
  [data-quality checks](src/ingest/data-quality.test.ts) via `DQ-RUN-FRESHNESS`,
  `DQ-RUN-CRASHED`, and `DQ-FRESHNESS`.
- `INV-INGEST-8` — Production: [tombstone reconciliation](src/ingest/reconcile.ts)
  and [the public font policy](src/graphql/schema/public-font-policy.ts).
  Regressions: [reconcile tests](src/ingest/reconcile.test.ts),
  [resolver SQL contracts](src/graphql/resolver-contract.test.ts), and
  [data-quality checks](src/ingest/data-quality.test.ts) via
  `DQ-RETIRED-EXCLUDED`.
- `INV-INGEST-9` — Production: [check registry](src/ingest/data-quality.ts),
  [live check runner](scripts/ingest-checks.ts),
  [ingest audit](scripts/ingest-audit.ts), and
  [the data-quality workflow](.github/workflows/data-quality.yml). Regressions:
  [data-quality tests](src/ingest/data-quality.test.ts).
