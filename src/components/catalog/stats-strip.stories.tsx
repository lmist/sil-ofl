import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { StatsStrip } from "@/components/catalog/stats-strip";
import {
  CatalogPreviewProvider,
  buildCatalogShellValue,
} from "../../../.design-sync/preview/catalog-shell-provider";

const meta = {
  title: "Catalog/StatsStrip",
  component: StatsStrip,
  parameters: { layout: "padded" },
} satisfies Meta<typeof StatsStrip>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Catalog totals in tabular figures — repos, files, owners. */
export const Default: Story = {
  render: () => (
    <CatalogPreviewProvider>
      <StatsStrip />
    </CatalogPreviewProvider>
  ),
};

/**
 * Statistics can fail without taking the catalog down: the strip swaps to safe
 * copy plus its own Retry, which refetches statistics only (INV-ERROR-2).
 */
export const StatisticsUnavailable: Story = {
  render: () => (
    <CatalogPreviewProvider value={buildCatalogShellValue({ statsError: true })}>
      <StatsStrip />
    </CatalogPreviewProvider>
  ),
};
