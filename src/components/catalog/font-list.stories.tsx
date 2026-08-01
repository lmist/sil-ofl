import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { FontList } from "@/components/catalog/font-list";
import {
  CatalogPreviewProvider,
  buildCatalogShellValue,
} from "../../../.design-sync/preview/catalog-shell-provider";

const meta = {
  title: "Catalog/FontList",
  component: FontList,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof FontList>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The window-virtualized specimen list — one large row per face. */
export const Default: Story = {
  render: () => (
    <CatalogPreviewProvider>
      <FontList />
    </CatalogPreviewProvider>
  ),
};

/** A selected row stays visually distinct within the list. */
export const WithSelection: Story = {
  render: () => (
    <CatalogPreviewProvider
      value={buildCatalogShellValue({ selectedFontId: 4102 })}
    >
      <FontList />
    </CatalogPreviewProvider>
  ),
};

/** No matches — an actionable empty state rather than a blank region. */
export const Empty: Story = {
  render: () => (
    <CatalogPreviewProvider
      value={buildCatalogShellValue({ isEmpty: true, edges: [], q: "zzzz" })}
    >
      <FontList />
    </CatalogPreviewProvider>
  ),
};

/**
 * Inline catalog failure keeps the surrounding chrome alive and offers Retry
 * with safe copy only (INV-ERROR-1, INV-ERROR-3).
 */
export const LoadError: Story = {
  render: () => (
    <CatalogPreviewProvider
      value={buildCatalogShellValue({
        error: "Could not load the font catalog.",
        edges: [],
      })}
    >
      <FontList />
    </CatalogPreviewProvider>
  ),
};
