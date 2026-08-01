import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { CatalogErrorBoundary } from "@/components/catalog/catalog-error-boundary";

/** Throws on first render so the boundary shows its caught state. */
function BrokenResults(): never {
  throw new Error("Catalog results failed to render");
}

const meta = {
  title: "Catalog/CatalogErrorBoundary",
  component: CatalogErrorBoundary,
  parameters: { layout: "padded" },
} satisfies Meta<typeof CatalogErrorBoundary>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Healthy path — the boundary is invisible and renders its children. */
export const Healthy: Story = {
  args: {
    children: (
      <p className="text-[0.875rem] text-muted-foreground">
        10 fonts rendered without incident.
      </p>
    ),
  },
};

/**
 * Caught state. The visible copy stays safe — no stack traces, GraphQL
 * documents or internal details reach the browser (INV-ERROR-1) — and a Retry
 * action is always offered (INV-ERROR-2).
 */
export const Caught: Story = {
  args: {
    label: "Font results",
    children: <BrokenResults />,
  },
};
