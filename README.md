# SIL OFL Fonts — web-app

Production scaffold for a Klim-inspired Open Font License catalog.  
**GraphQL is the only UI API surface.** The temporary Go REST API
(`https://sil-ofl-fonts.vercel.app`) remains a backend reference only.

## Architecture

```
Browser
  │
  ├─ XState catalogMachine     → search / filter / page / selection UI state
  ├─ TanStack Query            → server-state cache keyed by GraphQL variables
  ├─ TanStack Table + Virtual  → dense specimen index (thousands of rows)
  │
  ▼  POST /api/graphql  (graphql-request)
Next.js App Router Route Handler
  │
  ├─ GraphQL Yoga              → HTTP GraphQL engine + GraphiQL (dev)
  ├─ Pothos schema             → type-safe resolvers (fonts, repos, stats)
  │
  ▼  @neondatabase/serverless (DATABASE_URL)
Neon Postgres
  │
  ├─ v_renderable_fonts        → join font_files × repos × owners
  ├─ pg_trgm indexes           → ILIKE / FTS-style family & name search
  └─ cdn_url (jsDelivr)        → preferred @font-face source
```

**Data flow in prose**

1. Catalog UI events update an **XState** machine (query string, format,
   pagination offset, selected font). Components stay headless — no business
   logic in JSX.
2. Hooks map machine context → **TanStack Query** keys and call
   **graphql-request** against `/api/graphql`.
3. **GraphQL Yoga** serves the Pothos schema; resolvers query Neon via the
   serverless HTTP driver against `v_renderable_fonts` and related tables
   (trigram indexes for search).
4. Specimen rows load `cdnUrl` into `@font-face` (jsDelivr); `rawUrl` is a
   fallback. Images/font hosts are allow-listed in `next.config.ts`.

## Why graphql-request (not urql / Apollo Client)

- **XState** owns interaction state; **TanStack Query** owns server cache.
- A full GraphQL client store would compete with both.
- `graphql-request` is a thin typed `fetch` — works in hooks *and* machine
  actions without extra providers.

## Stack

| Layer | Packages |
|-------|----------|
| Framework | Next.js App Router, React 19, TypeScript (strict) |
| API | GraphQL Yoga, Pothos, graphql |
| DB | Neon (`@neondatabase/serverless`) |
| Client data | graphql-request, @tanstack/react-query |
| Tables / lists | @tanstack/react-table, @tanstack/react-virtual |
| UI state | xstate v5, @xstate/react |
| UI | Tailwind v4, shadcn-style CVA + CSS variables (neutral / new-york) |

## Folders (headless rule)

```
src/
  app/              # routes + GraphQL route handler
  components/       # presentational shells only
  graphql/          # schema, documents, client
  hooks/            # Query + useMountEffect
  machines/         # XState machines
  lib/              # db, utils, env
  types/            # domain types
```

## Setup

```bash
cp .env.example .env.local
# set DATABASE_URL to your Neon pooled connection string

npm install
npm run dev      # Turbopack
npm run build
npm run lint
```

GraphiQL (non-production): [http://localhost:3000/api/graphql](http://localhost:3000/api/graphql)

### Example query

```graphql
query {
  stats { repos fontFiles owners reposWithFiles }
  fonts(q: "charis", limit: 10) {
    count
    nodes { familyGuess fileName cdnUrl stars fullName }
  }
}
```

## ESLint

`useEffect` / `React.useEffect` are banned via `no-restricted-syntax`.  
Escape hatch: `import { useMountEffect } from "@/hooks/use-mount-effect"`.

## Design

Tokens from `../docs/klim-design-tokens.json` — pure black field, scarce
accent `#D83000`, radius 0, no cards/shadows. See design brief for specimen
row language.

## Schema source

Postgres DDL: `../sql/001_schema.sql`  
Temporary REST reference: `https://sil-ofl-fonts.vercel.app`
