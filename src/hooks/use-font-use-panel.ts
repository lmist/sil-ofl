"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useFontCatalogShellContext } from "@/hooks/use-font-catalog-shell";
import { buildFontUseSnippets } from "@/lib/font-use-snippets";

export type UseSnippetKind = "css" | "html" | "react" | "cdn" | "raw";

type CopyFeedback = {
  fontId: number;
  kind: UseSnippetKind;
  status: "copied" | "failed";
};

const COPY_LABELS: Record<UseSnippetKind, string> = {
  css: "CSS",
  html: "HTML example",
  react: "React example",
  cdn: "CDN URL",
  raw: "Raw URL",
};

/**
 * Headless "use this font" panel — one-click copy snippets + download/repo links.
 * Copy feedback is event-driven (no useEffect).
 */
export function useFontUsePanel() {
  const shell = useFontCatalogShellContext();
  const font = shell.selectedEdge?.node ?? null;
  const fontId = font?.fontFileId ?? null;
  const [feedback, setFeedback] = useState<CopyFeedback | null>(null);
  const copyToken = useRef(0);

  const snippets = useMemo(
    () => (font ? buildFontUseSnippets(font) : null),
    [font],
  );

  const copyText = useCallback(
    async (
      kind: UseSnippetKind,
      text: string,
      selectedFontId: number,
      initiatingControl: HTMLButtonElement,
    ) => {
      const token = ++copyToken.current;
      setFeedback(null);
      let confirmed = false;

      try {
        if (!navigator.clipboard?.writeText) {
          throw new Error("Clipboard API unavailable");
        }
        await navigator.clipboard.writeText(text);
        confirmed = true;
      } catch {
        // Fallback for restricted clipboard environments.
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        try {
          confirmed = document.execCommand("copy") === true;
        } catch {
          confirmed = false;
        } finally {
          document.body.removeChild(ta);
          if (initiatingControl.isConnected) {
            initiatingControl.focus({ preventScroll: true });
          }
        }
      }

      if (copyToken.current !== token) return;

      if (!confirmed) {
        setFeedback({
          fontId: selectedFontId,
          kind,
          status: "failed",
        });
        return;
      }

      setFeedback({
        fontId: selectedFontId,
        kind,
        status: "copied",
      });
      window.setTimeout(() => {
        if (copyToken.current === token) setFeedback(null);
      }, 1600);
    },
    [],
  );

  const activeFeedback = feedback?.fontId === fontId ? feedback : null;
  const copied =
    activeFeedback?.status === "copied" ? activeFeedback.kind : null;
  const copyError =
    activeFeedback?.status === "failed" ? activeFeedback.kind : null;
  const copyMessage = copied
    ? `${COPY_LABELS[copied]} copied.`
    : copyError
      ? "Copy failed. Try again."
      : null;

  const copyCssProps = useMemo(
    () =>
      ({
        type: "button" as const,
        disabled: !snippets?.css,
        onClick: (event: ReactMouseEvent<HTMLButtonElement>) => {
          if (snippets?.css && fontId != null) {
            void copyText("css", snippets.css, fontId, event.currentTarget);
          }
        },
        "aria-label": "Copy CSS @font-face",
      }) as const,
    [snippets, fontId, copyText],
  );

  const copyHtmlProps = useMemo(
    () =>
      ({
        type: "button" as const,
        disabled: !snippets?.html,
        onClick: (event: ReactMouseEvent<HTMLButtonElement>) => {
          if (snippets?.html && fontId != null) {
            void copyText("html", snippets.html, fontId, event.currentTarget);
          }
        },
        "aria-label": "Copy HTML starter page",
      }) as const,
    [snippets, fontId, copyText],
  );

  const copyReactProps = useMemo(
    () =>
      ({
        type: "button" as const,
        disabled: !snippets?.react,
        onClick: (event: ReactMouseEvent<HTMLButtonElement>) => {
          if (snippets?.react && fontId != null) {
            void copyText("react", snippets.react, fontId, event.currentTarget);
          }
        },
        "aria-label": "Copy React / CSS usage",
      }) as const,
    [snippets, fontId, copyText],
  );

  const copyCdnProps = useMemo(
    () =>
      ({
        type: "button" as const,
        disabled: !snippets?.cdnUrl,
        onClick: (event: ReactMouseEvent<HTMLButtonElement>) => {
          if (snippets?.cdnUrl && fontId != null) {
            void copyText("cdn", snippets.cdnUrl, fontId, event.currentTarget);
          }
        },
        "aria-label": "Copy CDN URL",
      }) as const,
    [snippets, fontId, copyText],
  );

  const copyRawProps = useMemo(
    () =>
      ({
        type: "button" as const,
        disabled: !snippets?.rawUrl,
        onClick: (event: ReactMouseEvent<HTMLButtonElement>) => {
          if (snippets?.rawUrl && fontId != null) {
            void copyText("raw", snippets.rawUrl, fontId, event.currentTarget);
          }
        },
        "aria-label": "Copy raw GitHub URL",
      }) as const,
    [snippets, fontId, copyText],
  );

  const downloadProps = useMemo(
    () =>
      snippets?.downloadUrl
        ? ({
            href: snippets.downloadUrl,
            download: font?.fileName ?? true,
            target: "_blank" as const,
            rel: "noopener noreferrer",
            "aria-label": `Download ${snippets.family}`,
          } as const)
        : null,
    [snippets, font?.fileName],
  );

  const repoProps = useMemo(
    () =>
      snippets?.repoUrl
        ? ({
            href: snippets.repoUrl,
            target: "_blank" as const,
            rel: "noopener noreferrer",
            "aria-label": `Open ${font?.fullName ?? "repository"} on GitHub`,
          } as const)
        : null,
    [snippets, font?.fullName],
  );

  const rootProps = useMemo(
    () =>
      ({
        "data-font-use-panel": true,
        "aria-label": snippets
          ? `Use ${snippets.family}`
          : "Use this font",
        hidden: !snippets,
      }) as const,
    [snippets],
  );

  const previewCode = snippets?.css ?? "";

  return {
    hasSelection: font != null,
    font,
    snippets,
    copied,
    copyError,
    copyMessage,
    rootProps,
    copyCssProps,
    copyHtmlProps,
    copyReactProps,
    copyCdnProps,
    copyRawProps,
    downloadProps,
    repoProps,
    previewCode,
    labelCopied: (kind: UseSnippetKind) =>
      copied === kind ? "Copied" : null,
  } as const;
}

export type UseFontUsePanelReturn = ReturnType<typeof useFontUsePanel>;
