import { fromPromise } from "xstate";
import { approvedExternalUrl } from "@/lib/external-url-policy";

export type LoadFontFaceInput = {
  /** CSS font-family name to register */
  family: string;
  /** Preferred jsDelivr / CDN URL */
  cdnUrl: string;
  /** Optional raw GitHub URL fallback */
  rawUrl?: string | null;
  format?: string | null;
  weight?: number | null;
  style?: "normal" | "italic" | "oblique" | null;
};

export type LoadFontFaceOutput = {
  family: string;
  sourceUrl: string;
};

function formatHint(format: string | null | undefined): string | undefined {
  if (!format) return undefined;
  const f = format.toLowerCase();
  if (f === "woff2") return "woff2";
  if (f === "woff") return "woff";
  if (f === "otf" || f === "opentype") return "opentype";
  if (f === "ttf" || f === "truetype") return "truetype";
  if (f === "ttc") return "truetype";
  return undefined;
}

/**
 * Load a webfont via the CSS Font Loading API and add it to document.fonts.
 * Prefers cdnUrl; falls back to rawUrl on failure.
 */
export async function loadFontFace(
  input: LoadFontFaceInput,
  signal?: AbortSignal,
): Promise<LoadFontFaceOutput> {
  if (typeof document === "undefined" || typeof FontFace === "undefined") {
    throw new Error("FontFace API is not available in this environment");
  }

  const cdnUrl = approvedExternalUrl(input.cdnUrl, "fontCdn");
  if (!cdnUrl) {
    throw new Error("Font CDN URL is unavailable");
  }
  const rawUrl = approvedExternalUrl(input.rawUrl, "fontRaw");
  const sources = [cdnUrl, rawUrl].filter((url): url is string => url != null);

  const hint = formatHint(input.format);
  let lastError: unknown;

  for (const url of sources) {
    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    try {
      const src = hint
        ? `url(${JSON.stringify(url)}) format(${JSON.stringify(hint)})`
        : `url(${JSON.stringify(url)})`;
      const face = new FontFace(input.family, src, {
        display: "swap",
        weight: String(input.weight ?? 400),
        style: input.style ?? "normal",
      });
      // FontFace.load() does not take AbortSignal in all browsers; race it.
      const loaded = await Promise.race([
        face.load(),
        new Promise<never>((_, reject) => {
          if (!signal) return;
          if (signal.aborted) {
            reject(new DOMException("Aborted", "AbortError"));
            return;
          }
          signal.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        }),
      ]);
      document.fonts.add(loaded);
      return { family: input.family, sourceUrl: url };
    } catch (err) {
      lastError = err;
      if (err instanceof DOMException && err.name === "AbortError") {
        throw err;
      }
    }
  }

  if (input.rawUrl && !rawUrl) {
    throw new Error("Font raw fallback URL is unavailable");
  }

  throw lastError instanceof DOMException && lastError.name === "AbortError"
    ? lastError
    : new Error("Font face is unavailable");
}

export const loadFontFaceLogic = fromPromise<
  LoadFontFaceOutput,
  LoadFontFaceInput
>(async ({ input, signal }) => loadFontFace(input, signal));
