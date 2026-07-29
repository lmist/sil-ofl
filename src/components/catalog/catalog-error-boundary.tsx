"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { cn } from "@/lib/utils";

type Props = {
  children: ReactNode;
  className?: string;
  /** Optional label for aria / messaging */
  label?: string;
};

type State = {
  error: Error | null;
};

/**
 * Lightweight error boundary for catalog list / dense table.
 * Keeps filter chrome alive when a row or virtualizer throws.
 */
export class CatalogErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    if (process.env.NODE_ENV !== "production") {
      console.error("[CatalogErrorBoundary]", error, info.componentStack);
    }
  }

  private onRetry = () => {
    this.setState({ error: null });
  };

  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const label = this.props.label ?? "catalog";

    return (
      <div
        role="alert"
        data-catalog-error-boundary
        className={cn(
          "border-b border-border px-[var(--gutter)] py-6 text-[0.8125rem] text-muted-foreground",
          this.props.className,
        )}
      >
        <p className="text-foreground">
          Something went wrong rendering the {label}.
        </p>
        <p className="mt-1 max-w-xl break-words">{error.message}</p>
        <button
          type="button"
          onClick={this.onRetry}
          className="mt-3 underline underline-offset-4 transition-opacity duration-[var(--dur-fast)] hover:opacity-80 motion-reduce:transition-none"
        >
          Try again
        </button>
      </div>
    );
  }
}
