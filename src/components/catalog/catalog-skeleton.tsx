/**
 * Klim-density skeleton for catalog streaming (loading.tsx + Suspense).
 * Server Component — no client JS. Matches header / filter / row geometry.
 */
export function CatalogSkeleton() {
  return (
    <section
      className="flex min-h-0 flex-1 flex-col"
      aria-label="Font catalog"
      aria-busy="true"
      data-catalog-skeleton
    >
      {/* Header bar — 3rem, title + stats */}
      <header className="flex h-[var(--header-height)] shrink-0 items-center justify-between border-b border-border px-[var(--gutter)]">
        <h1 className="relative h-3 w-24">
          <span className="sr-only">SIL OFL Fonts</span>
          <span
            aria-hidden="true"
            className="block h-full w-full bg-foreground/[0.08]"
          />
        </h1>
        <div className="flex items-center gap-4">
          <div className="h-2.5 w-16 bg-foreground/[0.06]" />
          <div className="h-2.5 w-12 bg-foreground/[0.06]" />
          <div className="h-2.5 w-14 bg-foreground/[0.06]" />
        </div>
      </header>

      {/* Filter strip */}
      <div className="flex flex-wrap items-end gap-3 border-b border-border px-[var(--gutter)] py-3">
        <div className="h-9 w-full max-w-xs border border-border bg-transparent" />
        <div className="h-9 w-28 border border-border bg-transparent" />
        <div className="h-9 w-24 border border-border bg-transparent" />
        <div className="h-9 w-20 border border-border bg-transparent" />
      </div>

      {/* Quiet filter chips row */}
      <div className="flex flex-wrap gap-2 border-b border-border px-[var(--gutter)] py-2">
        <div className="h-6 w-16 bg-foreground/[0.05]" />
        <div className="h-6 w-20 bg-foreground/[0.05]" />
        <div className="h-6 w-14 bg-foreground/[0.05]" />
      </div>

      {/* Specimen-scale row placeholders — large type rhythm */}
      <div className="flex flex-1 flex-col px-[var(--gutter)]">
        {Array.from({ length: 4 }, (_, i) => (
          <div
            key={i}
            className="flex flex-col justify-center gap-3 border-b border-border py-6"
            style={{ minHeight: "var(--catalog-row-gap)" }}
          >
            <div
              className="bg-foreground/[0.06]"
              style={{
                height: "clamp(2rem, 6vw, 3.5rem)",
                width: `${72 - i * 8}%`,
                maxWidth: "42rem",
              }}
            />
            <div className="flex gap-4">
              <div className="h-2.5 w-28 bg-foreground/[0.04]" />
              <div className="h-2.5 w-20 bg-foreground/[0.04]" />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
