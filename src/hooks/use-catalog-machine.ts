"use client";

import { useCallback, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useMachine } from "@xstate/react";
import { useQueryClient } from "@tanstack/react-query";
import { useMountEffect } from "@/hooks/use-mount-effect";
import {
  catalogMachine,
  type CatalogEvent,
  type CatalogInput,
} from "@/machines/catalog-machine";
import {
  parseCatalogSearchParams,
  serializeCatalogContext,
  type CatalogUrlSlice,
} from "@/machines/catalog-url";

export type UseCatalogMachineOptions = {
  /** Override initial context (merged after URL parse). */
  input?: CatalogInput;
  /**
   * When true (default), replace serialised catalog context in the URL on
   * every send.
   */
  syncUrl?: boolean;
  /** Hydrate from the initial URL and same-route browser history navigation. */
  hydrateFromUrl?: boolean;
  /** Coordinate other catalog surfaces after browser history navigation. */
  onUrlHydrate?: (slice: CatalogUrlSlice) => void;
};

function buildCatalogInput(args: {
  searchParams: { get(name: string): string | null };
  hydrateFromUrl: boolean;
  inputOverride?: CatalogInput;
  queryClient: CatalogInput["queryClient"];
}): CatalogInput {
  const base: CatalogInput = { queryClient: args.queryClient };

  if (args.hydrateFromUrl) {
    const slice = parseCatalogSearchParams(args.searchParams);
    if (slice.q !== undefined) base.q = slice.q;
    if (slice.filters) {
      base.filters = {
        format: slice.filters.format,
        owner: slice.filters.owner,
        minStars: 0,
        webfont: null,
        variable: null,
      };
    }
    if (slice.sort !== undefined) base.sort = slice.sort;
    if (slice.after !== undefined) base.after = slice.after;
    if (slice.selectedFontId !== undefined) {
      base.selectedFontId = slice.selectedFontId;
    }
  }

  return { ...base, ...args.inputOverride, queryClient: args.queryClient };
}

/**
 * Thin @xstate/react wrapper around catalogMachine.
 * Debounce is owned by the machine (delayed transition); URL writes happen
 * in the event-handler path only.
 */
export function useCatalogMachine(options: UseCatalogMachineOptions = {}) {
  const {
    input: inputOverride,
    syncUrl = true,
    hydrateFromUrl = true,
    onUrlHydrate,
  } = options;

  const queryClient = useQueryClient();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Lazy useState captures URL + queryClient once for machine input
  // (avoids refs-during-render and re-creating the actor).
  const [input] = useState<CatalogInput>(() =>
    buildCatalogInput({
      searchParams,
      hydrateFromUrl,
      inputOverride,
      queryClient,
    }),
  );

  const [snapshot, sendRaw, actorRef] = useMachine(catalogMachine, { input });

  useMountEffect(() => {
    if (!hydrateFromUrl) return;

    const hydrateFromLocation = () => {
      if (window.location.pathname !== pathname) return;

      const slice = parseCatalogSearchParams(
        new URLSearchParams(window.location.search),
      );
      sendRaw({ type: "HYDRATE_FROM_URL", slice });
      onUrlHydrate?.(slice);
    };

    window.addEventListener("popstate", hydrateFromLocation);
    return () => {
      window.removeEventListener("popstate", hydrateFromLocation);
    };
  });

  const send = useCallback(
    (event: CatalogEvent) => {
      sendRaw(event);
      if (!syncUrl) return;

      const next = actorRef.getSnapshot();
      const qs = serializeCatalogContext(next.context);
      const href = qs ? `${pathname}?${qs}` : pathname;

      window.history.replaceState(null, "", href);
    },
    [sendRaw, actorRef, syncUrl, pathname],
  );

  return {
    state: snapshot,
    snapshot,
    send,
    actorRef,
    /** Convenience: fonts connection from invoke output. */
    connection: snapshot.context.connection,
    error: snapshot.context.error,
    context: snapshot.context,
    matches: snapshot.matches.bind(snapshot),
  } as const;
}

export type UseCatalogMachineReturn = ReturnType<typeof useCatalogMachine>;
