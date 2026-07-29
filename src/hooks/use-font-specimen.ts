"use client";

import { useMemo } from "react";
import { useFontCatalogShellContext } from "@/hooks/use-font-catalog-shell";
import {
  resolveFontFamily,
  resolveFontStyle,
  resolveFontWeight,
} from "@/lib/font-face-descriptors";

/**
 * Headless specimen — shared editable sample string + face from specimen machine.
 * Face load uses cdnUrl via the machine (never server download).
 */
export function useFontSpecimen() {
  const shell = useFontCatalogShellContext();
  const selectedFace = shell.selectedEdge?.node ?? null;

  const faceStyle = useMemo(
    () =>
      ({
        ...shell.specimenFaceStyle,
        fontWeight: resolveFontWeight(
          selectedFace?.weightGuess ?? shell.specimen.weight,
        ),
        fontStyle: resolveFontStyle(
          selectedFace?.styleGuess ?? shell.specimen.style,
        ),
        fontSynthesis: "none",
      }) as const,
    [
      shell.specimenFaceStyle,
      shell.specimen.weight,
      shell.specimen.style,
      selectedFace?.weightGuess,
      selectedFace?.styleGuess,
    ],
  );

  const rootProps = useMemo(
    () =>
      ({
        "data-font-specimen": true,
        "aria-label": "Type specimen",
        "aria-busy": shell.specimenIsLoading,
      }) as const,
    [shell.specimenIsLoading],
  );

  const textAreaProps = useMemo(
    () =>
      ({
        value: shell.specimenText,
        onChange: shell.onSpecimenTextChange,
        spellCheck: false,
        "aria-label": "Editable specimen text",
        rows: 2,
        style: faceStyle,
      }) as const,
    [
      shell.specimenText,
      shell.onSpecimenTextChange,
      faceStyle,
    ],
  );

  const displayName =
    (shell.selectedEdge
      ? resolveFontFamily(shell.selectedEdge.node)
      : null) ??
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
    isError: shell.specimenError != null,
    error: shell.specimenError,
    retryProps: shell.retrySpecimenProps,
    hasSelection: shell.selectedFontId != null,
    faceStyle,
  } as const;
}

export type UseFontSpecimenReturn = ReturnType<typeof useFontSpecimen>;
