import { assign, setup } from "xstate";
import type { QueryClient } from "@tanstack/react-query";
import type { FontNode } from "@/graphql/documents";
import {
  resolveFontFamily,
  resolveFontStyle,
  resolveFontWeight,
  type ResolvedFontStyle,
} from "@/lib/font-face-descriptors";
import {
  fetchFontLogic,
  type FetchFontInput,
} from "./actors/fetch-fonts";
import {
  clearRegisteredFontFace,
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

const FONT_DETAILS_ERROR = "Font details are unavailable.";
const FONT_FACE_ERROR = "Font face is unavailable.";

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
  actions: {
    clearRegisteredFace: () => {
      clearRegisteredFontFace();
    },
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
            family: resolveFontFamily({
              familyGuess: event.family,
              fileName: event.fileName,
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
          actions: "clearRegisteredFace",
        },
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
                family: resolveFontFamily({
                  familyGuess: font.familyGuess,
                  fileName: font.fileName,
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
            error: FONT_DETAILS_ERROR,
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
            family: resolveFontFamily({
              familyGuess: event.family,
              fileName: event.fileName,
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
          actions: [
            "clearRegisteredFace",
            assign(({ context }) => ({
              ...defaultSpecimenContext,
              queryClient: context.queryClient,
            })),
          ],
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
            error: FONT_FACE_ERROR,
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
            family: resolveFontFamily({
              familyGuess: event.family,
              fileName: event.fileName,
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
          actions: [
            "clearRegisteredFace",
            assign(({ context }) => ({
              ...defaultSpecimenContext,
              queryClient: context.queryClient,
            })),
          ],
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
            family: resolveFontFamily({
              familyGuess: event.family,
              fileName: event.fileName,
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
          actions: [
            "clearRegisteredFace",
            assign(({ context }) => ({
              ...defaultSpecimenContext,
              queryClient: context.queryClient,
            })),
          ],
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
            family: resolveFontFamily({
              familyGuess: event.family,
              fileName: event.fileName,
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
          actions: [
            "clearRegisteredFace",
            assign(({ context }) => ({
              ...defaultSpecimenContext,
              queryClient: context.queryClient,
            })),
          ],
        },
        RETRY: [
          {
            guard: "hasFacePayload",
            target: "loadingFace",
          },
          {
            guard: ({ context }) => context.fontId != null,
            target: "loadingMeta",
          },
        ],
      },
    },
  },
});

export type SpecimenMachine = typeof specimenMachine;
