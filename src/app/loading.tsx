import { CatalogSkeleton } from "@/components/catalog/catalog-skeleton";

/**
 * Route-level streaming fallback — Klim density matches catalog chrome.
 * Ships with the static shell so TTFB HTML paints before client islands hydrate.
 */
export default function Loading() {
  return (
    <main className="flex min-h-full flex-1 flex-col">
      <CatalogSkeleton />
    </main>
  );
}
