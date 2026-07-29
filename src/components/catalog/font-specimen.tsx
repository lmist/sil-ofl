"use client";

import { useFontSpecimen } from "@/hooks/use-font-specimen";
import { cn } from "@/lib/utils";

/**
 * Policy-only large editable specimen. Face comes from cdnUrl @font-face
 * via the specimen machine — never a server-side download.
 */
export function FontSpecimen({ className }: { className?: string }) {
  const specimen = useFontSpecimen();

  return (
    <section
      {...specimen.rootProps}
      className={cn(
        "border-b border-border px-[var(--gutter)] py-6",
        className,
      )}
    >
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
        <p className="text-[0.8125rem] tracking-tight text-foreground">
          {specimen.displayName}
        </p>
        <p className="text-[0.75rem] tabular-nums text-muted-foreground">
          {specimen.metaLine}
        </p>
      </div>

      <textarea
        {...specimen.textAreaProps}
        className={cn(
          "w-full resize-y border-0 bg-transparent p-0 text-foreground outline-none",
          "placeholder:text-muted-foreground",
          "focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-4 focus-visible:outline-ring",
          "motion-reduce:transition-none",
        )}
        style={{
          ...specimen.textAreaProps.style,
          fontSize: "clamp(2.5rem, 8vw, 7rem)",
          lineHeight: 1.02,
          letterSpacing: "-0.02em",
          minHeight: "4.5rem",
        }}
      />

      {specimen.isLoading ? (
        <p className="mt-3 text-[0.75rem] text-muted-foreground">
          Loading specimen face…
        </p>
      ) : null}

      {specimen.isError ? (
        <p className="mt-3 text-[0.75rem] text-muted-foreground">
          Specimen error: {specimen.error}{" "}
          <button
            {...specimen.retryProps}
            type="button"
            className="underline underline-offset-4 transition-opacity duration-[var(--dur-fast)] hover:opacity-80 motion-reduce:transition-none"
          >
            Retry
          </button>
        </p>
      ) : null}
    </section>
  );
}
