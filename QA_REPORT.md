# Catalog quality report

## Scope

The verified surface is the complete authored application:

- `/` catalog route, loading shell, list and dense modes
- every filter, chip, sort, pagination, specimen, selection, copy, download,
  repository, retry, and clear action
- URL refresh, malformed state, Back/Forward, and selected-font deep links
- keyboard, screen-reader semantics, contrast, target size, reduced motion,
  zoom, and widths from 320 through 1440 CSS pixels
- loading, retained-data, empty, HTTP error, GraphQL error, malformed response,
  face-load failure, clipboard failure, and not-found states
- `/api/graphql` schema, resolvers, cursors, CORS, cache policy, methods,
  liveness, and public data visibility
- Bun, Playwright, Conductor, lint, typecheck, unit, build, and worktree
  configuration

The route/component/state inventory is in `SITE_MAP.md`. The behavioral matrix
is in `USER_STORIES.md`. The binding contract is in `INVARIANTS.md`.

## Baseline

### Repository gates

| Gate | Baseline |
| --- | --- |
| `bun run lint` | failed: one fixture error and four warnings |
| `bun run typecheck` | passed |
| `bun run test` | 24 passed |
| `bun run test:e2e` | 7 passed |
| `bun run build` | passed |

### Browser scenarios

| Group | Scenarios | Passed | Failed | Skipped | Coverage |
| --- | ---: | ---: | ---: | ---: | --- |
| Search and URL | 7 | 4 | 3 | 0 | query forms, debounce, deep links, history, malformed URL |
| Filters and chips | 9 | 5 | 4 | 0 | formats, owner, stars, booleans, sort, removal, clear, empty |
| Pagination and dense | 7 | 6 | 1 | 0 | page bounds, resets, races, mode continuity, dense sorts |
| Specimen and use | 8 | 5 | 3 | 0 | preview, keyboard, text, face failure, clipboard, external links |
| Resilience and API | 8 | 5 | 3 | 0 | delay, stale data, transport errors, operations, argument bounds, 404 |
| Accessibility | 5 | 0 | 3 | 2 | axe states, focus traversal, keyboard, live regions, roles |
| Responsive design | 4 | 1 | 2 | 1 | 15 viewport baselines, targets, semantics, reduced motion |
| Runtime and performance | 4 | 2 | 2 | 0 | console, resources, budgets, 25-cycle stability |
| **Total** | **52** | **28** | **21** | **3** | |

Not every failed exploratory expectation became a defect. Search updates
intentionally replace the current history entry; CDN-to-raw font fallback is a
designed recovery path; and a one-off 450 ms live filter response remains
inside the application’s existing budget.

## Confirmed defect register

The Beads issue record in `.beads/issues.jsonl` contains the full reproduction,
expected and actual behavior, impact, acceptance criteria, assignment, and
status for every defect.

| ID | Defect | Evidence seam | Required regression |
| --- | --- | --- | --- |
| `silofl-pzs.1` | baseline lint gate is red | `bun run lint` | lint command exits cleanly |
| `silofl-pzs.2` | long active-filter values overflow the document | search/owner at 500 characters | viewport/document-width assertion |
| `silofl-pzs.3` | minimum-stars input and request diverge | decimal, exponent, and extreme values | normalized input/request matrix |
| `silofl-pzs.4` | rapid boolean toggles lose actions | double Webfont/Variable activation | current-state parity assertion |
| `silofl-pzs.5` | reset leaves stale specimen identity | selection followed by Clear | atomic identity reset |
| `silofl-pzs.6` | repeated pagination consumes one cursor twice | immediate double Next/Previous | one-transition guard |
| `silofl-pzs.7` | selection, preview, URL, and use panel diverge | hover, paging, and deep links | identity convergence matrix |
| `silofl-pzs.8` | specimen ignores selected style and weight | italic and weighted faces | computed-style assertion |
| `silofl-pzs.9` | clipboard fallback reports false success | rejected Clipboard API and `execCommand=false` | confirmed-success/failure paths |
| `silofl-pzs.10` | refetch failures present stale data as success | HTTP, GraphQL, and JSON failure | stale/error/retry states |
| `silofl-pzs.11` | malformed cursor leaks raw request details | invalid `after` deep link | safe error and reset |
| `silofl-pzs.12` | list/table use invalid roles and ARIA | axe in list, selected, dense states | semantic and axe assertions |
| `silofl-pzs.13` | small status text fails contrast | axe color-contrast | zero contrast violations |
| `silofl-pzs.14` | catalog has no level-one heading | document outline and axe | one descriptive `h1` |
| `silofl-pzs.15` | compact actions are below 24×24 CSS pixels | use panel and dense headers | target bounding boxes |
| `silofl-pzs.16` | not-found route has no recovery action | unknown route | 404 status and catalog link |
| `silofl-pzs.17` | public catalog contains non-OFL records | live license grouping | shared OFL visibility predicate |
| `silofl-pzs.18` | GraphQL reflects credentialed arbitrary origins | hostile preflight | explicit CORS/Vary matrix |
| `silofl-pzs.19` | GraphQL errors receive public cache headers | comments, validation, execution failure | parsed success-only cache policy |
| `silofl-pzs.20` | schema nullability contradicts client types | generated SDL | SDL/document contract |
| `silofl-pzs.21` | liveness eagerly requires the database | health without `DATABASE_URL` | database-independent health |
| `silofl-pzs.22` | family keyset pagination mishandles nulls | nullable family fixtures | lossless asc/desc traversal |
| `silofl-pzs.23` | Stars ascending has no select representation | dense header sort | controlled-option coverage |
| `silofl-pzs.24` | React usage output contains invalid CSS comments | copied snippet | target-language syntax |
| `silofl-pzs.25` | README query and data-source description are stale | schema validation | executable documented query |
| `silofl-pzs.26` | worktree defaults violate the Bun/port contract | isolated workspace smoke | Bun and allocated-port config |
| `silofl-pzs.27` | invalid page sizes, IDs, and cursor IDs are accepted | argument/codec matrix | safe bounded validation |
| `silofl-pzs.28` | Playwright GraphQL mock differs from production | fixture contract comparison | filter/sort/count/cursor parity |
| `silofl-pzs.29` | duplicate live regions announce one transition twice | search/result status DOM | one scoped result announcement |
| `silofl-pzs.30` | Space does not reliably select a virtualized row | focused-row keyboard path | Enter/Space identity parity |
| `silofl-pzs.31` | GraphQL bodies and alias cost are unbounded | oversized and repeated-root documents | body and operation budgets |
| `silofl-pzs.32` | font loads and external actions trust arbitrary origins | invalid scheme/origin fixtures | approved HTTPS URL policy |
| `silofl-pzs.33` | copied artifacts do not escape hostile font metadata | adversarial family/repository names | target-specific escaping and parser checks |
| `silofl-pzs.34` | clipboard fallback loses keyboard focus | denied Clipboard API with textarea fallback | focus restoration on every fallback outcome |
| `silofl-pzs.35` | browser Back/Forward leaves machine state stale | same-route history across query/selection states | popstate convergence without navigation loops |

## Final verification

This section is completed after the isolated fixes are integrated and
independently rechecked.

| Gate | Final |
| --- | --- |
| lint | pending |
| typecheck | pending |
| unit and contract tests | pending |
| Playwright | pending |
| production build | pending |
| live GraphQL smoke | pending |
| worktree smoke | pending |
