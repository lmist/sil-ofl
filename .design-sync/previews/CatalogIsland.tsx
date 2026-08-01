import * as React from "react";
import * as stories from "@ds-stories/src/components/catalog/catalog-island.stories";
import {
  PathnameContext,
  SearchParamsContext,
} from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { installCatalogGraphqlStub } from "@ds-stories/.design-sync/preview/catalog-shell-provider";

/**
 * Owned preview for CatalogIsland.
 *
 * The generated wrapper composes the story module but cannot reproduce two
 * things Storybook's own runtime supplies, and without them the card is blank:
 *
 *  1. `parameters.nextjs.navigation` — @storybook/nextjs-vite installs an
 *     app-router context. useCatalogMachine calls usePathname/useSearchParams,
 *     which read that context and return null outside a Next runtime, so the
 *     island throws on mount. Next's own context providers are supplied below
 *     (the machine writes URLs with window.history.replaceState, so no router
 *     object is needed).
 *  2. `beforeEach` — the story's GraphQL stub. Story lifecycle hooks do not run
 *     in a compiled preview, so the stub is installed at module scope instead.
 *
 * The component rendered is `meta.component`, i.e. the real CatalogIsland from
 * the bundle — the story's own import, redirected to window.SilOflFontsDS.
 * Only its environment is supplied here. The Default story takes no args and
 * defines no custom render, so no arg composition is needed.
 */

installCatalogGraphqlStub();

const EMPTY_SEARCH_PARAMS = new URLSearchParams();

const CatalogIsland = stories.default.component;

export function Default() {
  return (
    <PathnameContext.Provider value="/">
      <SearchParamsContext.Provider value={EMPTY_SEARCH_PARAMS}>
        <CatalogIsland />
      </SearchParamsContext.Provider>
    </PathnameContext.Provider>
  );
}
