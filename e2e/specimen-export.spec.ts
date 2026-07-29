import { expect, test } from "./fixtures";

const FONT_LIST = "[data-font-list]";
const SPECIMEN_TEXTAREA =
  '[data-font-specimen] textarea[aria-label="Editable specimen text"]';

type ClipboardHarness = {
  allowWrite: boolean;
  lastText: string | null;
};

type LegacyCopyOutcome = "success" | "false" | "throw";

declare global {
  interface Window {
    __clipboardHarness: ClipboardHarness;
  }
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

async function openCatalog(
  page: import("@playwright/test").Page,
  mockGraphql: () => Promise<{ mocked: boolean }>,
): Promise<void> {
  await mockGraphql();
  await page.goto("/");
  await expect(page.locator(FONT_LIST)).toBeVisible();
}

test.describe("specimen and export regressions", () => {
  test("selected face applies its resolved weight and style to the specimen", async ({
    page,
    mockGraphql,
  }) => {
    await openCatalog(page, mockGraphql);

    await page
      .locator('[data-font-row][aria-label="Select Source Sans 3"]')
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
      "Specimen error: Font CDN URL is unavailable",
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
});
