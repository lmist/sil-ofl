import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { FontUsePanel } from "@/components/catalog/font-use-panel";
import {
  CatalogPreviewProvider,
  buildCatalogShellValue,
} from "../../../.design-sync/preview/catalog-shell-provider";

const meta = {
  title: "Catalog/FontUsePanel",
  component: FontUsePanel,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof FontUsePanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Copyable artifacts for the selected face — @font-face CSS, HTML, React and
 * the download URL. Every generated snippet is valid for its labelled target
 * and describes the selected font (INV-ARTIFACT-1), and links resolve only to
 * approved HTTPS origins (INV-ARTIFACT-2).
 */
export const Selected: Story = {
  render: () => (
    <CatalogPreviewProvider
      value={buildCatalogShellValue({ selectedFontId: 4101 })}
    >
      <FontUsePanel />
    </CatalogPreviewProvider>
  ),
};

/** A variable face changes the emitted font-weight range. */
export const VariableFace: Story = {
  render: () => (
    <CatalogPreviewProvider
      value={buildCatalogShellValue({ selectedFontId: 4108 })}
    >
      <FontUsePanel />
    </CatalogPreviewProvider>
  ),
};
