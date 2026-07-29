"use client";

import { useMemo, type CSSProperties, type KeyboardEventHandler, type MouseEventHandler } from "react";
import type { FontFile } from "@/types/catalog";

export type FontRowInput = {
  rootProps: {
    type: "button";
    onClick: MouseEventHandler<HTMLButtonElement>;
    onMouseEnter: () => void;
    onFocus: () => void;
    onKeyDown: KeyboardEventHandler<HTMLButtonElement>;
    "aria-pressed": boolean;
    "aria-label": string;
    "data-selected": string;
    "data-face-ready": string;
  };
  sampleProps: {
    style?: CSSProperties;
    "aria-hidden": true;
  };
  sampleText: string;
  name: string;
  meta: string;
  selected: boolean;
  faceActive: boolean;
  node: FontFile;
};

/**
 * Thin headless adapter for a single catalog row.
 * Accepts prop bundles from useFontList (or any parent) — no local state.
 */
export function useFontRow(input: FontRowInput) {
  const rootProps = useMemo(
    () => ({
      ...input.rootProps,
      "data-font-row": true,
    }),
    [input.rootProps],
  );

  const sampleProps = useMemo(
    () => ({
      ...input.sampleProps,
      "data-font-row-sample": true,
    }),
    [input.sampleProps],
  );

  const nameProps = useMemo(
    () =>
      ({
        "data-font-row-name": true,
      }) as const,
    [],
  );

  const metaProps = useMemo(
    () =>
      ({
        "data-font-row-meta": true,
      }) as const,
    [],
  );

  return {
    rootProps,
    sampleProps,
    nameProps,
    metaProps,
    sampleText: input.sampleText,
    name: input.name,
    meta: input.meta,
    selected: input.selected,
    faceActive: input.faceActive,
  } as const;
}

export type UseFontRowReturn = ReturnType<typeof useFontRow>;
