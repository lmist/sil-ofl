import { assign, setup } from "xstate";
import type { QueryClient } from "@tanstack/react-query";
import type { FontNode } from "@/graphql/documents";
import {
  resolveFontStyle,
  resolveFontWeight,
  type ResolvedFontStyle,
} from "@/lib/font-face-descriptors";
import {
  fetchFontLogic,
  type FetchFontInput,
} from "./actors/fetch-fonts";
import {
  loadFontFaceLogic,
  type LoadFontFaceInput,
  type LoadFontFaceOutput,
} from "./actors/load-font-face";

export type SpecimenContext = {
  fontId: number | null;
  cdnUrl: string | null;
  rawUrl: string | null;
  format: string | null;
  /** Registered CSS font-family name */
  family: string | null;
  fileName: string | null;
  weight: number;
  style: ResolvedFontStyle;
  error: string | null;
  sourceUrl: string | null;
  /** Optional detail node from GraphQL when only id was known */
  font: FontNode | null;
  queryClient: QueryClient | null;
};

export type SpecimenEvent =
  | {
      type: "LOAD";
      fontId: number;
      cdnUrl: string;
      rawUrl?: string | null;
      format?: string | null;
      family?: string | null;
      fileName?: string | null;
      weight?: number | null;
      style?: string | null;
    }
  | { type: "LOAD_BY_ID"; fontId: number }
  | { type: "CLEAR" }
  | { type: "RETRY" };

export type SpecimenInput = Partial<
  Pick<SpecimenContext, "queryClient"> & {
    fontId: number | null;
    cdnUrl: string | null;
    rawUrl: string | null;
    format: string | null;
    family: string | null;
    fileName: string | null;
    weight: number | null;
    style: string | null;
  }
>;

export const defaultSpecimenContext: SpecimenContext = {
  fontId: null,
  cdnUrl: null,
  rawUrl: null,
  format: null,
  family: null,
  fileName: null,
  weight: 400,
  style: "normal",
  error: null,
  sourceUrl: null,
  font: null,
  queryClient: null,
};

function familyFromMeta(input: {
  family?: string | null;
  fileName?: string | null;
  fontId: number;
}): string {
  if (input.family && input.family.trim()) return input.family.trim();
  if (input.fileName) {
    const base = input.fileName.replace(/\.[^.]+$/, "");
    if (base) return base;
  }
  return `ofl-specimen-${input.fontId}`;
}

export const specimenMachine = setup({
  types: {
    context: {} as SpecimenContext,
    events: {} as SpecimenEvent,
    input: {} as SpecimenInput,
  },
  actors: {
    loadFontFace: loadFontFaceLogic,
    fetchFont: fetchFontLogic,
  },
  guards: {
    hasFacePayload: ({ context }) =>
      Boolean(context.cdnUrl && context.family),
  },
}).createMachine({
  id: "specimen",
  initial: "empty",
  context: ({ input }) => ({
    ...defaultSpecimenContext,
    ...input,
    weight: resolveFontWeight(input.weight),
    style: resolveFontStyle(input.style),
    error: null,
    sourceUrl: null,
    font: null,
  }),
  states: {
    empty: {
      on: {
        LOAD: {
          target: "loadingFace",
          actions: assign(({ event }) => ({
            fontId: event.fontId,
            cdnUrl: event.cdnUrl,
            rawUrl: event.rawUrl ?? null,
            format: event.format ?? null,
            fileName: event.fileName ?? null,
            weight: resolveFontWeight(event.weight),
            style: resolveFontStyle(event.style),
            family: familyFromMeta({
              family: event.family,
              fileName: event.fileName,
              fontId: event.fontId,
            }),
            error: null,
            sourceUrl: null,
            font: null,
          })),
        },
        LOAD_BY_ID: {
          target: "loadingMeta",
          actions: assign(({ event }) => ({
            fontId: event.fontId,
            cdnUrl: null,
            rawUrl: null,
            format: null,
            family: null,
            fileName: null,
            weight: defaultSpecimenContext.weight,
            style: defaultSpecimenContext.style,
            error: null,
            sourceUrl: null,
            font: null,
          })),
        },
        CLEAR: {},
      },
    },

    /** Resolve font row via TanStack Query / GraphQL when only id is known. */
    loadingMeta: {
      invoke: {
        id: "fetchFont",
        src: "fetchFont",
        input: ({ context }): FetchFontInput => ({
          id: context.fontId!,
          queryClient: context.queryClient,
        }),
        onDone: [
          {
            guard: ({ event }) => Boolean(event.output?.cdnUrl),
            target: "loadingFace",
            actions: assign(({ event }) => {
              const font = event.output!;
              return {
                font,
                cdnUrl: font.cdnUrl,
                rawUrl: font.rawUrl,
                format: font.format,
                fileName: font.fileName,
                weight: resolveFontWeight(font.weightGuess),
                style: resolveFontStyle(font.styleGuess),
                family: familyFromMeta({
                  family: font.familyGuess,
                  fileName: font.fileName,
                  fontId: font.fontFileId,
                }),
                error: null,
              };
            }),
          },
          {
            target: "error",
            actions: assign({
              error: "Font not found",
            }),
          },
        ],
        onError: {
          target: "error",
          actions: assign({
            error: ({ event }) =>
              event.error instanceof Error
                ? event.error.message
                : "Failed to fetch font",
          }),
        },
      },
      on: {
        LOAD: {
          target: "loadingFace",
          actions: assign(({ event }) => ({
            fontId: event.fontId,
            cdnUrl: event.cdnUrl,
            rawUrl: event.rawUrl ?? null,
            format: event.format ?? null,
            fileName: event.fileName ?? null,
            weight: resolveFontWeight(event.weight),
            style: resolveFontStyle(event.style),
            family: familyFromMeta({
              family: event.family,
              fileName: event.fileName,
              fontId: event.fontId,
            }),
            error: null,
            sourceUrl: null,
            font: null,
          })),
        },
        LOAD_BY_ID: {
          target: "loadingMeta",
          reenter: true,
          actions: assign(({ event }) => ({
            fontId: event.fontId,
            cdnUrl: null,
            rawUrl: null,
            format: null,
            family: null,
            fileName: null,
            weight: defaultSpecimenContext.weight,
            style: defaultSpecimenContext.style,
            error: null,
            sourceUrl: null,
            font: null,
          })),
        },
        CLEAR: {
          target: "empty",
          actions: assign(({ context }) => ({
            ...defaultSpecimenContext,
            queryClient: context.queryClient,
          })),
        },
      },
    },

    loadingFace: {
      invoke: {
        id: "loadFontFace",
        src: "loadFontFace",
        input: ({ context }): LoadFontFaceInput => ({
          family: context.family!,
          cdnUrl: context.cdnUrl!,
          rawUrl: context.rawUrl,
          format: context.format,
          weight: context.weight,
          style: context.style,
        }),
        onDone: {
          target: "ready",
          actions: assign(({ event }) => ({
            sourceUrl: (event.output as LoadFontFaceOutput).sourceUrl,
            error: null,
          })),
        },
        onError: {
          target: "error",
          actions: assign({
            error: ({ event }) =>
              event.error instanceof Error
                ? event.error.message
                : "Failed to load font face",
            sourceUrl: null,
          }),
        },
      },
      on: {
        LOAD: {
          target: "loadingFace",
          reenter: true,
          actions: assign(({ event }) => ({
            fontId: event.fontId,
            cdnUrl: event.cdnUrl,
            rawUrl: event.rawUrl ?? null,
            format: event.format ?? null,
            fileName: event.fileName ?? null,
            weight: resolveFontWeight(event.weight),
            style: resolveFontStyle(event.style),
            family: familyFromMeta({
              family: event.family,
              fileName: event.fileName,
              fontId: event.fontId,
            }),
            error: null,
            sourceUrl: null,
            font: null,
          })),
        },
        LOAD_BY_ID: {
          target: "loadingMeta",
          actions: assign(({ event }) => ({
            fontId: event.fontId,
            cdnUrl: null,
            rawUrl: null,
            format: null,
            family: null,
            fileName: null,
            weight: defaultSpecimenContext.weight,
            style: defaultSpecimenContext.style,
            error: null,
            sourceUrl: null,
            font: null,
          })),
        },
        CLEAR: {
          target: "empty",
          actions: assign(({ context }) => ({
            ...defaultSpecimenContext,
            queryClient: context.queryClient,
          })),
        },
      },
    },

    ready: {
      on: {
        LOAD: {
          target: "loadingFace",
          actions: assign(({ event }) => ({
            fontId: event.fontId,
            cdnUrl: event.cdnUrl,
            rawUrl: event.rawUrl ?? null,
            format: event.format ?? null,
            fileName: event.fileName ?? null,
            weight: resolveFontWeight(event.weight),
            style: resolveFontStyle(event.style),
            family: familyFromMeta({
              family: event.family,
              fileName: event.fileName,
              fontId: event.fontId,
            }),
            error: null,
            sourceUrl: null,
            font: null,
          })),
        },
        LOAD_BY_ID: {
          target: "loadingMeta",
          actions: assign(({ event }) => ({
            fontId: event.fontId,
            cdnUrl: null,
            rawUrl: null,
            format: null,
            family: null,
            fileName: null,
            weight: defaultSpecimenContext.weight,
            style: defaultSpecimenContext.style,
            error: null,
            sourceUrl: null,
            font: null,
          })),
        },
        CLEAR: {
          target: "empty",
          actions: assign(({ context }) => ({
            ...defaultSpecimenContext,
            queryClient: context.queryClient,
          })),
        },
        RETRY: {
          target: "loadingFace",
          guard: "hasFacePayload",
        },
      },
    },

    error: {
      on: {
        LOAD: {
          target: "loadingFace",
          actions: assign(({ event }) => ({
            fontId: event.fontId,
            cdnUrl: event.cdnUrl,
            rawUrl: event.rawUrl ?? null,
            format: event.format ?? null,
            fileName: event.fileName ?? null,
            weight: resolveFontWeight(event.weight),
            style: resolveFontStyle(event.style),
            family: familyFromMeta({
              family: event.family,
              fileName: event.fileName,
              fontId: event.fontId,
            }),
            error: null,
            sourceUrl: null,
            font: null,
          })),
        },
        LOAD_BY_ID: {
          target: "loadingMeta",
          actions: assign(({ event }) => ({
            fontId: event.fontId,
            cdnUrl: null,
            rawUrl: null,
            format: null,
            family: null,
            fileName: null,
            weight: defaultSpecimenContext.weight,
            style: defaultSpecimenContext.style,
            error: null,
            sourceUrl: null,
            font: null,
          })),
        },
        CLEAR: {
          target: "empty",
          actions: assign(({ context }) => ({
            ...defaultSpecimenContext,
            queryClient: context.queryClient,
          })),
        },
        RETRY: [
          {
            guard: "hasFacePayload",
            target: "loadingFace",
            actions: assign({ error: null }),
          },
          {
            guard: ({ context }) => context.fontId != null,
            target: "loadingMeta",
            actions: assign({ error: null }),
          },
        ],
      },
    },
  },
});

export type SpecimenMachine = typeof specimenMachine;
