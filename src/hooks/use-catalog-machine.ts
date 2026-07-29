"use client";

import { startTransition, useCallback, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useMachine } from "@xstate/react";
import { useQueryClient } from "@tanstack/react-query";
import {
  catalogMachine,
  type CatalogEvent,
  type CatalogInput,
} from "@/machines/catalog-machine";
import {
  parseCatalogSearchParams,
  serializeCatalogContext,
} from "@/machines/catalog-url";

export type UseCatalogMachineOptions = {
  /** Override initial context (merged after URL parse). */
  input?: CatalogInput;
  /**
   * When true (default), push serialised catalog context to the URL on
   * every send via startTransition + router.replace — not useEffect.
   */
  syncUrl?: boolean;
  /** When true (default), hydrate from current searchParams once as input. */
  hydrateFromUrl?: boolean;
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
  } = options;

  const queryClient = useQueryClient();
  const router = useRouter();
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

  const send = useCallback(
    (event: CatalogEvent) => {
      sendRaw(event);
      if (!syncUrl) return;

      const next = actorRef.getSnapshot();
      const qs = serializeCatalogContext(next.context);
      const href = qs ? `${pathname}?${qs}` : pathname;

      // Event-handler path only — not useEffect.
      startTransition(() => {
        router.replace(href, { scroll: false });
      });
    },
    [sendRaw, actorRef, syncUrl, pathname, router],
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
