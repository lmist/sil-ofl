import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { PaginationControls } from "@/components/catalog/pagination-controls";
import {
  CatalogPreviewProvider,
  buildCatalogShellValue,
} from "../../../.design-sync/preview/catalog-shell-provider";

const meta = {
  title: "Catalog/PaginationControls",
  component: PaginationControls,
  parameters: { layout: "padded" },
} satisfies Meta<typeof PaginationControls>;

export default meta;
type Story = StoryObj<typeof meta>;

/** First page — Previous is unavailable because no cursor has been pushed. */
export const FirstPage: Story = {
  render: () => (
    <CatalogPreviewProvider>
      <PaginationControls />
    </CatalogPreviewProvider>
  ),
};

/** A later page enables Previous; the label tracks the settled page. */
export const LaterPage: Story = {
  render: () => (
    <CatalogPreviewProvider value={buildCatalogShellValue({ onLaterPage: true })}>
      <PaginationControls />
    </CatalogPreviewProvider>
  ),
};

/** No results — forward traversal is locked (INV-PAGE-1). */
export const NoResults: Story = {
  render: () => (
    <CatalogPreviewProvider
      value={buildCatalogShellValue({ isEmpty: true, edges: [] })}
    >
      <PaginationControls />
    </CatalogPreviewProvider>
  ),
};
