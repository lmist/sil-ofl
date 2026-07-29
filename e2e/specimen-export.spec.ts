import { expect, test } from "./fixtures";

const FONT_LIST = "[data-font-list]";
const SPECIMEN_TEXTAREA =
  '[data-font-specimen] textarea[aria-label="Editable specimen text"]';

type ClipboardHarness = {
  allowWrite: boolean;
  lastText: string | null;
};

declare global {
  interface Window {
    __clipboardHarness: ClipboardHarness;
  }
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
});
