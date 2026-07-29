# Site map

## Route tree

```text
RootLayout
├── /                         SIL OFL font catalog
│   ├── loading.tsx           route loading shell
│   └── CatalogIsland         interactive client catalog
├── /api/graphql              GraphQL Yoga endpoint
│   ├── GET                   queries; GraphiQL HTML outside production
│   ├── POST                  GraphQL request documents
│   └── OPTIONS               CORS preflight
├── /favicon.ico              site icon
└── all other paths           not-found response
```

There are no authenticated routes, mutations, dialogs, overlays, nested page
routes, or application navigation menus.

## `/` catalog surface

The page is a Server Component shell with one client island. The interactive
surface appears in this order:

1. Header
   - “SIL OFL Fonts” page identity
   - repository, font, owner, and repository-with-files statistics
2. Filter and navigation bar
   - full-text search
   - format select: Any, TTF, OTF, WOFF, WOFF2
   - exact owner input
   - minimum-star input
   - sort select
   - Webfont-only toggle
   - Variable-only toggle
   - Dense/list-mode toggle
   - Previous and Next pagination controls
3. Active-filter strip
   - matched result count
   - one removable chip per active filter
   - Clear all
4. Font specimen
   - editable specimen text
   - selected/preview font metadata
   - face-loading, failure, and retry states
5. Use panel, when a font is selected
   - selected family, weight, and style
   - Copy CSS
   - Copy HTML page
   - Copy for React
   - Copy CDN URL
   - Copy raw URL
   - Download file
   - Open repository on GitHub
   - scrollable snippet preview
6. Results
   - default virtualized font list, or
   - dense sortable table
   - row hover/focus preview
   - row selection
   - initial, placeholder, empty, error, and retry states

## Client component tree

```text
CatalogIsland
└── QueryProvider
    └── CatalogIslandInner
        └── FontCatalogShellContext
            ├── header
            │   └── StatsStrip
            ├── FontFilterBar
            │   ├── FontSearchField
            │   ├── filter controls
            │   └── PaginationControls
            ├── FilterChips
            ├── FontSpecimen
            ├── FontUsePanel
            └── CatalogErrorBoundary
                ├── FontList
                │   └── virtualized FontRow controls
                └── DenseFontTable
                    └── sortable headers and row controls
```

The list, dense table, specimen, and use panel are dynamically loaded client
chunks. TanStack Query owns server-state caching. XState machines own catalog
and specimen transitions.

## Catalog state

### URL-backed

- `q`: search query
- `format`: selected format
- `owner`: exact owner
- `after`: forward cursor
- `sort`: non-default sort
- `font`: selected font identifier

### Session-only

- minimum stars
- Webfont-only
- Variable-only
- dense mode
- editable specimen text
- cursor history used for Previous
- loaded face and clipboard feedback

### Catalog machine

The catalog machine owns search debounce, normalized filters, sort, current
cursor, cursor stack, page number, dense mode, and selected font identifier.
Criteria changes reset pagination. The browser URL is a projection of the
documented URL-backed subset.

### Specimen machine

The specimen machine owns the active record, generated family name, face-load
stage, selected/preview status, editable text, and retry state. Font binaries
are loaded with `FontFace` from the record’s CDN URL with raw URL fallback.

## `/api/graphql` surface

The API is query-only.

| Query | Purpose | Main inputs |
| --- | --- | --- |
| `health` | process liveness and timestamp | none |
| `stats` | catalog aggregate counts | none |
| `fonts` | filtered, sorted font connection | filter, sort, first, after |
| `font` | one visible font record | id |
| `repos` | filtered repository connection | filter, first, after |
| `repo` | one repository record | owner, name |

Font connection sorts:

- reputation ascending and descending
- stars ascending and descending
- family ascending and descending
- identifier ascending and descending

Both connections use forward keyset cursors and return `edges`, `pageInfo`, and
`totalCount`.

## External boundaries

- Neon PostgreSQL is accessed only by server-side GraphQL resolvers.
- Browser data requests are same-origin calls to `/api/graphql`.
- Font previews load database-provided HTTPS assets from approved jsDelivr or
  raw GitHub locations.
- Download and repository actions navigate to approved external HTTPS targets.
- Clipboard actions use the browser Clipboard API with a legacy fallback.
- Development GraphiQL loads only outside production.

## Responsive modes

- Standard list: virtualized vertical rows.
- Dense mode: compact table with an internal horizontal scroll region.
- Filter controls wrap as width decreases.
- Supported browser width begins at 320 CSS pixels.
- Reduced-motion preferences suppress non-essential transitions.

## Recovery surfaces

- route loading skeleton
- list/table loading and retained-data states
- empty result state
- catalog error boundary
- data request retry
- font-face retry
- malformed URL reset
- not-found return-to-catalog link
