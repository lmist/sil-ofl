import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { loadFontFace } from "./actors/load-font-face";

function restoreGlobal(
  name: "document" | "FontFace",
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor) {
    Object.defineProperty(globalThis, name, descriptor);
  } else {
    Reflect.deleteProperty(globalThis, name);
  }
}

describe("loadFontFace", () => {
  it("rejects an unapproved CDN URL before constructing a font face", async () => {
    const originalDocument = Object.getOwnPropertyDescriptor(
      globalThis,
      "document",
    );
    const originalFontFace = Object.getOwnPropertyDescriptor(
      globalThis,
      "FontFace",
    );
    let constructed = 0;

    class FakeFontFace {
      constructor() {
        constructed += 1;
      }

      async load(): Promise<FontFace> {
        return this as unknown as FontFace;
      }
    }

    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        fonts: {
          add: () => undefined,
        },
      },
    });
    Object.defineProperty(globalThis, "FontFace", {
      configurable: true,
      value: FakeFontFace,
    });

    try {
      await assert.rejects(
        loadFontFace({
          family: "Unsafe Face",
          cdnUrl: "https://fonts.evil.example/face.woff2",
          rawUrl:
            "https://raw.githubusercontent.com/example/fonts/main/face.woff2",
          format: "woff2",
        }),
        { message: "Font CDN URL is unavailable" },
      );
      assert.equal(constructed, 0);
    } finally {
      restoreGlobal("document", originalDocument);
      restoreGlobal("FontFace", originalFontFace);
    }
  });
});
