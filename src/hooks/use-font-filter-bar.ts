"use client";

import { useMemo } from "react";
import { useFontCatalogShellContext } from "@/hooks/use-font-catalog-shell";

const FORMAT_OPTIONS = [
  { value: "", label: "Any" },
  { value: "woff2", label: "woff2" },
  { value: "woff", label: "woff" },
  { value: "ttf", label: "ttf" },
  { value: "otf", label: "otf" },
] as const;

const SORT_OPTIONS = [
  { value: "REPUTATION_DESC", label: "Reputation ↓" },
  { value: "STARS_DESC", label: "Stars ↓" },
  { value: "FAMILY_ASC", label: "Family A–Z" },
  { value: "FAMILY_DESC", label: "Family Z–A" },
  { value: "ID_DESC", label: "Newest" },
] as const;

/**
 * Headless filter strip — controlled by catalog machine via shell context.
 */
export function useFontFilterBar() {
  const shell = useFontCatalogShellContext();

  const rootProps = useMemo(
    () =>
      ({
        role: "search" as const,
        "aria-label": "Catalog filters",
        "data-font-filter-bar": true,
      }) as const,
    [],
  );

  const webfontActive = shell.filters.webfont === true;
  const variableActive = shell.filters.variable === true;

  return {
    rootProps,
    formatSelectProps: shell.formatSelectProps,
    ownerInputProps: shell.ownerInputProps,
    sortSelectProps: shell.sortSelectProps,
    minStarsInputProps: shell.minStarsInputProps,
    webfontToggleProps: shell.webfontToggleProps,
    variableToggleProps: shell.variableToggleProps,
    denseModeToggleProps: shell.denseModeToggleProps,
    formatOptions: FORMAT_OPTIONS,
    sortOptions: SORT_OPTIONS,
    webfontLabel: webfontActive ? "Webfont ✓" : "Webfont",
    variableLabel: variableActive ? "Variable ✓" : "Variable",
    denseModeLabel: shell.denseMode ? "Dense ✓" : "Dense",
    webfontActive,
    variableActive,
    denseMode: shell.denseMode,
  } as const;
}

export type UseFontFilterBarReturn = ReturnType<typeof useFontFilterBar>;
