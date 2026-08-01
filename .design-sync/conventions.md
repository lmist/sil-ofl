# SIL OFL Fonts — how to build with this design system

A dark, Klim-inspired type catalog UI. Black surface, one scarce orange accent,
hairline rules, square corners (`--radius: 0px`), tabular figures. There are no
cards and no shadows — separation comes from 1px borders and whitespace.

## Always wrap in `DesignSurface`

Components take their background and text colour from an ancestor, not from
themselves. Render anything outside `DesignSurface` and it paints
white-on-white.

```jsx
<DesignSurface>
  <Button>Browse catalog</Button>
</DesignSurface>
```

`DesignSurface` applies `bg-background text-foreground` and nothing else — no
layout — so it composes anywhere.

## Catalog components need a shell context

`Button`, `FontRow`, `CatalogSkeleton` and `CatalogErrorBoundary` are standalone.
Every other catalog component (`FontList`, `DenseFontTable`, `FontSpecimen`,
`FontUsePanel`, `FilterChips`, `FontFilterBar`, `FontSearchField`,
`StatsStrip`, `PaginationControls`) reads a catalog context and throws without
it. Supply it with `CatalogPreviewProvider`:

```jsx
<DesignSurface>
  <CatalogPreviewProvider value={buildCatalogShellValue({ selectedFontId: 4101 })}>
    <FontSpecimen />
    <FontList />
  </CatalogPreviewProvider>
</DesignSurface>
```

`buildCatalogShellValue(options)` builds a complete, static context from ten real
OFL faces. Useful options: `selectedFontId`, `q`, `edges`, `isEmpty`, `error`,
`denseMode`, `onLaterPage`, `statsError`, `format`, `owner`, `minStars`,
`webfont`, `variable`. `PREVIEW_FONTS` is the row data; `buildFontRowInput(node)`
builds props for a standalone `FontRow`.

`CatalogIsland` (aliases `FontCatalogShell`, `CatalogShell`) is the whole page —
it creates its own context and fetches over GraphQL. Use it for a full catalog;
use the parts plus `CatalogPreviewProvider` for anything else.

## Styling: read this before you write a class name

Tailwind v4 with shadcn-style CSS variables. **The shipped stylesheet is
JIT-compiled from this application's own source, so it contains only the ~206
classes the app actually uses.** A class outside that set does not exist and
silently does nothing — `bg-secondary`, `bg-accent`, `text-destructive` and bare
`ring-ring` are all absent even though their tokens are defined.

Colour utilities that exist:

| Purpose | Class |
|---|---|
| Page / surface | `bg-background` |
| Body text | `text-foreground`, `text-foreground/80` |
| Secondary text | `text-muted-foreground` |
| Accent fill | `bg-primary` + `text-primary-foreground` |
| Hairline | `border-border`, `border-b`, `hover:border-border-strong` |
| Transparent field | `bg-transparent` |
| Focus ring | `focus-visible:ring-ring`, `focus-visible:outline-ring` |

Layout, spacing, sizing and typography utilities are ordinary Tailwind and
present for the values the app uses (`flex`, `grid`, `gap-*`, `px-*`, `py-*`,
`text-xs`/`text-sm`/`text-4xl`, `truncate`, `tabular-nums`, `antialiased`).

**For anything the utility set does not cover, use the tokens directly** — the
token layer is complete, and inline styles always resolve:

```jsx
<div style={{ background: "hsl(var(--secondary))", color: "hsl(var(--foreground))" }} />
```

Tokens defined in `:root` (HSL channel triples unless noted): `--background`,
`--foreground`, `--muted`, `--muted-foreground`, `--border`, `--border-strong`,
`--primary`, `--primary-hover`, `--primary-foreground`, `--ring`, `--card`,
`--card-foreground`, `--popover`, `--popover-foreground`, `--secondary`,
`--secondary-foreground`, `--accent`, `--accent-foreground`, `--destructive`,
`--destructive-foreground`, `--input`; plus `--radius` (`0px`), `--gutter`,
`--header-height`, `--catalog-row-gap`, `--dur-fast`, `--dur-med`, and the type
stacks `--font-sans` / `--font-mono` (Geist and Geist Mono, bound via
`--font-geist-sans` / `--font-geist-mono`).

Use `var(--gutter)` for page-edge padding and `--dur-fast` / `--dur-med` for
transitions; pair every transition with `motion-reduce:transition-none`.

## Where the truth lives

- `_ds/<folder>/styles.css` and its imports — the real compiled CSS. Read it
  before inventing a class name.
- `components/<group>/<Name>/<Name>.prompt.md` — per-component API and usage.
- `guidelines/INVARIANTS.md` — the application's binding contract. The
  accessibility rules apply to anything built here: WCAG 2.2 AA contrast,
  24×24px minimum targets, no colour-only signals, no document-level horizontal
  overflow at 320px, and `prefers-reduced-motion` honoured.

## A representative composition

```jsx
<DesignSurface>
  <CatalogPreviewProvider value={buildCatalogShellValue({ q: "mono", format: "woff2" })}>
    <header className="flex min-h-[var(--header-height)] items-center justify-between border-b border-border px-[var(--gutter)]">
      <h1 className="text-[0.8125rem] tracking-tight text-foreground">SIL OFL Fonts</h1>
      <StatsStrip />
    </header>
    <FontFilterBar />
    <FilterChips />
    <FontList />
  </CatalogPreviewProvider>
</DesignSurface>
```
