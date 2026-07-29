"use client";

import { useMemo } from "react";
import { useMachine } from "@xstate/react";
import { useQueryClient } from "@tanstack/react-query";
import {
  specimenMachine,
  type SpecimenInput,
} from "@/machines/specimen-machine";

export type UseSpecimenMachineOptions = {
  input?: SpecimenInput;
};

/**
 * Thin @xstate/react wrapper around specimenMachine.
 * Loads @font-face for a selected font (cdnUrl) with optional GraphQL hydrate.
 */
export function useSpecimenMachine(options: UseSpecimenMachineOptions = {}) {
  const queryClient = useQueryClient();

  const input = useMemo<SpecimenInput>(
    () => ({
      ...options.input,
      queryClient,
    }),
    // Mount-oriented input; queryClient is session-stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queryClient],
  );

  const [snapshot, send, actorRef] = useMachine(specimenMachine, { input });

  return {
    state: snapshot,
    snapshot,
    send,
    actorRef,
    context: snapshot.context,
    error: snapshot.context.error,
    family: snapshot.context.family,
    weight: snapshot.context.weight,
    style: snapshot.context.style,
    matches: snapshot.matches.bind(snapshot),
    isReady: snapshot.matches("ready"),
    isLoading:
      snapshot.matches("loadingFace") || snapshot.matches("loadingMeta"),
    isEmpty: snapshot.matches("empty"),
    isError: snapshot.matches("error"),
  } as const;
}

export type UseSpecimenMachineReturn = ReturnType<typeof useSpecimenMachine>;
