import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Button } from "@/components/ui/button";

const meta = {
  title: "UI/Button",
  component: Button,
  parameters: { layout: "padded" },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The scarce-accent primary action. */
export const Default: Story = {
  args: { children: "Browse catalog" },
};

/** Every variant in the Klim-inspired set: solid accent, hairline, quiet. */
export const Variants: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-4">
      <Button variant="default">Browse catalog</Button>
      <Button variant="outline">Clear filters</Button>
      <Button variant="ghost">Reset</Button>
      <Button variant="link">View on GitHub</Button>
    </div>
  ),
};

/** Sizes share a 0px radius; `icon` is the square 9x9 target. */
export const Sizes: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-4">
      <Button size="sm">Small</Button>
      <Button size="default">Default</Button>
      <Button size="lg">Large</Button>
      <Button size="icon" aria-label="Next page">
        →
      </Button>
    </div>
  ),
};

/** Disabled drops to 50% opacity and stops pointer events. */
export const Disabled: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-4">
      <Button disabled>Next page</Button>
      <Button variant="outline" disabled>
        Previous page
      </Button>
    </div>
  ),
};
