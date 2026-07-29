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

## Issue register

The Beads issue record in `.beads/issues.jsonl` contains the full reproduction,
expected and actual behavior, impact, acceptance criteria, assignment, and
status for every finding.

| ID | Finding | Evidence seam | Required regression |
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
| `silofl-pzs.36` | approved-origin paths can terminate copied CSS URLs | CSS-significant path characters on jsDelivr | context-escaped URL values in every artifact |
| `silofl-pzs.37` | generic family names select the wrong React face | literal family `serif` with fallbacks | quoted selected-family identity |
| `silofl-pzs.38` | superseded copy attempts can overwrite the newest payload | reversed Clipboard promise completion | latest-attempt clipboard ownership |
| `silofl-pzs.39` | missing deep-linked fonts remain claimed by the URL | null/hidden Font detail lookup | safe canonical deselection |
| `silofl-pzs.40` | opaque deep cursors receive invented page numbers | later-page cursor without local history | truthful unknown-position labeling |
| `silofl-pzs.41` | database bigint IDs overflow GraphQL Int output | IDs above signed Int32 | explicit positive-safe ID scalar contract |
| `silofl-pzs.42` | malformed GraphQL GET variables receive an internal-error status | malformed and non-object `variables` parameters | sanitized HTTP 400 before resolver work |
| `silofl-pzs.43` | specimen retry clears failure before recovery and is not genuinely tested | fail-once face actor on one machine | same-actor retry with error retained until success |
| `silofl-pzs.44` | delayed clipboard fallback steals or loses current focus | rejected pending copy after focus move or panel removal | preserve the live pre-fallback focus target |
| `silofl-pzs.45` | deep-link font lookup exposes internal GraphQL request details | rejected `Font` detail request | fixed safe detail error and retry |
| `silofl-pzs.46` | catalog render boundary exposes internal exception text | malformed dense row | fixed safe boundary copy |
| `silofl-pzs.47` | NUL and ill-formed UTF-16 reach PostgreSQL | malformed database-bound text | pre-SQL `BAD_USER_INPUT` matrix |
| `silofl-pzs.48` | fragment DAG analysis expands exponentially | repeatedly spread fragment graph | bounded selected-operation traversal |
| `silofl-pzs.49` | negative stars and unsupported formats reach SQL | invalid filter variables | closed-domain input rejection |
| `silofl-pzs.50` | coercion errors echo submitted variable values | secret-shaped invalid scalar values | fixed safe coercion message |
| `silofl-pzs.51` | malformed extensions and form variables become HTTP 500 | invalid serialized request parameters | sanitized HTTP 400 before execution |
| `silofl-pzs.52` | catalog boundary retry re-renders the same cached fault | fail-once dense response | retry-triggered refetch |
| `silofl-pzs.53` | mount-only guard drops subscriptions after a React reconnect | setup/cleanup/setup contract | symmetric mount-effect regression |
| `silofl-pzs.54` | loaded faces collide and accumulate | sequential same-family selections | one registered face and clear cleanup |
| `silofl-pzs.55` | malformed closed URL values remain hidden active state | invalid format, sort, and font parameters | canonical visible defaults |
| `silofl-pzs.56` | pagination Reset retains selected identity | selected malformed-cursor state | atomic cursor and identity reset |
| `silofl-pzs.57` | missing family metadata produces divergent identities | null-family font | one readable display, face, and export identity |
| `silofl-pzs.58` | specimen family is interpolated into CSS without escaping | quotes, newline, and backslash in family | inert CSSOM family assertion |
| `silofl-pzs.59` | whitespace differs across controls, URL, and request | padded search and owner input | control/URL/GraphQL convergence |
| `silofl-pzs.60` | specimen loading and errors are not announced | failure and successful retry | one busy live-status lifecycle |
| `silofl-pzs.61` | selected rows rely on color alone | list and dense selection | persistent visible selection text |
| `silofl-pzs.62` | font-face cleanup exceptions abort selection and reset | rejecting `FontFaceSet.delete` | exception-safe replace and clear |
| `silofl-pzs.63` | superseded selected-font work survives A–B–A navigation | rapid repeated-ID detail requests | actor and query cancellation compose |
| `silofl-pzs.64` | same-ID metadata refresh diverges from the loaded face | selected row replaced by a newer revision | row, specimen, face, and export reconverge |
| `silofl-pzs.65` | pagination remains active during search debounce | page action before the new query resolves | page controls disabled for unresolved criteria |
| `silofl-pzs.66` | one catalog event writes the URL twice | instrumented `replaceState` call origin | one app-originated canonical write |
| `silofl-pzs.67` | long virtual rows overlap later results at narrow zoom | extreme metadata at 320px and 200% zoom | bounded row geometry and next-row interaction |
| `silofl-pzs.68` | quoted commas bypass `Accept` quality exclusions | quoted media parameter with `q=0` | quote-aware representation parsing |
| `silofl-pzs.69` | `Accept` media-parameter specificity is ignored | specific `q=0` and generic `q=1` ranges | most-specific matching range wins |
| `silofl-pzs.70` | malformed `Accept` media ranges are treated as JSON | invalid wildcard and whitespace forms | safe 406 for invalid ranges |
| `silofl-pzs.71` | development GraphiQL uses substring negotiation | HTML `q=0`, case, and quoted false positives | parsed acceptable HTML range only |
| `silofl-pzs.72` | combined `Content-Type` validation is order-dependent | ambiguous header in both orders | consistent 415 before body parsing |
| `silofl-pzs.73` | unsupported request charsets are silently erased | non-UTF-8 declared request body | explicit 415 with UTF-8 retained |
| `silofl-pzs.74` | early request failures bypass `Accept` negotiation | rejected representation with 400/413 input | consistent safe 406 policy |
| `silofl-pzs.75` | an inactive draft query can roll selected metadata backward | cached disabled query event during debounce | exact active ready-query reconciliation |
| `silofl-pzs.76` | pointer selection loads one face up to three times | hover, focus, then click | equivalent face-load de-duplication |
| `silofl-pzs.77` | actor cancellation does not stop query retry backoff | transient failure, stop, immediate same-ID restart | cancel the complete query lifecycle |
| `silofl-pzs.78` | early errors ignore the selected JSON representation | JSON-only `Accept` with 400/413/415 input | negotiated early-error media type |
| `silofl-pzs.79` | quoted `Accept` qvalues are accepted as quality weights | JSON and GraphiQL with `q="1"` | unquoted qvalue grammar |
| `silofl-pzs.80` | `Accept` permits whitespace around parameter equals | JSON, GraphiQL, and mixed ranges with `q = 1` | strict parameter grammar |
| `silofl-pzs.81` | a disabled cached draft replaces visible selected metadata | cached search key during debounce | retain the committed connection across surfaces |
| `silofl-pzs.82` | media parameters after `q` lose `Accept` specificity | q-before-charset exclusion | order-independent q weight and media parameters |
| `silofl-pzs.83` | Unicode whitespace becomes valid HTTP OWS | NBSP-wrapped media range | SP/HTAB-only OWS parsing |
| `silofl-pzs.84` | GraphiQL negotiates an undeclared charset representation | charset-specific HTML acceptance and exclusion | matched negotiation and response `Content-Type` |
| `silofl-pzs.85` | valid empty HTTP media parameters are rejected | trailing and interstitial empty parameter slots | RFC-compatible empty-parameter parsing |
| `silofl-pzs.86` | GraphiQL ignores a higher-quality JSON preference | lower, higher, and tied HTML/JSON weights | highest-quality representation selection |
| `silofl-pzs.87` | a disabled cached draft leaks a stale catalog error | failed cached key re-entered during debounce | ready/active error projection |
| `silofl-pzs.88` | selection test reads screen-reader-only text as font identity | selected row with content-derived accessible name | identity from the public family-name contract |
| `silofl-pzs.89` | face-resolution test depends on a removed `aria-label` | content-derived row name after accessibility correction | role/name-based row selection |

`silofl-pzs.30` was closed as not reproducible: the characterization
regression demonstrates coherent native Space activation without requiring a
product change. The other 88 findings were reproduced before their fixes and
retain their regressions.

## Final verification

| Gate | Final |
| --- | --- |
| lint | passed, no warnings |
| typecheck | passed |
| unit and contract tests | 184 passed across 18 files |
| Playwright | 72 passed in isolated headless Chromium |
| production build | passed; `/`, `/_not-found`, and `/api/graphql` emitted |
| live GraphQL smoke | passed; health, stats, public fonts, OFL scope, HTTPS targets, scalar serialization, and private POST caching |
| worktree smoke | passed; six repository/isolation contracts and conflict-free semantic integration |

The live database snapshot contained 10,864 repositories, 32,937 public font
files, and 6,638 owners. Three reputation-sorted public rows were sampled; all
used accepted OFL identifiers and HTTPS font targets. These counts are
observational and may change as the catalog is refreshed.
