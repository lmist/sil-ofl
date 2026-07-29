"use client";

import type { ButtonHTMLAttributes } from "react";
import { useFontUsePanel } from "@/hooks/use-font-use-panel";
import { cn } from "@/lib/utils";

/**
 * Policy-only "use this font" strip — one click to take a face into your project.
 * Klim-quiet chrome: text actions, hairline, no card chrome.
 */
export function FontUsePanel({ className }: { className?: string }) {
  const panel = useFontUsePanel();

  if (!panel.hasSelection || !panel.snippets) {
    return null;
  }

  const s = panel.snippets;

  return (
    <section
      {...panel.rootProps}
      className={cn(
        "min-w-0 border-b border-border px-[var(--gutter)] py-5",
        className,
      )}
    >
      <div className="mb-3 flex min-w-0 flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <div className="min-w-0 max-w-full">
          <p className="text-[0.75rem] text-muted-foreground">Use this font</p>
          <p className="min-w-0 max-w-full break-words text-[0.9375rem] tracking-tight text-foreground">
            {s.family}
            <span className="ml-2 text-[0.75rem] tabular-nums text-muted-foreground">
              {s.weight} · {s.style}
            </span>
          </p>
        </div>
        <p className="min-w-0 max-w-md break-words text-[0.75rem] leading-relaxed text-muted-foreground">
          Copy CSS into your project, or grab the CDN URL. Faces stay on
          jsDelivr / GitHub — nothing is re-hosted here.
        </p>
      </div>

      {s.policyError ? (
        <p
          data-external-url-error
          role="alert"
          className="mb-3 min-w-0 max-w-full break-words text-[0.75rem] text-muted-foreground"
        >
          {s.policyError} Choose another font.
        </p>
      ) : null}

      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-[0.8125rem]">
        <ActionButton
          {...panel.copyCssProps}
          label="Copy CSS"
          copied={panel.copied === "css"}
          failed={panel.copyError === "css"}
        />
        <ActionButton
          {...panel.copyHtmlProps}
          label="Copy HTML page"
          copied={panel.copied === "html"}
          failed={panel.copyError === "html"}
        />
        <ActionButton
          {...panel.copyReactProps}
          label="Copy for React"
          copied={panel.copied === "react"}
          failed={panel.copyError === "react"}
        />
        <ActionButton
          {...panel.copyCdnProps}
          label="Copy CDN URL"
          copied={panel.copied === "cdn"}
          failed={panel.copyError === "cdn"}
        />
        <ActionButton
          {...panel.copyRawProps}
          label="Copy raw URL"
          copied={panel.copied === "raw"}
          failed={panel.copyError === "raw"}
        />

        {panel.downloadProps ? (
          <a
            {...panel.downloadProps}
            className="inline-flex min-h-6 min-w-6 items-center text-foreground underline-offset-4 transition-opacity duration-[var(--dur-fast)] hover:underline hover:opacity-80 motion-reduce:transition-none"
          >
            Download file <span aria-hidden="true">→</span>
          </a>
        ) : null}

        {panel.repoProps ? (
          <a
            {...panel.repoProps}
            className="inline-flex min-h-6 min-w-6 items-center text-muted-foreground underline-offset-4 transition-opacity duration-[var(--dur-fast)] hover:text-foreground hover:underline motion-reduce:transition-none"
          >
            GitHub →
          </a>
        ) : null}
      </div>

      {panel.copyMessage ? (
        <p
          data-copy-feedback
          role={panel.copyError ? "alert" : "status"}
          aria-live={panel.copyError ? "assertive" : "polite"}
          aria-atomic="true"
          className="mb-3 min-w-0 max-w-full break-words text-[0.75rem] text-foreground"
        >
          {panel.copyMessage}
        </p>
      ) : null}

      <pre
        className={cn(
          "max-h-48 max-w-full overflow-auto border border-border bg-transparent p-3",
          "font-mono text-[0.6875rem] leading-relaxed text-muted-foreground",
          "selection:bg-foreground selection:text-background",
        )}
        tabIndex={0}
        role="region"
        aria-label="CSS snippet preview"
      >
        <code>{panel.previewCode}</code>
      </pre>
    </section>
  );
}

function ActionButton({
  label,
  copied,
  failed,
  className,
  "aria-label": actionContext,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  copied: boolean;
  failed: boolean;
}) {
  const visibleLabel = copied
    ? "Copied"
    : failed
      ? `Retry ${label}`
      : label;
  const accessibleLabel =
    actionContext && !actionContext.includes(visibleLabel)
      ? `${visibleLabel} — ${actionContext}`
      : actionContext ?? visibleLabel;

  return (
    <button
      {...props}
      aria-label={accessibleLabel}
      className={cn(
        "inline-flex min-h-6 min-w-6 items-center text-left text-foreground underline-offset-4",
        "transition-colors duration-[var(--dur-fast)]",
        "hover:underline",
        "focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-4 focus-visible:outline-ring",
        "disabled:pointer-events-none disabled:opacity-40",
        "motion-reduce:transition-none",
        copied && "font-medium text-foreground",
        className,
      )}
    >
      {copied ? (
        <>
          Copied <span aria-hidden="true">✓</span>
        </>
      ) : (
        visibleLabel
      )}
    </button>
  );
}
