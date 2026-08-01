import type { StorybookConfig } from "@storybook/nextjs-vite";

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  addons: ["@storybook/addon-docs"],
  framework: {
    name: "@storybook/nextjs-vite",
    options: {},
  },
  // Geist is served as a static asset and linked from preview-head.html rather
  // than imported from preview.tsx: a JS import pulls .woff2 into the module
  // graph, which design-sync's decorator bundler has no loader for.
  staticDirs: ["../public", { from: "../.design-sync/fonts", to: "/ds-fonts" }],
};

export default config;
