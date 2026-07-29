# Performance budgets — SIL OFL Fonts catalog

Targets for the home catalog route on Vercel (region `iad1`) with warm Neon.

## Budgets

| Metric | Target | Notes |
|--------|--------|--------|
| **JS client for home island** | **&lt; 180KB gzip** | Catalog island + Query + XState; virtualizer/table code-split off critical path |
| **fonts GraphQL p95** | **&lt; 100ms** on warm Neon | `first: 50`, simple filter (no q / owner), cold TTFB excluded |
| **List scroll** | **60fps** with virtualizer | Theoretical **5k+** rows; only overscan ~10 rows mount; no `@font-face` offscreen |
| **TTFB** (HTML shell) | **&lt; 200ms** p75 edge | Static shell via Cache Components / PPR + `loading.tsx` |
| **LCP** (catalog home) | **&lt; 2.5s** p75 | Large specimen type or first visible row; UI chrome via `next/font` (Geist) only |
| **INP** | **&lt; 200ms** p75 | Search debounce in machine; filter chips / row select stay lightweight |

## Architecture (what keeps us under budget)

1. **Server Components by default** — `layout.tsx` / `page.tsx` / `loading.tsx` / skeleton have zero client JS.
2. **Client island** — `CatalogIsland` owns machines, TanStack Query, filters, list, specimen.
3. **Dynamic imports** — `FontList` (`@tanstack/react-virtual`), `DenseFontTable`, `FontSpecimen` load as separate chunks.
4. **`next/font`** — Geist / Geist Mono for UI chrome only. Catalog OFL faces load via on-demand `@font-face` from jsDelivr / raw GitHub (never bundled).
5. **Streaming** — `loading.tsx` + nested `Suspense` ship Klim-density skeletons immediately.
6. **Cached stats** — GraphQL `stats` uses `unstable_cache` (`src/lib/cached-stats.ts`, revalidate 60s, tag `catalog-stats`).
7. **CDN headers** — `/_next/static/*` is immutable and public assets use short max-age + SWR. `src/app/api/graphql/route.ts` is the single GraphQL cache-policy source: only successful anonymous cache-safe GET operations receive SWR; POST and error responses are `no-store`.
8. **No heavy date/util libs** — no `moment`, no full `lodash` imports. Prefer native `Intl` / small helpers.
9. **Images** — prefer none for the font catalog; `images.remotePatterns` allow-listed if needed later (`next/image`).
10. **PPR / Cache Components** — `cacheComponents: true` in `next.config.ts` (Next 16 stable).

## Bundle analysis

```bash
npm run analyze          # interactive Turbopack analyzer
npm run analyze:output   # write .next/diagnostics/analyze
```

Watch for accidental full-package imports of `lucide-react`, table, or virtual.

## Measuring

- **Home island JS**: Network tab → JS transferred for `/` after first load (exclude RSC flight), or analyzer client filter for the catalog chunk graph.
- **GraphQL p95**: Vercel/Neon query logs or wrap `fonts` resolver with `performance.now()` in staging; sample `first: 50` REPUTATION_DESC no filter.
- **Scroll 60fps**: Chrome Performance while flinging the virtual list with ≥50 edges (synthetic larger counts via mock for 5k stress).
- **CWV**: Vercel Speed Insights / CrUX; local `web-vitals` if needed.

## Non-goals

- Prefetching thousands of `@font-face` rules (faces load on select/hover only).
- Shipping catalog font binaries through the Next bundle.
- Full-page client SPA shell without a static HTML fallback.
