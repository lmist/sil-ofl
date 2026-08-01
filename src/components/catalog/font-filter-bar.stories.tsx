import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { FontFilterBar } from "@/components/catalog/font-filter-bar";
import {
  CatalogPreviewProvider,
  buildCatalogShellValue,
} from "../../../.design-sync/preview/catalog-shell-provider";

const meta = {
  title: "Catalog/FontFilterBar",
  component: FontFilterBar,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof FontFilterBar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The full filter strip: search, format, owner, stars, toggles, pagination. */
export const Default: Story = {
  render: () => (
    <CatalogPreviewProvider>
      <FontFilterBar />
    </CatalogPreviewProvider>
  ),
};

/** Every filter engaged at once — the densest state the bar reaches. */
export const AllFiltersActive: Story = {
  render: () => (
    <CatalogPreviewProvider
      value={buildCatalogShellValue({
        q: "mono",
        format: "woff2",
        owner: "JetBrains",
        minStars: 1000,
        webfont: true,
        variable: true,
        onLaterPage: true,
      })}
    >
      <FontFilterBar />
    </CatalogPreviewProvider>
  ),
};
