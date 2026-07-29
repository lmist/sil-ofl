"use client";

import { useMemo } from "react";
import { useFontCatalogShellContext } from "@/hooks/use-font-catalog-shell";

/**
 * Headless specimen — shared editable sample string + face from specimen machine.
 * Face load uses cdnUrl via the machine (never server download).
 */
export function useFontSpecimen() {
  const shell = useFontCatalogShellContext();

  const rootProps = useMemo(
    () =>
      ({
        "data-font-specimen": true,
        "aria-label": "Type specimen",
      }) as const,
    [],
  );

  const textAreaProps = useMemo(
    () =>
      ({
        value: shell.specimenText,
        onChange: shell.onSpecimenTextChange,
        spellCheck: false,
        "aria-label": "Editable specimen text",
        rows: 2,
        style: shell.specimenFaceStyle,
      }) as const,
    [
      shell.specimenText,
      shell.onSpecimenTextChange,
      shell.specimenFaceStyle,
    ],
  );

  const displayName =
    shell.selectedEdge?.node.familyGuess ??
    shell.selectedEdge?.node.fileName ??
    shell.specimenFamily ??
    "Select a face";

  const metaLine = shell.selectedEdge
    ? `${shell.selectedEdge.node.ownerLogin} · ${shell.selectedEdge.node.format} · ★${shell.selectedEdge.node.stars}`
    : shell.specimenIsLoading
      ? "Loading face…"
      : "Hover or select a row";

  return {
    rootProps,
    textAreaProps,
    text: shell.specimenText,
    displayName,
    metaLine,
    isReady: shell.specimenIsReady,
    isLoading: shell.specimenIsLoading,
    isError: shell.specimenIsError,
    error: shell.specimenError,
    retryProps: shell.retrySpecimenProps,
    hasSelection: shell.selectedFontId != null,
    faceStyle: shell.specimenFaceStyle,
  } as const;
}

export type UseFontSpecimenReturn = ReturnType<typeof useFontSpecimen>;
