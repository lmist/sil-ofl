import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Build output and design-sync scratch — generated, never hand-edited.
    // Authored design-sync sources (preview/, previews/, tokens/) stay linted.
    "storybook-static/**",
    ".ds-sync/**",
    "ds-bundle/**",
    ".design-sync/sb-reference/**",
    ".design-sync/dts/**",
    ".design-sync/.cache/**",
  ]),
  {
    rules: {
      // Prefer XState machines, TanStack Query, and event handlers over ad-hoc effects.
      // Escape hatch: import { useMountEffect } from "@/hooks/use-mount-effect" only.
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.name='useEffect']",
          message:
            "useEffect is banned. Prefer XState, TanStack Query, or useMountEffect for true mount-only side effects.",
        },
        {
          selector:
            "CallExpression[callee.object.name='React'][callee.property.name='useEffect']",
          message:
            "React.useEffect is banned. Prefer XState, TanStack Query, or useMountEffect for true mount-only side effects.",
        },
      ],
    },
  },
]);

export default eslintConfig;
