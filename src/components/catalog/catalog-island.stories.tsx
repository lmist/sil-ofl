import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { CatalogIsland } from "@/components/catalog/catalog-island";
import { installCatalogGraphqlStub } from "../../../.design-sync/preview/catalog-shell-provider";

const meta = {
  title: "Catalog/CatalogIsland",
  component: CatalogIsland,
  parameters: {
    layout: "fullscreen",
    // useCatalogMachine reads usePathname/useSearchParams; without an app-router
    // context Storybook hands back null and the island throws on mount.
    nextjs: {
      appDirectory: true,
      navigation: { pathname: "/", query: {} },
    },
  },
  // CatalogIsland is the only component that fetches. The stub answers its two
  // GraphQL documents from the shared fixtures and is removed afterwards, so no
  // other story sees a patched fetch.
  beforeEach: () => installCatalogGraphqlStub(),
} satisfies Meta<typeof CatalogIsland>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The whole catalog: header and statistics, filter bar, active chips, and the
 * virtualized specimen list inside its error boundary. This is the composition
 * the home route renders, and the reference for assembling the catalog parts.
 *
 * Also exported as FontCatalogShell and CatalogShell for older imports.
 */
export const Default: Story = {};
