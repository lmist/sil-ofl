import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { FilterChips } from "@/components/catalog/filter-chips";
import {
  CatalogPreviewProvider,
  buildCatalogShellValue,
} from "../../../.design-sync/preview/catalog-shell-provider";

const meta = {
  title: "Catalog/FilterChips",
  component: FilterChips,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof FilterChips>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Result count only — the strip renders no chips until a filter is active. */
export const CountOnly: Story = {
  render: () => (
    <CatalogPreviewProvider>
      <FilterChips />
    </CatalogPreviewProvider>
  ),
};

/** One removable chip per active filter, plus Clear all. */
export const ActiveFilters: Story = {
  render: () => (
    <CatalogPreviewProvider
      value={buildCatalogShellValue({
        q: "mono",
        format: "woff2",
        owner: "JetBrains",
        minStars: 500,
        webfont: true,
      })}
    >
      <FilterChips />
    </CatalogPreviewProvider>
  ),
};

/** Variable-only, the narrowest single-toggle case. */
export const VariableOnly: Story = {
  render: () => (
    <CatalogPreviewProvider value={buildCatalogShellValue({ variable: true })}>
      <FilterChips />
    </CatalogPreviewProvider>
  ),
};

/**
 * Retained rows during a replacement fetch are labelled rather than presented
 * as settled results (INV-PAGE-6).
 */
export const RetainedResults: Story = {
  render: () => (
    <CatalogPreviewProvider
      value={buildCatalogShellValue({ q: "sans", isPlaceholderData: true })}
    >
      <FilterChips />
    </CatalogPreviewProvider>
  ),
};
