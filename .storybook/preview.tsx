import type { Decorator, Preview } from "@storybook/nextjs-vite";

// globals.css styles <body> directly (background, foreground, --font-sans), so
// importing it here themes the Storybook iframe exactly like the application.
import "../src/app/globals.css";
// Binds --font-geist-sans / --font-geist-mono to the shipped Geist faces.
// Imported here (not linked in preview-head.html) so the declarations land in
// Storybook's compiled CSS, which is what design-sync scrapes into
// _ds_bundle.css. It contains no url() references, so it does not reintroduce
// the .woff2 loader problem that moved the @font-face rules out of this graph.
import "../.design-sync/tokens/font-family-vars.css";

/** Breathing room so cards are not flush against the iframe edge. */
const withSurface: Decorator = (Story) => (
  <div className="p-6">
    <Story />
  </div>
);

const preview: Preview = {
  decorators: [withSurface],
  parameters: {
    layout: "fullscreen",
    backgrounds: { disable: true },
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
  },
};

export default preview;
