import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";

const CATALOG = "[data-catalog-shell]";
const DENSE_TABLE = "[data-dense-font-table]";
const FONT_LIST = "[data-font-list]";
const FONT_ROW = "[data-font-row]";
const RESULT_STATUS = "[data-catalog-results-status]";

async function waitForCatalog(page: Page): Promise<void> {
  await expect(page.locator(CATALOG)).toBeVisible();
  await expect(page.locator(`${FONT_LIST}, [data-font-list-empty]`).first()).toBeVisible({
    timeout: 20_000,
  });
}

async function expectMinimumTargetSize(
  locator: Locator,
  minimum = 24,
): Promise<void> {
  const boxes = await locator.evaluateAll((elements) =>
    elements.map((element) => {
      const { width, height } = element.getBoundingClientRect();
      return {
        name:
          element.getAttribute("aria-label") ??
          element.textContent?.trim() ??
          element.tagName,
        width,
        height,
      };
    }),
  );

  expect(boxes.length).toBeGreaterThan(0);
  for (const box of boxes) {
    expect(box.width, `${box.name} width`).toBeGreaterThanOrEqual(minimum);
    expect(box.height, `${box.name} height`).toBeGreaterThanOrEqual(minimum);
  }
}

async function expectNoTargetOverlap(locator: Locator): Promise<void> {
  const boxes = await locator.evaluateAll((elements) =>
    elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        name:
          element.getAttribute("aria-label") ??
          element.textContent?.trim() ??
          element.tagName,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
      };
    }),
  );

  for (let leftIndex = 0; leftIndex < boxes.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < boxes.length;
      rightIndex += 1
    ) {
      const left = boxes[leftIndex]!;
      const right = boxes[rightIndex]!;
      const horizontalOverlap =
        Math.min(left.right, right.right) - Math.max(left.left, right.left);
      const verticalOverlap =
        Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top);
      expect(
        horizontalOverlap > 0 && verticalOverlap > 0,
        `${left.name} overlaps ${right.name}`,
      ).toBe(false);
    }
  }
}

async function targetedAriaViolationIds(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page })
    .withRules([
      "aria-allowed-attr",
      "aria-allowed-role",
      "aria-prohibited-attr",
      "aria-required-children",
      "aria-required-parent",
    ])
    .analyze();
  return results.violations.map(({ id }) => id);
}

test.describe("catalog accessibility and responsive layout", () => {
  test("catalog has one descriptive level-one heading", async ({
    page,
    mockGraphql,
  }) => {
    await mockGraphql();
    await page.goto("/");
    await waitForCatalog(page);

    const heading = page.getByRole("heading", {
      level: 1,
      name: "SIL OFL Fonts",
    });
    await expect(heading).toHaveCount(1);
  });

  test("list selection controls keep native button semantics and valid ARIA", async ({
    page,
    mockGraphql,
  }) => {
    await mockGraphql();
    await page.goto("/");
    await waitForCatalog(page);

    const list = page.getByRole("list", { name: "Font families" });
    await expect(list).not.toHaveAttribute("aria-rowcount");

    const listItems = list.getByRole("listitem");
    await expect(listItems).toHaveCount(3);

    const selectButtons = listItems.getByRole("button", {
      name: /^Select /,
    });
    await expect(selectButtons).toHaveCount(3);
    await expect(selectButtons.first()).toHaveAttribute("aria-pressed", "false");

    await selectButtons.first().focus();
    await selectButtons.first().press("Enter");
    await expect(selectButtons.first()).toHaveAttribute("aria-pressed", "true");

    await selectButtons.nth(1).focus();
    await selectButtons.nth(1).press("Space");
    await expect(selectButtons.nth(1)).toHaveAttribute("aria-pressed", "true");
    await expect(selectButtons.first()).toHaveAttribute("aria-pressed", "false");

    const results = await new AxeBuilder({ page })
      .include(FONT_LIST)
      .withRules(["aria-allowed-attr", "aria-allowed-role"])
      .analyze();
    expect(results.violations.map(({ id }) => id)).toEqual([]);
  });

  test("dense table keeps structural cells and native selection controls", async ({
    page,
    mockGraphql,
  }) => {
    await mockGraphql();
    await page.goto("/");
    await waitForCatalog(page);
    await page.getByRole("button", { name: "Dense table mode" }).click();

    const table = page.getByRole("table", {
      name: "Font catalog dense",
    });
    await expect(table).toBeVisible();

    const familyHeader = table.getByRole("columnheader", {
      name: /^Family/,
    });
    await expect(familyHeader).not.toHaveAttribute("aria-sort");
    const familySort = familyHeader.getByRole("button", {
      name: /^Family/,
    });
    await expect(familySort).toBeVisible();
    await familySort.click();
    await expect(familyHeader).toHaveAttribute("aria-sort", "ascending");

    const selectButtons = table.getByRole("button", { name: /^Select / });
    await expect(selectButtons).toHaveCount(3);
    await selectButtons.first().focus();
    await selectButtons.first().press("Enter");
    await expect(selectButtons.first()).toHaveAttribute("aria-pressed", "true");
    await selectButtons.nth(1).focus();
    await selectButtons.nth(1).press("Space");
    await expect(selectButtons.nth(1)).toHaveAttribute("aria-pressed", "true");
    await expect(selectButtons.first()).toHaveAttribute("aria-pressed", "false");

    await table.locator("tbody tr").nth(2).getByRole("cell").last().click();
    await expect(selectButtons.nth(2)).toHaveAttribute("aria-pressed", "true");

    const results = await new AxeBuilder({ page })
      .include(DENSE_TABLE)
      .withRules(["aria-allowed-attr", "aria-allowed-role"])
      .analyze();
    expect(results.violations.map(({ id }) => id)).toEqual([]);
  });

  for (const viewport of [
    { name: "desktop", width: 1280, height: 900 },
    { name: "320px", width: 320, height: 900 },
  ]) {
    test(`small catalog text meets contrast at ${viewport.name}`, async ({
      page,
      mockGraphql,
    }) => {
      await page.setViewportSize(viewport);
      await mockGraphql();
      await page.goto("/");
      await waitForCatalog(page);

      const defaultResults = await new AxeBuilder({ page })
        .include(CATALOG)
        .withRules(["color-contrast"])
        .analyze();
      expect(defaultResults.violations.map(({ id }) => id)).toEqual([]);

      await page
        .getByRole("searchbox", { name: "Search fonts" })
        .fill("definitely-no-matching-font");
      await expect(page.locator("[data-font-list-empty]")).toBeVisible();

      const emptyResults = await new AxeBuilder({ page })
        .include(CATALOG)
        .withRules(["color-contrast"])
        .analyze();
      expect(emptyResults.violations.map(({ id }) => id)).toEqual([]);
    });
  }

  for (const filter of [
    {
      name: "search",
      inputRole: "searchbox" as const,
      inputName: "Search fonts",
      chipPrefix: "Search",
      value: "searchvalue".repeat(50),
    },
    {
      name: "owner",
      inputRole: "textbox" as const,
      inputName: "Owner",
      chipPrefix: "Owner",
      value: "ownervalue".repeat(50),
    },
  ]) {
    test(`long ${filter.name} chip stays inside a 320px viewport`, async ({
      page,
      mockGraphql,
    }) => {
      await page.setViewportSize({ width: 320, height: 900 });
      await mockGraphql();
      await page.goto("/");
      await waitForCatalog(page);

      await page
        .getByRole(filter.inputRole, { name: filter.inputName })
        .fill(filter.value);

      const chip = page.getByRole("button", {
        name: `Remove filter ${filter.chipPrefix}: ${filter.value}`,
        exact: true,
      });
      await expect(chip).toBeVisible();

      const layout = await chip.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const scrollingElement = document.scrollingElement;
        return {
          chipLeft: rect.left,
          chipRight: rect.right,
          clientWidth: scrollingElement?.clientWidth ?? document.documentElement.clientWidth,
          scrollWidth: scrollingElement?.scrollWidth ?? document.documentElement.scrollWidth,
        };
      });
      expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
      expect(layout.chipLeft).toBeGreaterThanOrEqual(0);
      expect(layout.chipRight).toBeLessThanOrEqual(layout.clientWidth);
    });
  }

  test("unknown routes return 404 with a catalog recovery link", async ({
    page,
  }) => {
    const response = await page.goto("/definitely-not-a-catalog-route");
    expect(response?.status()).toBe(404);

    await expect(
      page.getByRole("heading", { level: 1, name: "Page not found" }),
    ).toBeVisible();
    const returnLink = page.getByRole("link", {
      name: "Return to font catalog",
    });
    await expect(returnLink).toHaveAttribute("href", "/");

    await returnLink.click();
    await expect(page).toHaveURL("/");
  });

  test("search transitions use one concise catalog results live status", async ({
    page,
    mockGraphql,
  }) => {
    await mockGraphql({ fontsDelayMs: 400 });
    await page.goto("/");
    await waitForCatalog(page);

    const catalog = page.locator(CATALOG);
    const status = catalog.locator(RESULT_STATUS);
    const liveRegions = catalog.locator(
      '[aria-live="polite"], [aria-live="assertive"], [role="status"]',
    );

    await expect(status).toHaveCount(1);
    await expect(liveRegions).toHaveCount(1);
    await expect(status).toHaveText("6 matches");

    await page.getByRole("searchbox", { name: "Search fonts" }).fill("Inter");
    await expect(status).toHaveText("Searching…");
    await expect(status).toHaveText("Updating results…");
    await expect(status).toHaveText("1 match");
    await expect(liveRegions).toHaveCount(1);
  });

  test("compact catalog actions have non-overlapping 24px targets", async ({
    page,
    mockGraphql,
  }) => {
    await page.setViewportSize({ width: 320, height: 900 });
    await mockGraphql();
    await page.goto("/");
    await waitForCatalog(page);

    await page.locator(FONT_ROW).first().click();
    const usePanel = page.locator("[data-font-use-panel]");
    await expect(usePanel).toBeVisible();
    const useActions = usePanel.locator("button, a");
    await expect(useActions).toHaveCount(7);
    await expectMinimumTargetSize(useActions);
    await expectNoTargetOverlap(useActions);

    await page.getByRole("button", { name: "Dense table mode" }).click();
    const denseTable = page.locator(DENSE_TABLE);
    await expect(denseTable).toBeVisible();
    const denseActions = denseTable.locator(
      '[data-sortable="true"], [data-font-row]',
    );
    await expectMinimumTargetSize(denseActions);
    await expectNoTargetOverlap(denseActions);
  });

  test("default, selected, and dense catalog states have valid ARIA", async ({
    page,
    mockGraphql,
  }) => {
    await mockGraphql();
    await page.goto("/");
    await waitForCatalog(page);
    expect(await targetedAriaViolationIds(page)).toEqual([]);

    await page.locator(FONT_ROW).first().click();
    await expect(page.locator("[data-font-use-panel]")).toBeVisible();
    expect(await targetedAriaViolationIds(page)).toEqual([]);

    await page.getByRole("button", { name: "Dense table mode" }).click();
    await expect(page.locator(DENSE_TABLE)).toBeVisible();
    expect(await targetedAriaViolationIds(page)).toEqual([]);
  });
});
