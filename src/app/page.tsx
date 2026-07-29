import { Suspense } from "react";
import { CatalogIsland } from "@/components/catalog/catalog-island";
import { CatalogSkeleton } from "@/components/catalog/catalog-skeleton";

/**
 * Home is a Server Component static shell.
 * Interactive catalog (machines / virtual list / specimen) is a client island.
 */
export default function HomePage() {
  return (
    <main className="flex min-h-full flex-1 flex-col">
      <Suspense fallback={<CatalogSkeleton />}>
        <CatalogIsland />
      </Suspense>
    </main>
  );
}
