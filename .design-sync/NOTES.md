# design-sync notes — SIL OFL Fonts

Repo-specific gotchas for future syncs. Read this before touching anything.

## What this design system is

`web-app` is a private Next.js 16 application, not a published component
library. The design system is the token layer in `src/app/globals.css`
(Klim-inspired: black surface, `--primary` orange `14 100% 42%`, `--radius: 0`,
tabular figures) plus 14 components under `src/components/`.

There was no Storybook before the first sync — it was created as part of it.

## Structural facts

- `[GENERAL]` **The package has no library build.** No `main`/`module`/
  `exports`, no `dist/`. `src/ds-entry.tsx` is the barrel that gives the
  converter an entry; it only re-exports what the app already ships. Its imports
  are RELATIVE on purpose — emitted `.d.ts` files keep their specifiers verbatim
  and `@/…` aliases would not resolve for the consumer reading them.
- `[GENERAL]` **The `.d.ts` tree is generated, not shipped.** `cfg.buildCmd`
  (`bunx tsc -p .design-sync/tsconfig.dts.json`) emits it to `.design-sync/dts/`
  and `package.json`'s `types` points there. Without it the converter's export
  scan returns 0 names, every storybook title is dropped as `[TITLE_UNMAPPED]`,
  and `components: 0`. It also supplies every `<Name>Props` contract, so a
  missing `dts/` silently degrades the design agent's API view. `dts/` is
  gitignored — regenerate it on a fresh clone before building.
- `FontCatalogShell` and `CatalogShell` are aliases of `CatalogIsland`, so 16
  exported names are 14 distinct components.

## Preview scaffolding

- `[GENERAL]` **12 of 14 components require the catalog shell context.** Only
  `Button`, `FontRow`, `CatalogSkeleton` and `CatalogErrorBoundary` render
  standalone. The rest call `useFontCatalogShellContext()`, which in the app is
  produced by `CatalogIsland` from two XState machines, TanStack Query, the Next
  app-router URL and a live GraphQL request.
  `.design-sync/preview/catalog-shell-provider.tsx` supplies that context as a
  fixed value; stories wrap themselves in `CatalogPreviewProvider`. Consumers
  read only `catalog.context.after`, `catalog.context.cursorStack`,
  `specimen.weight` and `specimen.style` off the machine objects, so those two
  fields are narrowed rather than modelled.
- Row fixtures are real OFL repositories from `data/all.jsonl` (Fira Code,
  Iosevka, Inter, JetBrains Mono…). URLs follow the origins approved by
  `src/lib/external-url-policy.ts`, so `FontUsePanel` snippets stay valid
  (INV-ARTIFACT-1/2).
- `useFontList` renders `specimenText || displayName`, so `buildFontRowInput`
  defaults its sample to the shared specimen string — a standalone `FontRow`
  then looks like a row inside the list.

## Fixes that are already in config — do not rediscover

- `[GENERAL]` **Preview cards force `body{background:#fff}`.** The card template
  hardcodes it after the stylesheet links, and every component here takes its
  surface from `body` via globals.css. Without a wrapper the cards render
  white-on-white and still pass the render check (root is non-empty). Fixed with
  `cfg.provider` → `DesignSurface`, which mirrors `src/app/layout.tsx`'s body
  classes (`bg-background text-foreground`). **Designs built from `styles.css`
  are unaffected** — its import closure carries the real `body` rule. If cards
  ever look washed out again, check this provider first.
- `[GENERAL]` **Geist has no `@font-face` anywhere.** The app loads it through
  `next/font/google`, which publishes `--font-geist-sans`/`--font-geist-mono`
  at runtime — nothing a bundle can ship. `.design-sync/fonts/geist.css` (+ two
  latin variable woff2 from Google Fonts, OFL-1.1) redeclares both faces and
  both custom properties. Wired via `cfg.extraFonts`, and linked into Storybook
  through `.storybook/preview-head.html`. `layout.tsx` is untouched.
- `[GENERAL]` **Fonts must not be imported from `.storybook/preview.tsx`.** A JS
  import pulls `.woff2` into the decorator bundle, which has no loader for it
  (`! preview decorator bundle failed`). They are served from the `/ds-fonts`
  staticDir instead.
- `[GENERAL]` **`--font-geist-sans` must be declared in the scraped CSS.** This
  is the subtlest failure in this repo and it is invisible to the compare loop.
  `globals.css` defines `--font-sans: var(--font-geist-sans), ui-sans-serif, …`
  but never defines `--font-geist-sans` — next/font does, at runtime.
  `cfg.extraFonts` harvests only `@font-face` rules, so the bundle shipped the
  Geist faces while `--font-sans` still resolved to the system stack: fonts
  present, never used. `cfg.tokensGlob` cannot fix this (it only applies
  alongside `cfg.tokensPkg`, resolved under `node_modules`). The fix is
  `.design-sync/tokens/font-family-vars.css`, imported by
  `.storybook/preview.tsx` so the declarations land in Storybook's compiled CSS,
  which is what `[CSS_FROM_STORYBOOK]` scrapes into `_ds_bundle.css`. It holds no
  `url()` refs, so it does not reintroduce the woff2 loader problem.
  **How it was caught:** `FontSpecimen`'s italic story. The specimen sets
  `font-synthesis: none`, so with Geist loaded an italic face renders upright
  (Geist ships no italic), while the system fallback has a real italic and
  slants. The two panels diverged and exposed it. Verify after any font change
  with a headless check of `getComputedStyle(document.documentElement)
  .getPropertyValue('--font-geist-sans')` and `document.fonts` on a preview page
  — sans should be `"Geist"` and the face `loaded`. Sheets alone will not tell
  you: Geist and the macOS system font are near-identical at card sizes.
- `CatalogIsland` has an **owned preview** (`.design-sync/previews/`). The
  generated wrapper cannot reproduce two things Storybook's runtime supplies:
  `parameters.nextjs.navigation` (the app-router context — `useCatalogMachine`
  calls `usePathname`/`useSearchParams`, which return null without it and throw)
  and `beforeEach` (the GraphQL stub, since story lifecycle hooks do not run in a
  compiled preview). The owned copy provides Next's `PathnameContext` /
  `SearchParamsContext` directly — the machine writes URLs with
  `window.history.replaceState`, so no router object is needed — and installs
  the stub at module scope. `cfg.storyImports.bundle: ["next/dist/"]` keeps those
  context imports resolving to the real package instead of being shimmed.
- `FontList` uses `cardMode: "column"` — its `Empty` story renders wider than a
  grid cell (`[GRID_OVERFLOW] … wide`).
- **`DesignSurface` must stay colour-only.** It first carried
  `flex flex-col` to mirror `layout.tsx`'s body, which stretched bare inline
  children — a lone `<Button>` spanned the whole card instead of hugging its
  label, while stories that wrap their own flex row looked fine. The provider
  wraps every preview, so any layout it imposes silently distorts simple ones.
- The owned `CatalogIsland` preview is written with real types, not the
  generated wrapper's `any`s: `.design-sync/**` is inside `tsconfig`'s include
  and eslint's scope, so `no-explicit-any` and `react/display-name` fail the lint
  gate. It renders `stories.default.component` — the story's own import, already
  redirected to `window.SilOflFontsDS` — rather than re-importing the component.
- **eslint must ignore generated trees.** `storybook-static/`, `.ds-sync/`,
  `ds-bundle/`, `.design-sync/sb-reference/`, `.design-sync/dts/` and
  `.design-sync/.cache/` are in `eslint.config.mjs`'s `globalIgnores`; without
  them `bun run lint` fails with thousands of errors from minified bundles.
  Authored sources (`.design-sync/preview/`, `previews/`, `tokens/`) stay linted
  deliberately.

## Repository contracts that constrain this sync

`INVARIANTS.md` is binding for every change here, and two invariants bite:

- **INV-REPO-1 (Bun is authoritative).** Use `bun`/`bunx`, never npm/yarn/pnpm,
  for anything in the repo. `scripts/repository-contract.test.ts` asserts via
  `git ls-files -co` that `bun.lock` is the only lockfile — so `.ds-sync/` (which
  carries an npm lockfile for the converter's own deps) **must stay gitignored**.
- **INV-REPO-3 (quality gates stay green).** `bun run audit`, `lint`,
  `typecheck`, `test`, `test:e2e`, `build` must all pass. Stories and
  `.design-sync/*.tsx` are inside `tsconfig`'s `include`, so they are typechecked
  under `strict` + `noUncheckedIndexedAccess`. `eslint` bans `useEffect`.
  Generated output (`storybook-static/`, `.ds-sync/`, `ds-bundle/`) is in
  eslint's ignore list — without that, lint fails on minified bundles.

## Known render warns

- `catalog-error-boundary--caught` reports a `pageerror` in Storybook. That is
  the story's deliberate throw being caught by the boundary under test — the
  boundary renders its safe fallback correctly. Not a failure.

## Re-sync risks

- **`.design-sync/dts/` is generated and gitignored.** A fresh clone must run
  `cfg.buildCmd` before `package-build.mjs`, or the sync silently produces zero
  components. Same for `.design-sync/sb-reference/` (rebuild with
  `bunx storybook build -c .storybook -o "$(git rev-parse --show-toplevel)/.design-sync/sb-reference"`).
- **The catalog-shell fixture is a hand-maintained mirror of
  `UseFontCatalogShellReturn`.** If that hook gains a field consumers read, the
  fixture goes stale and previews break in ways typecheck may not catch (the
  machine slices are cast). Re-read `use-font-catalog-shell.ts` on any sync that
  follows catalog changes.
- **`CatalogIsland`'s owned preview depends on Next internals**
  (`next/dist/shared/lib/hooks-client-context.shared-runtime`). That path is not
  a public API and can move between Next majors. If its card goes blank after a
  Next upgrade, check that module's exports first.
- **Geist woff2 files were fetched from Google Fonts at sync time** and are
  committed under `.design-sync/fonts/`. They are pinned copies, not a live
  dependency; refresh them deliberately if the app's Geist version moves.
- **The GraphQL stub keys off the request body containing `CatalogStats`.** If
  the operation is renamed, `CatalogIsland` previews will serve the fonts payload
  to the stats query.
- Storybook was introduced by this sync. If the team later adds their own
  stories, re-check `titleMap` — component discovery keys off the last title
  segment matching an export name from `src/ds-entry.tsx`.
