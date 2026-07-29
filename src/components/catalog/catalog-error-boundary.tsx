"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { cn } from "@/lib/utils";

type Props = {
  children: ReactNode;
  className?: string;
  /** Optional label for aria / messaging */
  label?: string;
  /** Refresh the failed result source before the boundary renders it again. */
  onRetry?: () => unknown | Promise<unknown>;
};

type State = {
  error: Error | null;
  retrying: boolean;
};

/**
 * Lightweight error boundary for catalog list / dense table.
 * Keeps filter chrome alive when a row or virtualizer throws.
 */
export class CatalogErrorBoundary extends Component<Props, State> {
  override state: State = { error: null, retrying: false };

  static getDerivedStateFromError(error: Error): State {
    return { error, retrying: false };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    if (process.env.NODE_ENV !== "production") {
      console.error("[CatalogErrorBoundary]", error, info.componentStack);
    }
  }

  private onRetry = async () => {
    if (this.state.retrying) return;

    this.setState({ retrying: true });
    try {
      await this.props.onRetry?.();
      this.setState({ error: null, retrying: false });
    } catch {
      this.setState({ retrying: false });
    }
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
        <button
          type="button"
          onClick={this.onRetry}
          disabled={this.state.retrying}
          aria-busy={this.state.retrying}
          className="mt-3 underline underline-offset-4 transition-colors duration-[var(--dur-fast)] hover:text-foreground motion-reduce:transition-none"
        >
          Try again
        </button>
      </div>
    );
  }
}
