import { expect, test } from "./fixtures";
import {
  MOCK_FONTS_PAGE1,
  MOCK_NULL_FAMILY_FONT,
} from "./fixtures/mock-data";

const FONT_LIST = "[data-font-list]";
const SPECIMEN_TEXTAREA =
  '[data-font-specimen] textarea[aria-label="Editable specimen text"]';

type ClipboardHarness = {
  allowWrite: boolean;
  lastText: string | null;
};

type LegacyCopyOutcome = "success" | "false" | "throw";
type DeferredCopyOutcome = "resolve" | "reject";

type DeferredClipboardHarness = {
  calls: string[];
  clipboardText: string | null;
  fallbackTexts: string[];
  settle: (index: number, outcome: DeferredCopyOutcome) => void;
};

type FontFaceHarness = {
  constructedFamilies: string[];
  added: number;
  deleted: number;
};

declare global {
  interface Window {
    __clipboardHarness: ClipboardHarness;
    __deferredClipboardHarness: DeferredClipboardHarness;
    __fontFaceHarness: FontFaceHarness;
  }
}

async function installFontFaceHarness(
  page: import("@playwright/test").Page,
): Promise<void> {
  await page.addInitScript(() => {
    const harness: FontFaceHarness = {
      constructedFamilies: [],
      added: 0,
      deleted: 0,
    };

    class HarnessFontFace {
      family: string;

      constructor(family: string) {
        this.family = family;
        harness.constructedFamilies.push(family);
      }

      load(): Promise<this> {
        return Promise.resolve(this);
      }
    }

    Object.defineProperty(window, "__fontFaceHarness", {
      configurable: true,
      value: harness,
    });
    Object.defineProperty(window, "FontFace", {
      configurable: true,
      value: HarnessFontFace,
    });
    Object.defineProperty(document.fonts, "add", {
      configurable: true,
      value: () => {
        harness.added += 1;
        return document.fonts;
      },
    });
    Object.defineProperty(document.fonts, "delete", {
      configurable: true,
      value: () => {
        harness.deleted += 1;
        return true;
      },
    });
  });
}

async function forceLegacyClipboard(
  page: import("@playwright/test").Page,
  outcome: LegacyCopyOutcome,
): Promise<void> {
  await page.addInitScript((legacyOutcome) => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async () => {
          throw new DOMException("Denied", "NotAllowedError");
        },
      },
    });
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: () => {
        if (legacyOutcome === "throw") {
          throw new DOMException("Copy failed", "NotAllowedError");
        }
        return legacyOutcome === "success";
      },
    });
  }, outcome);
}

async function forceDeferredClipboard(
  page: import("@playwright/test").Page,
): Promise<void> {
  await page.addInitScript(() => {
    type DeferredSlot = {
      outcome: DeferredCopyOutcome | null;
      resolve: (() => void) | null;
      reject: (() => void) | null;
    };

    const slots: DeferredSlot[] = [];
    const slotAt = (index: number): DeferredSlot => {
      slots[index] ??= {
        outcome: null,
        resolve: null,
        reject: null,
      };
      return slots[index];
    };
    const finish = (slot: DeferredSlot): void => {
      if (!slot.outcome || !slot.resolve || !slot.reject) return;
      const complete =
        slot.outcome === "resolve" ? slot.resolve : slot.reject;
      slot.resolve = null;
      slot.reject = null;
      complete();
    };
    const harness: DeferredClipboardHarness = {
      calls: [],
      clipboardText: null,
      fallbackTexts: [],
      settle: (index, outcome) => {
        const slot = slotAt(index);
        slot.outcome = outcome;
        finish(slot);
      },
    };

    Object.defineProperty(window, "__deferredClipboardHarness", {
      configurable: true,
      value: harness,
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: (text: string) => {
          const index = harness.calls.push(text) - 1;
          const slot = slotAt(index);
          return new Promise<void>((resolve, reject) => {
            slot.resolve = () => {
              harness.clipboardText = text;
              resolve();
            };
            slot.reject = () => {
              reject(new DOMException("Denied", "NotAllowedError"));
            };
            finish(slot);
          });
        },
      },
    });
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: () => {
        const fallbackText =
          Array.from(document.querySelectorAll("textarea")).find(
            (element) => element.readOnly,
          )?.value ?? "";
        harness.fallbackTexts.push(fallbackText);
        harness.clipboardText = fallbackText;
        return true;
      },
    });
  });
}

async function openCatalog(
  page: import("@playwright/test").Page,
  mockGraphql: () => Promise<{ mocked: boolean }>,
): Promise<void> {
  await mockGraphql();
  await page.goto("/");
  await expect(page.locator(FONT_LIST)).toBeVisible();
}

test.describe("specimen and export regressions", () => {
  test("missing family metadata has one specimen and export identity", async ({
    page,
    mockGraphql,
  }) => {
    await installFontFaceHarness(page);
    await mockGraphql({ fontNodes: [MOCK_NULL_FAMILY_FONT] });
    await page.goto("/");

    const row = page.locator("[data-font-row]").first();
    await expect(row).toBeVisible();
    await row.click();

    await expect(page.locator("[data-font-specimen]")).toContainText(
      "Unknown Regular",
    );
    await expect(page.locator("[data-font-use-panel]")).toContainText(
      "Unknown Regular",
    );
    await expect(page.locator("[data-font-use-panel] code")).toContainText(
      "font-family: 'Unknown Regular'",
    );
    await expect
      .poll(() =>
        page.evaluate(() => {
          const families = window.__fontFaceHarness.constructedFamilies;
          return (
            families.length > 0 &&
            families.every((family) => family === "Unknown Regular")
          );
        }),
      )
      .toBe(true);
    await expect(row).not.toContainText("Unknown-Regular.ttf");

    await page.getByRole("button", { name: "Dense table mode" }).click();
    const denseRow = page
      .locator("[data-dense-font-table]")
      .getByRole("button", { name: /Unknown Regular$/ });
    await expect(denseRow).toContainText("Unknown Regular");
    await expect(denseRow).not.toContainText("Unknown-Regular.ttf");
  });

  test("font registrations replace the previous face and clear on reset", async ({
    page,
    mockGraphql,
  }) => {
    const sameFamilyFonts = [
      MOCK_FONTS_PAGE1[0]!,
      {
        ...MOCK_FONTS_PAGE1[1]!,
        familyGuess: MOCK_FONTS_PAGE1[0]!.familyGuess,
      },
    ];
    await installFontFaceHarness(page);
    await mockGraphql({ fontNodes: sameFamilyFonts });
    await page.goto("/");

    const rows = page.locator("[data-font-row]");
    await rows.nth(0).click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            window.__fontFaceHarness.added -
            window.__fontFaceHarness.deleted,
        ),
      )
      .toBe(1);
    const firstAdded = await page.evaluate(
      () => window.__fontFaceHarness.added,
    );

    await rows.nth(1).click();
    await expect
      .poll(() =>
        page.evaluate(
          (previousAdded) =>
            window.__fontFaceHarness.added > previousAdded,
          firstAdded,
        ),
      )
      .toBe(true);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            window.__fontFaceHarness.added -
            window.__fontFaceHarness.deleted,
        ),
      )
      .toBe(1);

    await page
      .getByRole("navigation", { name: "Catalog pagination" })
      .getByRole("button", { name: "Clear filters" })
      .click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            window.__fontFaceHarness.added -
            window.__fontFaceHarness.deleted,
        ),
      )
      .toBe(0);
  });

  test("adversarial family names remain one inert browser family", async ({
    page,
    mockGraphql,
  }) => {
    const family = 'Injected", serif, "Family\nName\\';
    await installFontFaceHarness(page);
    await mockGraphql({
      fontNodes: [{ ...MOCK_FONTS_PAGE1[0]!, familyGuess: family }],
    });
    await page.goto("/");

    await page.locator("[data-font-row]").first().click();

    await expect
      .poll(() =>
        page.evaluate((expectedFamily) => {
          const families = window.__fontFaceHarness.constructedFamilies;
          return (
            families.length > 0 &&
            families.every((candidate) => candidate === expectedFamily)
          );
        }, family),
      )
      .toBe(true);
    await expect
      .poll(() =>
        page.locator(SPECIMEN_TEXTAREA).evaluate((element) => ({
          family: (element as HTMLTextAreaElement).style.fontFamily,
          valid: (element as HTMLTextAreaElement).style.fontFamily.length > 0,
        })),
      )
      .toEqual({
        family: '"Injected\\", serif, \\"Family\\a Name\\\\", sans-serif',
        valid: true,
      });
  });

  test("selected face applies its resolved weight and style to the specimen", async ({
    page,
    mockGraphql,
  }) => {
    await openCatalog(page, mockGraphql);

    await page
      .getByRole("button", { name: /^Select Source Sans 3\b/ })
      .click();

    await expect
      .poll(() =>
        page.locator(SPECIMEN_TEXTAREA).evaluate((element) => {
          const style = getComputedStyle(element);
          return {
            fontStyle: style.fontStyle,
            fontWeight: style.fontWeight,
          };
        }),
      )
      .toEqual({ fontStyle: "italic", fontWeight: "700" });
  });

  test("clipboard failure is announced and the same action can be retried", async ({
    page,
    mockGraphql,
  }) => {
    await page.addInitScript(() => {
      const clipboardHarness = {
        allowWrite: false,
        lastText: null as string | null,
      };
      Object.defineProperty(window, "__clipboardHarness", {
        configurable: true,
        value: clipboardHarness,
      });
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (text: string) => {
            if (!clipboardHarness.allowWrite) {
              throw new DOMException("Denied", "NotAllowedError");
            }
            clipboardHarness.lastText = text;
          },
        },
      });
      Object.defineProperty(document, "execCommand", {
        configurable: true,
        value: () => false,
      });
    });

    await openCatalog(page, mockGraphql);
    await page.locator("[data-font-row]").first().click();

    const copyCss = page.getByRole("button", {
      name: "Copy CSS @font-face",
    });
    await copyCss.click();

    await expect(page.locator('[data-copy-feedback][role="alert"]')).toHaveText(
      "Copy failed. Try again.",
    );
    await expect(copyCss).toBeEnabled();
    await expect(copyCss).toContainText("Retry Copy CSS");
    await expect(copyCss).not.toContainText("Copied");

    await page.evaluate(() => {
      window.__clipboardHarness.allowWrite = true;
    });
    await copyCss.click();

    await expect(page.locator('[data-copy-feedback][role="status"]')).toHaveText(
      "CSS copied.",
    );
    await expect(copyCss).toContainText("Copied");
    await expect
      .poll(() =>
        page.evaluate(
          () => window.__clipboardHarness.lastText,
        ),
      )
      .toContain("@font-face");
  });

  test("unapproved external targets are unavailable and never requested", async ({
    page,
    mockGraphql,
  }) => {
    const unsafeRequests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("fonts.evil.example")) {
        unsafeRequests.push(request.url());
      }
    });

    await mockGraphql({ unsafeExternalUrls: true });
    await page.goto("/");
    await expect(page.locator(FONT_LIST)).toBeVisible();
    await page.locator("[data-font-row]").first().click();

    await expect(page.locator("[data-external-url-error]")).toHaveText(
      "Some font actions are unavailable because this record has unapproved links. Choose another font.",
    );
    for (const name of [
      "Copy CSS @font-face",
      "Copy HTML starter page",
      "Copy React / CSS usage",
      "Copy CDN URL",
      "Copy raw GitHub URL",
    ]) {
      await expect(page.getByRole("button", { name })).toBeDisabled();
    }
    await expect(page.getByRole("link", { name: /^Download / })).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: /^Open .* on GitHub$/ }),
    ).toHaveCount(0);
    await expect(page.locator("[data-font-specimen]")).toContainText(
      "Specimen error: Font face is unavailable.",
    );
    await expect(
      page.locator("[data-font-specimen]").getByRole("button", {
        name: "Retry",
      }),
    ).toBeEnabled();
    expect(unsafeRequests).toEqual([]);
  });

  for (const outcome of ["success", "false", "throw"] as const) {
    test(`legacy clipboard ${outcome} restores focus to its copy control`, async ({
      page,
      mockGraphql,
    }) => {
      await forceLegacyClipboard(page, outcome);
      await openCatalog(page, mockGraphql);
      await page.locator("[data-font-row]").first().click();

      const copyCdn = page.getByRole("button", { name: "Copy CDN URL" });
      await copyCdn.focus();
      await expect(copyCdn).toBeFocused();
      await copyCdn.click();

      if (outcome === "success") {
        await expect(
          page.locator('[data-copy-feedback][role="status"]'),
        ).toHaveText("CDN URL copied.");
      } else {
        await expect(
          page.locator('[data-copy-feedback][role="alert"]'),
        ).toHaveText("Copy failed. Try again.");
      }
      await expect(copyCdn).toBeFocused();
    });
  }

  test("delayed fallback preserves focus moved to another copy control", async ({
    page,
    mockGraphql,
  }) => {
    await forceDeferredClipboard(page);
    await openCatalog(page, mockGraphql);
    await page.locator("[data-font-row]").first().click();

    const copyCdn = page.getByRole("button", { name: "Copy CDN URL" });
    const copyCss = page.getByRole("button", {
      name: "Copy CSS @font-face",
    });
    await copyCdn.click();
    await expect
      .poll(() =>
        page.evaluate(
          () => window.__deferredClipboardHarness.calls.length,
        ),
      )
      .toBe(1);
    await copyCss.focus();
    await expect(copyCss).toBeFocused();

    await page.evaluate(() => {
      window.__deferredClipboardHarness.settle(0, "reject");
    });

    await expect
      .poll(() =>
        page.evaluate(
          () => window.__deferredClipboardHarness.fallbackTexts.length,
        ),
      )
      .toBe(1);
    await expect(copyCss).toBeFocused();
  });

  test("delayed fallback restores connected focus after its initiator disconnects", async ({
    page,
    mockGraphql,
  }) => {
    await forceDeferredClipboard(page);
    await openCatalog(page, mockGraphql);
    await page.locator("[data-font-row]").first().click();

    const copyCdn = page.getByRole("button", { name: "Copy CDN URL" });
    await copyCdn.click();
    await expect
      .poll(() =>
        page.evaluate(
          () => window.__deferredClipboardHarness.calls.length,
        ),
      )
      .toBe(1);

    const clear = page
      .getByRole("navigation", { name: "Catalog pagination" })
      .getByRole("button", { name: "Clear filters" });
    await clear.click();
    await expect(copyCdn).toHaveCount(0);
    await expect(clear).toBeFocused();

    await page.evaluate(() => {
      window.__deferredClipboardHarness.settle(0, "reject");
    });

    await expect
      .poll(() =>
        page.evaluate(
          () => window.__deferredClipboardHarness.fallbackTexts.length,
        ),
      )
      .toBe(1);
    await expect(clear).toBeFocused();
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.tagName))
      .not.toBe("BODY");
  });

  for (const olderOutcome of ["reject", "resolve"] as const) {
    test(`latest initiated copy wins when the older native write completes with ${olderOutcome}`, async ({
      page,
      mockGraphql,
    }) => {
      await forceDeferredClipboard(page);
      await openCatalog(page, mockGraphql);
      await page.locator("[data-font-row]").first().click();

      await page.getByRole("button", { name: "Copy CSS @font-face" }).click();
      await expect
        .poll(() =>
          page.evaluate(
            () => window.__deferredClipboardHarness.calls.length,
          ),
        )
        .toBe(1);
      await page.getByRole("button", { name: "Copy CDN URL" }).click();

      await page.evaluate(
        ({ index, outcome }) => {
          window.__deferredClipboardHarness.settle(index, outcome);
        },
        { index: 1, outcome: "resolve" as const },
      );
      await page.evaluate(
        ({ index, outcome }) => {
          window.__deferredClipboardHarness.settle(index, outcome);
        },
        { index: 0, outcome: olderOutcome },
      );
      await page.evaluate(
        () =>
          new Promise<void>((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
          }),
      );

      await expect
        .poll(() =>
          page.evaluate(
            () => window.__deferredClipboardHarness.calls.length,
          ),
        )
        .toBe(2);
      await expect(
        page.locator('[data-copy-feedback][role="status"]'),
      ).toHaveText("CDN URL copied.");
      expect(
        await page.evaluate(
          () => window.__deferredClipboardHarness.clipboardText,
        ),
      ).toBe(
        "https://cdn.jsdelivr.net/gh/rsms/inter@master/docs/font-files/Inter-Regular.woff2",
      );
      expect(
        await page.evaluate(
          () => window.__deferredClipboardHarness.fallbackTexts,
        ),
      ).toEqual([]);
    });
  }
});
