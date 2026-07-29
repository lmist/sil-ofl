# Application invariants

These statements are the hard contract for the SIL OFL Fonts application.
They apply to the browser UI, URL state, GraphQL schema and transport, data
queries, copied artifacts, and developer workflows.

The words **MUST**, **MUST NOT**, and **SHOULD** are normative. Each invariant
has a stable identifier. Code and tests may reference these identifiers.

## Catalog identity and state

### INV-IDENTITY-1 — One selected font

At most one font MUST be selected. When a font is selected, the selected row,
`font` URL parameter, specimen metadata, rendered face, and use panel MUST
identify that same font.

Transient hover or focus preview MAY render another face only when it is
visually identified as a preview and MUST NOT replace selected metadata, copied
snippets, or the selected URL.

Enforced at:

- `src/machines/catalog-machine.ts`
- `src/machines/specimen-machine.ts`
- `src/hooks/use-font-catalog-shell.ts`
- `e2e/catalog.spec.ts`

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
observationally inert.

## Filters, sorting, and URL state

### INV-FILTER-1 — Input and request agree

Every displayed filter value MUST equal the normalized value used in the query.
Invalid, ambiguous, non-finite, negative, fractional, or out-of-range numeric
input MUST be rejected or normalized visibly before it becomes active.

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

Search, owner, filenames, family names, repository names, error messages, and
active-filter labels MUST NOT create document-level horizontal overflow at any
supported viewport.

## Pagination and result truth

### INV-PAGE-1 — A cursor is consumed once

A forward cursor MUST be pushed at most once. Previous navigation MUST pop at
most one entry. Controls MUST be unavailable while the destination cursor or
page identity is unresolved.

### INV-PAGE-2 — Page labels are truthful

The displayed page number, Previous availability, current cursor, visible rows,
and URL cursor MUST describe the same page. A deep-linked non-empty cursor MUST
NOT be presented as Page 1 with Previous disabled.

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

Initial load, refetch, pagination, face load, clipboard, and malformed URL
failures MUST expose an accessible status and an appropriate Retry, Reset, or
alternative action.

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
100. Invalid cursors and identifiers MUST fail as safe client input, not as
internal server errors.

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
secrets. Development diagnostics MUST not change cache or CORS safety.

## Accessibility and interaction

### INV-A11Y-1 — Valid semantics

Native interactive elements MUST retain valid semantics. ARIA roles and
attributes MUST be supported by the element or composite widget on which they
appear. List and dense modes MUST pass automated ARIA validation.

### INV-A11Y-2 — Keyboard parity

Every pointer action MUST have an equivalent keyboard path. Focus order MUST be
logical, focus indication MUST be visible, and row selection MUST work with
Enter and Space where the control contract advertises both.

### INV-A11Y-3 — One page heading

The catalog route MUST expose one descriptive level-one heading and a unique,
descriptive document title.

### INV-A11Y-4 — Perceivable content

Normal text MUST meet WCAG 2.2 AA contrast. Interactive targets MUST be at
least 24 by 24 CSS pixels without target overlap. Information MUST not rely on
color alone.

### INV-A11Y-5 — Announcements are scoped

Loading, result-count, copied, and error announcements MUST be concise and
non-duplicative. Decorative or redundant text MUST not create competing live
regions.

### INV-A11Y-6 — Responsive access

At 320 CSS pixels and above, all primary tasks MUST remain available without
document-level horizontal scrolling. Dense data regions MAY scroll internally.
At 200% zoom, controls and text MUST not overlap or become unreachable.

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

Font loading MUST use the selected record's approved CDN URL and may fall back
once to its approved raw URL. Failure MUST stop with a recoverable state; it
MUST NOT loop or silently load an unrelated face.

## Repository and verification

### INV-REPO-1 — Bun is authoritative

JavaScript and TypeScript setup, development, tests, and build commands MUST use
Bun. The repository MUST carry one authoritative Bun lockfile and declare its
Bun package manager version.

### INV-REPO-2 — Workspaces are isolated

Conductor workspaces MUST start from the repository root, copy only explicitly
listed local environment files, and use their allocated `CONDUCTOR_PORT` range.
Parallel workspaces MUST not share a fixed development port.

### INV-REPO-3 — Quality gates stay green

`bun run lint`, `bun run typecheck`, `bun run test`, `bun run test:e2e`, and
`bun run build` MUST pass before integration. A bug fix MUST include a
regression test that failed against the faulty behavior and passes with the
fix.
