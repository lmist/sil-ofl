import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { DenseFontTable } from "@/components/catalog/dense-font-table";
import {
  CatalogPreviewProvider,
  buildCatalogShellValue,
} from "../../../.design-sync/preview/catalog-shell-provider";

const meta = {
  title: "Catalog/DenseFontTable",
  component: DenseFontTable,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof DenseFontTable>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Dense mode: every face as a sortable row of tabular columns. */
export const Default: Story = {
  render: () => (
    <CatalogPreviewProvider value={buildCatalogShellValue({ denseMode: true })}>
      <DenseFontTable />
    </CatalogPreviewProvider>
  ),
};

/** Selection reads the same in dense mode as in the specimen list. */
export const WithSelection: Story = {
  render: () => (
    <CatalogPreviewProvider
      value={buildCatalogShellValue({ denseMode: true, selectedFontId: 4104 })}
    >
      <DenseFontTable />
    </CatalogPreviewProvider>
  ),
};

/** Dense mode offers the same failure and recovery behaviour (INV-ERROR-3). */
export const LoadError: Story = {
  render: () => (
    <CatalogPreviewProvider
      value={buildCatalogShellValue({
        denseMode: true,
        error: "Could not load the font catalog.",
        edges: [],
      })}
    >
      <DenseFontTable />
    </CatalogPreviewProvider>
  ),
};
