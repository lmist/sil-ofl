import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";
import { expect, MOCK_FONTS_PAGE1, test } from "./fixtures";

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

async function installFontRequestFailure(page: Page): Promise<void> {
  await page.route("**/api/graphql**", async (route) => {
    const body = route.request().postDataJSON() as { query?: string };
    if (!/\bquery\s+Fonts\b/.test(body.query ?? "")) {
      await route.fallback();
      return;
    }

    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        errors: [{ message: "Catalog temporarily unavailable" }],
      }),
    });
  });
}

async function installFailingFontFace(page: Page): Promise<void> {
  await page.addInitScript(() => {
    class FailingFontFace {
      load(): Promise<this> {
        return Promise.reject(new Error("Font face unavailable"));
      }
    }

    Object.defineProperty(window, "FontFace", {
      configurable: true,
      value: FailingFontFace,
    });
  });
}

async function installDenseRenderFailure(page: Page): Promise<void> {
  await page.route("**/api/graphql**", async (route) => {
    const body = route.request().postDataJSON() as { query?: string };
    if (!/\bquery\s+Fonts\b/.test(body.query ?? "")) {
      await route.fallback();
      return;
    }

    const malformedNode = {
      ...MOCK_FONTS_PAGE1[0],
      stars: null,
    };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          fonts: {
            totalCount: 1,
            pageInfo: {
              hasNextPage: false,
              endCursor: null,
            },
            edges: [{ cursor: "malformed-row", node: malformedNode }],
          },
        },
      }),
    });
  });
}

async function installReplacementFailure(
  page: Page,
): Promise<() => void> {
  let shouldFail = true;

  await page.route("**/api/graphql**", async (route) => {
    const body = route.request().postDataJSON() as {
      query?: string;
      variables?: { filter?: { owner?: string | null } | null };
    };
    const isReplacement =
      /\bquery\s+Fonts\b/.test(body.query ?? "") &&
      body.variables?.filter?.owner === "rsms";

    if (!isReplacement || !shouldFail) {
      await route.fallback();
      return;
    }

    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        errors: [{ message: "Catalog temporarily unavailable" }],
      }),
    });
  });

  return () => {
    shouldFail = false;
  };
}

async function installInvalidCursorFailure(page: Page): Promise<void> {
  await page.route("**/api/graphql**", async (route) => {
    const body = route.request().postDataJSON() as {
      query?: string;
      variables?: { after?: string | null };
    };
    const isInvalidCursor =
      /\bquery\s+Fonts\b/.test(body.query ?? "") &&
      body.variables?.after === "not-a-cursor";

    if (!isInvalidCursor) {
      await route.fallback();
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        errors: [{ message: "Invalid cursor" }],
      }),
    });
  });
}

test.describe("catalog accessibility and responsive layout", () => {
  test("loading and loaded catalog states each have one level-one heading", async ({
    browser,
    baseURL,
    page,
    mockGraphql,
  }) => {
    if (!baseURL) throw new Error("Playwright baseURL is required");

    const loadingContext = await browser.newContext({
      javaScriptEnabled: false,
    });
    const loadingPage = await loadingContext.newPage();
    await loadingPage.goto(baseURL);
    await expect(loadingPage.locator("[data-catalog-skeleton]")).toBeVisible();
    await expect(
      loadingPage.getByRole("heading", {
        level: 1,
        name: "SIL OFL Fonts",
      }),
    ).toHaveCount(1);
    await loadingContext.close();

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

  test("catalog errors suppress competing result announcements", async ({
    page,
    mockGraphql,
  }) => {
    await mockGraphql();
    await installFontRequestFailure(page);
    await page.goto("/");

    const catalog = page.locator(CATALOG);
    const alert = catalog.getByRole("alert");
    await expect(alert).toBeVisible();
    await expect(catalog.locator(RESULT_STATUS)).toHaveCount(0);
    await expect(catalog.locator("[data-filter-chip-strip]")).toHaveCount(0);
    await expectMinimumTargetSize(
      alert.getByRole("button", { name: "Retry" }),
    );
  });

  test("stale list recovery actions have 24px targets without a result announcement", async ({
    page,
    mockGraphql,
  }) => {
    await mockGraphql();
    const recover = await installReplacementFailure(page);
    await page.goto("/");
    await waitForCatalog(page);

    await page.getByRole("textbox", { name: "Owner" }).fill("rsms");
    const alert = page.locator("[data-catalog-error]");
    await expect(alert).toBeVisible();
    await expect(page.locator(RESULT_STATUS)).toHaveCount(0);
    await expect(page.locator("[data-filter-chip-strip]")).toBeVisible();
    await expectMinimumTargetSize(alert.getByRole("button"));

    recover();
    await alert.getByRole("button", { name: "Retry" }).click();
    await expect(alert).toHaveCount(0);
  });

  test("dense recovery actions have 24px targets", async ({
    page,
    mockGraphql,
  }) => {
    await mockGraphql();
    await installReplacementFailure(page);
    await page.goto("/");
    await waitForCatalog(page);
    await page.getByRole("button", { name: "Dense table mode" }).click();

    await page.getByRole("textbox", { name: "Owner" }).fill("rsms");
    const alert = page.locator("[data-catalog-error]");
    await expect(alert).toBeVisible();
    await expectMinimumTargetSize(alert.getByRole("button"));
  });

  test("cursor reset recovery actions have 24px targets", async ({
    page,
    mockGraphql,
  }) => {
    await mockGraphql();
    await installInvalidCursorFailure(page);
    await page.goto("/?after=not-a-cursor");

    const alert = page.locator("[data-catalog-error]");
    await expect(alert).toBeVisible();
    await expect(alert.getByRole("button", { name: "Reset" })).toBeVisible();
    await expectMinimumTargetSize(alert.getByRole("button"));
  });

  test("specimen recovery has a 24px target", async ({
    page,
    mockGraphql,
  }) => {
    await installFailingFontFace(page);
    await mockGraphql();
    await page.goto("/");
    await waitForCatalog(page);

    await page.locator(FONT_ROW).first().click();
    const specimen = page.locator("[data-font-specimen]");
    await expect(specimen.getByText(/Specimen error:/)).toBeVisible();
    await expectMinimumTargetSize(
      specimen.getByRole("button", { name: "Retry" }),
    );
  });

  test("catalog render recovery has a 24px target", async ({
    page,
    mockGraphql,
  }) => {
    await mockGraphql();
    await installDenseRenderFailure(page);
    await page.goto("/");
    await waitForCatalog(page);

    await page.getByRole("button", { name: "Dense table mode" }).click();
    const boundary = page.locator("[data-catalog-error-boundary]");
    await expect(boundary).toBeVisible();
    await expectMinimumTargetSize(
      boundary.getByRole("button", { name: "Try again" }),
    );
  });

  test("catalog render error copy meets minimum contrast", async ({
    page,
    mockGraphql,
  }) => {
    await mockGraphql();
    await installDenseRenderFailure(page);
    await page.goto("/");
    await waitForCatalog(page);

    await page.getByRole("button", { name: "Dense table mode" }).click();
    const boundary = page.locator("[data-catalog-error-boundary]");
    await expect(boundary).toBeVisible();

    const results = await new AxeBuilder({ page })
      .include("[data-catalog-error-boundary]")
      .withRules(["color-contrast"])
      .analyze();
    expect(results.violations.map(({ id }) => id)).toEqual([]);
  });

  test("hovered catalog recovery keeps sufficient contrast", async ({
    page,
    mockGraphql,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await mockGraphql();
    await installDenseRenderFailure(page);
    await page.goto("/");
    await waitForCatalog(page);

    await page.getByRole("button", { name: "Dense table mode" }).click();
    const boundary = page.locator("[data-catalog-error-boundary]");
    const recovery = boundary.getByRole("button", { name: "Try again" });
    await expect(recovery).toBeVisible();
    await recovery.hover();

    await expect(recovery).toHaveCSS("opacity", "1");
    await expect(recovery).toHaveCSS("color", "rgb(255, 255, 255)");

    const results = await new AxeBuilder({ page })
      .include("[data-catalog-error-boundary]")
      .withRules(["color-contrast"])
      .analyze();
    expect(results.violations.map(({ id }) => id)).toEqual([]);
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
