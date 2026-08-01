import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { FontSpecimen } from "@/components/catalog/font-specimen";
import {
  CatalogPreviewProvider,
  buildCatalogShellValue,
} from "../../../.design-sync/preview/catalog-shell-provider";

const meta = {
  title: "Catalog/FontSpecimen",
  component: FontSpecimen,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof FontSpecimen>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Fira Code selected. The specimen applies the selected face's resolved family,
 * weight and style, and its metadata agrees with them (INV-IDENTITY-4).
 */
export const Selected: Story = {
  render: () => (
    <CatalogPreviewProvider
      value={buildCatalogShellValue({ selectedFontId: 4101 })}
    >
      <FontSpecimen />
    </CatalogPreviewProvider>
  ),
};

/** A variable face — Inter Variable carries no single static weight. */
export const VariableFace: Story = {
  render: () => (
    <CatalogPreviewProvider
      value={buildCatalogShellValue({ selectedFontId: 4103 })}
    >
      <FontSpecimen />
    </CatalogPreviewProvider>
  ),
};

/** An italic face — Source Code Pro Italic, style resolved from the record. */
export const ItalicFace: Story = {
  render: () => (
    <CatalogPreviewProvider
      value={buildCatalogShellValue({ selectedFontId: 4105 })}
    >
      <FontSpecimen />
    </CatalogPreviewProvider>
  ),
};
