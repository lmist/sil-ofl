import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { FontSearchField } from "@/components/catalog/font-search-field";
import {
  CatalogPreviewProvider,
  buildCatalogShellValue,
} from "../../../.design-sync/preview/catalog-shell-provider";

const meta = {
  title: "Catalog/FontSearchField",
  component: FontSearchField,
  parameters: { layout: "padded" },
} satisfies Meta<typeof FontSearchField>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Empty field with its placeholder — hairline border, focus turns it white. */
export const Empty: Story = {
  render: () => (
    <CatalogPreviewProvider>
      <div className="max-w-sm">
        <FontSearchField />
      </div>
    </CatalogPreviewProvider>
  ),
};

/** A committed term. Debounce is owned by the catalog machine, not the input. */
export const WithTerm: Story = {
  render: () => (
    <CatalogPreviewProvider value={buildCatalogShellValue({ q: "mono" })}>
      <div className="max-w-sm">
        <FontSearchField />
      </div>
    </CatalogPreviewProvider>
  ),
};
