import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { CatalogSkeleton } from "@/components/catalog/catalog-skeleton";

const meta = {
  title: "Catalog/CatalogSkeleton",
  component: CatalogSkeleton,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof CatalogSkeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Streaming placeholder for the catalog route. Server Component, no client JS —
 * it mirrors the real header, filter, chip and row geometry so the page does not
 * shift when data arrives.
 */
export const Default: Story = {};
