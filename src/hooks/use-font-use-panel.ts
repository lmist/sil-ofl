"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useFontCatalogShellContext } from "@/hooks/use-font-catalog-shell";
import { buildFontUseSnippets } from "@/lib/font-use-snippets";

export type UseSnippetKind = "css" | "html" | "react" | "cdn" | "raw";

/**
 * Headless "use this font" panel — one-click copy snippets + download/repo links.
 * Copy feedback is event-driven (no useEffect).
 */
export function useFontUsePanel() {
  const shell = useFontCatalogShellContext();
  const font = shell.selectedEdge?.node ?? null;
  const [copied, setCopied] = useState<UseSnippetKind | null>(null);
  const copyToken = useRef(0);

  const snippets = useMemo(
    () => (font ? buildFontUseSnippets(font) : null),
    [font],
  );

  const copyText = useCallback(async (kind: UseSnippetKind, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      const token = ++copyToken.current;
      setCopied(kind);
      window.setTimeout(() => {
        if (copyToken.current === token) setCopied(null);
      }, 1600);
    } catch {
      // Fallback for restricted clipboard
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        const token = ++copyToken.current;
        setCopied(kind);
        window.setTimeout(() => {
          if (copyToken.current === token) setCopied(null);
        }, 1600);
      } finally {
        document.body.removeChild(ta);
      }
    }
  }, []);

  const copyCssProps = useMemo(
    () =>
      ({
        type: "button" as const,
        disabled: !snippets,
        onClick: () => {
          if (snippets) void copyText("css", snippets.css);
        },
        "aria-label": "Copy CSS @font-face",
      }) as const,
    [snippets, copyText],
  );

  const copyHtmlProps = useMemo(
    () =>
      ({
        type: "button" as const,
        disabled: !snippets,
        onClick: () => {
          if (snippets) void copyText("html", snippets.html);
        },
        "aria-label": "Copy HTML starter page",
      }) as const,
    [snippets, copyText],
  );

  const copyReactProps = useMemo(
    () =>
      ({
        type: "button" as const,
        disabled: !snippets,
        onClick: () => {
          if (snippets) void copyText("react", snippets.react);
        },
        "aria-label": "Copy React / CSS usage",
      }) as const,
    [snippets, copyText],
  );

  const copyCdnProps = useMemo(
    () =>
      ({
        type: "button" as const,
        disabled: !snippets,
        onClick: () => {
          if (snippets) void copyText("cdn", snippets.cdnUrl);
        },
        "aria-label": "Copy CDN URL",
      }) as const,
    [snippets, copyText],
  );

  const copyRawProps = useMemo(
    () =>
      ({
        type: "button" as const,
        disabled: !snippets,
        onClick: () => {
          if (snippets) void copyText("raw", snippets.rawUrl);
        },
        "aria-label": "Copy raw GitHub URL",
      }) as const,
    [snippets, copyText],
  );

  const downloadProps = useMemo(
    () =>
      snippets
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
      snippets
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
