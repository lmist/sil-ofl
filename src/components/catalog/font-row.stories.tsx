import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { FontRow } from "@/components/catalog/font-row";
import {
  PREVIEW_FONTS,
  buildFontRowInput,
} from "../../../.design-sync/preview/catalog-shell-provider";

const [firaCode, iosevka, inter] = PREVIEW_FONTS;
if (!firaCode || !iosevka || !inter) throw new Error("preview fonts missing");

const meta = {
  title: "Catalog/FontRow",
  component: FontRow,
  parameters: { layout: "padded" },
} satisfies Meta<typeof FontRow>;

export default meta;
type Story = StoryObj<typeof meta>;

/** One catalog row: specimen-scale family name over quiet owner/format meta. */
export const Default: Story = {
  args: buildFontRowInput(firaCode),
};

/** Selected rows carry a "Selected:" prefix and a raised background. */
export const Selected: Story = {
  args: buildFontRowInput(iosevka, { selected: true }),
};

/** Rows stack into the catalog list with a hairline rule between them. */
export const Stacked: Story = {
  args: buildFontRowInput(firaCode),
  render: () => (
    <div className="flex flex-col">
      <FontRow {...buildFontRowInput(firaCode)} />
      <FontRow {...buildFontRowInput(iosevka, { selected: true })} />
      <FontRow {...buildFontRowInput(inter)} />
    </div>
  ),
};

/** With no shared specimen string the row falls back to the family name. */
export const FamilyNameSample: Story = {
  args: buildFontRowInput(inter, { sampleText: "Inter Variable" }),
};

/**
 * Long names truncate rather than pushing the document sideways
 * (INV-FILTER-6 — arbitrary text is layout-safe).
 */
export const LongNameTruncates: Story = {
  args: buildFontRowInput(inter, {
    sampleText: "Noto Sans Syriac Eastern Extra Condensed SemiBold Italic",
  }),
};
