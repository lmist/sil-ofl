import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";
import { expect, MOCK_FONTS_PAGE1, test } from "./fixtures";

const CATALOG = "[data-catalog-shell]";
const DENSE_TABLE = "[data-dense-font-table]";
const FONT_LIST = "[data-font-list]";
const FONT_ROW = "[data-font-row]";
const RESULT_STATUS = "[data-catalog-results-status]";
const EXTREME_FAMILY = Array(18)
  .fill("Extraordinarily Long Wrapping Family")
  .join(" ");
const EXTREME_OWNER = Array(18)
  .fill("extraordinarily-long-wrapping-owner")
  .join(" ");
const EXTREME_FILENAME =
  `${String.raw`unbroken"'<>&\\-font-filename`.repeat(45)}.woff2`;
const EXTREME_REPOSITORY = [
  String.raw`unbroken-owner*/<>&"'\\`.repeat(30),
  String.raw`unbroken-repository*/<>&"'\\`.repeat(30),
].join("/");
const EXTREME_ERROR = "unbroken-catalog-error".repeat(80);

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

async function installFontRequestFailure(
  page: Page,
  message = "Catalog temporarily unavailable",
): Promise<void> {
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
        errors: [{ message }],
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

async function installRetryingFontFace(page: Page): Promise<void> {
  await page.addInitScript(() => {
    let attempts = 0;
    const harness = window as Window & {
      __resolveRetryingFontFace?: () => void;
    };

    class RetryingFontFace {
      load(): Promise<this> {
        attempts += 1;
        if (attempts <= 2) {
          return Promise.reject(new Error("Font face unavailable"));
        }
        return new Promise((resolve) => {
          harness.__resolveRetryingFontFace = () => resolve(this);
        });
      }
    }

    Object.defineProperty(window, "FontFace", {
      configurable: true,
      value: RetryingFontFace,
    });
    Object.defineProperty(document.fonts, "add", {
      configurable: true,
      value: () => document.fonts,
    });
  });
}

async function installDenseRenderFailure(
  page: Page,
  options: { once?: boolean } = {},
): Promise<() => number> {
  let interceptedRequests = 0;

  await page.route("**/api/graphql**", async (route) => {
    const body = route.request().postDataJSON() as { query?: string };
    if (!/\bquery\s+Fonts\b/.test(body.query ?? "")) {
      await route.fallback();
      return;
    }

    interceptedRequests += 1;
    if (options.once && interceptedRequests > 1) {
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

  return () => interceptedRequests;
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
      loadingPage.getByRole("heading", { level: 1 }),
    ).toHaveCount(1);
    await expect(
      loadingPage.getByRole("heading", { level: 1 }),
    ).toHaveAccessibleName("SIL OFL Fonts");
    await loadingContext.close();

    await mockGraphql();
    await page.goto("/");
    await waitForCatalog(page);

    await expect(
      page.getByRole("heading", { level: 1 }),
    ).toHaveCount(1);
    const heading = page.getByRole("heading", {
      level: 1,
      name: "SIL OFL Fonts",
    });
    await expect(heading).toHaveCount(1);
  });

  test("honors reduced motion for catalog transitions", async ({
    page,
    mockGraphql,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await mockGraphql();
    await page.goto("/");
    await waitForCatalog(page);

    await page.evaluate(() => {
      const style = document.createElement("style");
      style.textContent = `
        @keyframes reduced-motion-contract {
          from { transform: translateX(0); }
          to { transform: translateX(1px); }
        }
        [data-reduced-motion-probe]::before,
        [data-reduced-motion-probe]::after {
          animation: reduced-motion-contract 2s linear infinite;
          content: "";
          display: block;
          transition: transform 2s linear;
        }
      `;
      const probe = document.createElement("div");
      probe.setAttribute("data-reduced-motion-probe", "");
      probe.style.animation =
        "reduced-motion-contract 2s linear infinite";
      probe.style.transition = "transform 2s linear";
      probe.style.scrollBehavior = "smooth";
      probe.style.height = "1px";
      probe.style.width = "1px";
      probe.style.overflow = "auto";
      const overflow = document.createElement("div");
      overflow.style.height = "2px";
      overflow.style.width = "2px";
      probe.append(overflow);
      document.head.append(style);
      document.body.append(probe);
    });

    const motion = await page
      .locator(
        `html, ${CATALOG}, ${CATALOG} *, [data-reduced-motion-probe]`,
      )
      .evaluateAll((elements) => {
        const durationMs = (duration: string): number => {
          const value = Number.parseFloat(duration);
          if (!Number.isFinite(value)) return 0;
          return duration.trim().endsWith("ms") ? value : value * 1_000;
        };

        let maxTransitionMs = 0;
        let maxAnimationMs = 0;
        let maxAnimationIterations = 0;
        for (const element of elements) {
          const styles = [
            getComputedStyle(element),
            getComputedStyle(element, "::before"),
            getComputedStyle(element, "::after"),
          ];
          for (const style of styles) {
            for (const duration of style.transitionDuration.split(",")) {
              maxTransitionMs = Math.max(
                maxTransitionMs,
                durationMs(duration),
              );
            }
            for (const duration of style.animationDuration.split(",")) {
              maxAnimationMs = Math.max(
                maxAnimationMs,
                durationMs(duration),
              );
            }
            for (const count of style.animationIterationCount.split(",")) {
              const iterations =
                count.trim() === "infinite"
                  ? Number.POSITIVE_INFINITY
                  : Number.parseFloat(count);
              if (!Number.isNaN(iterations)) {
                maxAnimationIterations = Math.max(
                  maxAnimationIterations,
                  iterations,
                );
              }
            }
          }
        }

        const probe = document.querySelector<HTMLElement>(
          "[data-reduced-motion-probe]",
        );
        if (!probe) throw new Error("Expected a reduced-motion probe");
        const probeStyle = getComputedStyle(probe);
        return {
          maxTransitionMs,
          maxAnimationMs,
          maxAnimationIterations,
          probeAnimationName: probeStyle.animationName,
          probeScrollBehavior: probeStyle.scrollBehavior,
          reducedMotionMatches: matchMedia(
            "(prefers-reduced-motion: reduce)",
          ).matches,
          scrollBehavior: getComputedStyle(document.documentElement)
            .scrollBehavior,
        };
      });

    expect(motion.reducedMotionMatches).toBe(true);
    expect(motion.maxTransitionMs).toBeLessThanOrEqual(0.01);
    expect(motion.maxAnimationMs).toBeLessThanOrEqual(0.01);
    expect(motion.maxAnimationIterations).toBeLessThanOrEqual(1);
    expect(motion.probeAnimationName).toBe("reduced-motion-contract");
    expect(motion.probeScrollBehavior).toBe("auto");
    expect(motion.scrollBehavior).toBe("auto");
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
    await expect(listItems.nth(0)).toHaveAttribute("aria-posinset", "1");
    await expect(listItems.nth(1)).toHaveAttribute("aria-posinset", "2");
    await expect(listItems.nth(2)).toHaveAttribute("aria-posinset", "3");
    await expect(listItems.first()).toHaveAttribute("aria-setsize", "6");

    const selectButtons = listItems.getByRole("button", {
      name: /^Select /,
    });
    await expect(selectButtons).toHaveCount(3);
    await expect(selectButtons.first()).toHaveAttribute("aria-pressed", "false");

    await selectButtons.first().focus();
    await selectButtons.first().press("Enter");
    await expect(selectButtons.first()).toHaveAttribute("aria-pressed", "true");
    await expect(selectButtons.first().getByText("Selected")).toBeVisible();
    await expect(selectButtons.first()).toHaveAccessibleName(
      /^Select Selected: /,
    );

    await selectButtons.nth(1).focus();
    await selectButtons.nth(1).press("Space");
    await expect(selectButtons.nth(1)).toHaveAttribute("aria-pressed", "true");
    await expect(selectButtons.nth(1).getByText("Selected")).toBeVisible();
    await expect(selectButtons.first()).toHaveAttribute("aria-pressed", "false");
    await expect(selectButtons.first().getByText("Selected")).toHaveCount(0);

    const results = await new AxeBuilder({ page })
      .include(FONT_LIST)
      .withRules([
        "aria-allowed-attr",
        "aria-allowed-role",
        "label-content-name-mismatch",
      ])
      .analyze();
    expect(results.violations.map(({ id }) => id)).toEqual([]);

    await page.getByRole("button", { name: "Next page" }).click();
    await expect(listItems.nth(0)).toHaveAttribute("aria-posinset", "4");
    await expect(listItems.nth(1)).toHaveAttribute("aria-posinset", "5");
    await expect(listItems.nth(2)).toHaveAttribute("aria-posinset", "6");
    await expect(listItems.first()).toHaveAttribute("aria-setsize", "6");
  });

  test("long virtual rows stay bounded at 320px and 200% zoom", async ({
    page,
    mockGraphql,
  }) => {
    await page.setViewportSize({ width: 320, height: 900 });
    const fontNodes = MOCK_FONTS_PAGE1.map((node, index) =>
      index === 0
        ? {
            ...node,
            familyGuess: EXTREME_FAMILY,
            ownerLogin: EXTREME_OWNER,
            fullName: `${EXTREME_OWNER}/fonts`,
          }
        : node,
    );
    await mockGraphql({ fontNodes });
    await page.goto("/");
    await waitForCatalog(page);

    const list = page.getByRole("list", { name: "Font families" });
    const listItems = list.getByRole("listitem");
    await expect(listItems).toHaveCount(3);
    const firstButton = listItems.nth(0).getByRole("button");
    const secondButton = listItems.nth(1).getByRole("button");

    await firstButton.click();
    await expect(firstButton).toHaveAttribute("aria-pressed", "true");
    await expect(firstButton).toHaveAccessibleName(
      new RegExp(`^Select Selected: ${EXTREME_FAMILY}`),
    );
    await expect(firstButton).toHaveAccessibleName(
      new RegExp(`${EXTREME_OWNER} · woff2 · ★5000$`),
    );

    await page.evaluate(() => {
      document.documentElement.style.setProperty("zoom", "2");
    });

    const readGeometry = () =>
      listItems.evaluateAll((items) => {
        const first = items[0];
        const second = items[1];
        if (
          !(first instanceof HTMLElement) ||
          !(second instanceof HTMLElement)
        ) {
          throw new Error("Expected two virtual font rows");
        }

        const button = first.querySelector<HTMLElement>("[data-font-row]");
        const list = first.closest<HTMLElement>("[data-font-list]");
        if (!button || !list) {
          throw new Error("Expected an interactive font list row");
        }

        const firstRect = first.getBoundingClientRect();
        const secondRect = second.getBoundingClientRect();
        const buttonRect = button.getBoundingClientRect();
        const content = [
          button.querySelector<HTMLElement>("[data-font-row-sample]"),
          button.querySelector<HTMLElement>("[data-font-row-name]"),
          button.querySelector<HTMLElement>("[data-font-row-meta]"),
        ].map((element) => {
          if (!element) throw new Error("Expected complete row content");
          const rect = element.getBoundingClientRect();
          return {
            top: rect.top,
            bottom: rect.bottom,
          };
        });
        const scrollingElement =
          document.scrollingElement ?? document.documentElement;
        const documentScrollWidthWithRow = scrollingElement.scrollWidth;
        const display = button.style.display;
        button.style.display = "none";
        const documentScrollWidthWithoutRow = scrollingElement.scrollWidth;
        button.style.display = display;

        return {
          zoom: getComputedStyle(document.documentElement).zoom,
          firstTop: firstRect.top,
          firstBottom: firstRect.bottom,
          firstHeight: firstRect.height,
          secondTop: secondRect.top,
          buttonTop: buttonRect.top,
          buttonBottom: buttonRect.bottom,
          buttonClientHeight: button.clientHeight,
          buttonScrollHeight: button.scrollHeight,
          listClientWidth: list.clientWidth,
          listScrollWidth: list.scrollWidth,
          documentScrollWidthWithRow,
          documentScrollWidthWithoutRow,
          content,
        };
      });
    await expect.poll(async () => (await readGeometry()).zoom).toBe("2");
    const geometry = await readGeometry();

    expect(geometry.firstHeight).toBeCloseTo(480, 0);
    expect(geometry.secondTop).toBeCloseTo(geometry.firstBottom, 0);
    expect(geometry.buttonTop).toBeGreaterThanOrEqual(geometry.firstTop - 0.5);
    expect(geometry.buttonBottom).toBeLessThanOrEqual(
      geometry.firstBottom + 0.5,
    );
    expect(geometry.buttonScrollHeight).toBeLessThanOrEqual(
      geometry.buttonClientHeight,
    );
    for (const content of geometry.content) {
      expect(content.top).toBeGreaterThanOrEqual(geometry.firstTop - 0.5);
      expect(content.bottom).toBeLessThanOrEqual(geometry.firstBottom + 0.5);
    }
    expect(geometry.listScrollWidth).toBeLessThanOrEqual(
      geometry.listClientWidth,
    );
    expect(geometry.documentScrollWidthWithRow).toBeLessThanOrEqual(
      geometry.documentScrollWidthWithoutRow,
    );

    await secondButton.scrollIntoViewIfNeeded();
    await secondButton.click();
    await expect(secondButton).toHaveAttribute("aria-pressed", "true");
    await expect(firstButton).toHaveAttribute("aria-pressed", "false");
    await firstButton.focus();
    await firstButton.press("Enter");
    await expect(firstButton).toHaveAttribute("aria-pressed", "true");
    await secondButton.focus();
    await secondButton.press("Space");
    await expect(secondButton).toHaveAttribute("aria-pressed", "true");

    const results = await new AxeBuilder({ page })
      .include(FONT_LIST)
      .withRules(["label-content-name-mismatch"])
      .analyze();
    expect(results.violations.map(({ id }) => id)).toEqual([]);
  });

  test("primary catalog tasks reflow and remain reachable at 200% zoom", async ({
    page,
    mockGraphql,
  }) => {
    await page.setViewportSize({ width: 640, height: 900 });
    await mockGraphql();
    await page.goto("/");
    await waitForCatalog(page);
    await page.evaluate(() => {
      document.documentElement.style.setProperty("zoom", "2");
    });
    await expect
      .poll(() =>
        page.evaluate(
          () => getComputedStyle(document.documentElement).zoom,
        ),
      )
      .toBe("2");

    const expectReachable = async (name: string, control: Locator) => {
      await expect(control, `${name} is visible`).toBeVisible();
      await control.scrollIntoViewIfNeeded();
      const layout = await control.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const scrollingElement =
          document.scrollingElement ?? document.documentElement;
        return {
          bottom: rect.bottom,
          clientWidth: scrollingElement.clientWidth,
          innerHeight: window.innerHeight,
          left: rect.left,
          right: rect.right,
          scrollWidth: scrollingElement.scrollWidth,
          top: rect.top,
        };
      });

      expect(
        layout.scrollWidth,
        `${name} causes document-level horizontal scrolling`,
      ).toBeLessThanOrEqual(layout.clientWidth);
      expect(layout.left, `${name} starts outside the viewport`).toBeGreaterThanOrEqual(
        -0.5,
      );
      expect(layout.right, `${name} ends outside the viewport`).toBeLessThanOrEqual(
        layout.clientWidth + 0.5,
      );
      expect(layout.top, `${name} starts above the viewport`).toBeGreaterThanOrEqual(
        -0.5,
      );
      expect(layout.bottom, `${name} ends below the viewport`).toBeLessThanOrEqual(
        layout.innerHeight + 0.5,
      );
    };

    const filterBar = page.getByRole("search", {
      name: "Catalog filters",
    });
    const list = page.getByRole("list", { name: "Font families" });
    const primaryTasks: Array<[string, Locator]> = [
      [
        "search",
        page.getByRole("searchbox", { name: "Search fonts" }),
      ],
      ["format filter", page.getByRole("combobox", { name: "Format" })],
      ["owner filter", page.getByRole("textbox", { name: "Owner" })],
      [
        "minimum stars filter",
        page.getByRole("spinbutton", { name: "Minimum stars" }),
      ],
      ["sort", page.getByRole("combobox", { name: "Sort" })],
      [
        "webfont filter",
        page.getByRole("button", { name: "Filter webfonts" }),
      ],
      [
        "variable font filter",
        page.getByRole("button", { name: "Filter variable fonts" }),
      ],
      [
        "result mode",
        page.getByRole("button", { name: "Dense table mode" }),
      ],
      [
        "previous page",
        page.getByRole("button", { name: "Previous page" }),
      ],
      ["next page", page.getByRole("button", { name: "Next page" })],
      [
        "clear filters",
        filterBar.getByRole("button", { name: "Clear filters" }),
      ],
      [
        "specimen editor",
        page.getByRole("textbox", { name: "Editable specimen text" }),
      ],
      [
        "font selection",
        list
          .getByRole("listitem")
          .first()
          .getByRole("button", { name: /^Select / }),
      ],
    ];

    for (const [name, control] of primaryTasks) {
      await expectReachable(name, control);
    }
    await expectNoTargetOverlap(
      filterBar
        .getByRole("searchbox")
        .or(filterBar.getByRole("textbox"))
        .or(filterBar.getByRole("combobox"))
        .or(filterBar.getByRole("spinbutton"))
        .or(filterBar.getByRole("button")),
    );

    await page.getByRole("button", { name: "Next page" }).click();
    await expect(page.getByText("Page 2", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Previous page" }).click();
    await expect(page.getByText("Page 1", { exact: true })).toBeVisible();

    const search = page.getByRole("searchbox", { name: "Search fonts" });
    await search.fill("Inter");
    await expect(
      list
        .getByRole("listitem")
        .first()
        .getByRole("button", { name: /^Select / }),
    ).toBeVisible();
    await filterBar.getByRole("button", { name: "Clear filters" }).click();

    const firstResult = list
      .getByRole("listitem")
      .first()
      .getByRole("button", { name: /^Select / });
    await firstResult.click();
    await expect(firstResult).toHaveAttribute("aria-pressed", "true");

    const specimen = page.getByRole("textbox", {
      name: "Editable specimen text",
    });
    await specimen.fill("Reachable at 200% zoom");
    await expect(specimen).toHaveValue("Reachable at 200% zoom");

    const usePanel = page.getByRole("region", { name: /^Use / });
    const useActions = usePanel
      .getByRole("button")
      .or(usePanel.getByRole("link"));
    await expect(useActions).toHaveCount(7);
    await expectNoTargetOverlap(useActions);
    for (let index = 0; index < (await useActions.count()); index += 1) {
      const action = useActions.nth(index);
      await expectReachable(`use action ${index + 1}`, action);
      await action.focus();
      await expect(action).toBeFocused();
    }
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
    await expect(table.getByRole("rowheader")).toHaveCount(3);
    await expect(table.getByRole("row").nth(1).getByRole("rowheader")).toHaveCount(
      1,
    );
    await selectButtons.first().focus();
    await selectButtons.first().press("Enter");
    await expect(selectButtons.first()).toHaveAttribute("aria-pressed", "true");
    await expect(selectButtons.first().getByText("Selected")).toBeVisible();
    await expect(selectButtons.first()).toHaveAccessibleName(
      /^Select Selected: /,
    );
    await selectButtons.nth(1).focus();
    await selectButtons.nth(1).press("Space");
    await expect(selectButtons.nth(1)).toHaveAttribute("aria-pressed", "true");
    await expect(selectButtons.first()).toHaveAttribute("aria-pressed", "false");

    await table.locator("tbody tr").nth(2).getByRole("cell").last().click();
    await expect(selectButtons.nth(2)).toHaveAttribute("aria-pressed", "true");

    const results = await new AxeBuilder({ page })
      .include(DENSE_TABLE)
      .withRules([
        "aria-allowed-attr",
        "aria-allowed-role",
        "label-content-name-mismatch",
      ])
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
    await expect(status).toHaveText(
      "Updating results… Showing retained results.",
    );
    await expect(status).toHaveText("1 match");
    await expect(liveRegions).toHaveCount(1);
  });

  test("statistics failure is actionable and retries only statistics", async ({
    page,
    mockGraphql,
  }) => {
    let statsRequests = 0;
    let fontsRequests = 0;
    let releaseStatsRetry = () => {};
    const statsRetryGate = new Promise<void>((resolve) => {
      releaseStatsRetry = resolve;
    });

    await mockGraphql();
    await page.route("**/api/graphql**", async (route) => {
      const body = route.request().postDataJSON() as { query?: string };
      const query = body.query ?? "";

      if (/\bquery\s+Fonts\b/.test(query)) {
        fontsRequests += 1;
        await route.fallback();
        return;
      }

      if (!/\bquery\s+CatalogStats\b/.test(query)) {
        await route.fallback();
        return;
      }

      statsRequests += 1;
      if (statsRequests <= 2) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            errors: [{ message: "statistics fixture failure" }],
          }),
        });
        return;
      }

      if (statsRequests === 3) {
        await statsRetryGate;
      }
      await route.fallback();
    });
    await page.goto("/");
    await waitForCatalog(page);

    const stats = page.locator("[data-stats-strip]");
    const statsAlert = stats.getByRole("alert");
    await expect(statsAlert).toHaveCount(1);
    await expect(statsAlert).toContainText("Statistics unavailable.");
    await expect(
      page.getByText("Statistics unavailable.", { exact: true }),
    ).toHaveCount(1);
    await expect(
      stats.locator('[role="alert"], [role="status"], [aria-live]'),
    ).toHaveCount(1);

    const retry = statsAlert.getByRole("button", {
      name: "Retry statistics",
    });
    await expectMinimumTargetSize(retry);

    const search = page.getByRole("searchbox", {
      name: "Search fonts",
    });
    await search.fill("Inter");
    await expect(page.locator(RESULT_STATUS)).toHaveText("1 match");
    await expect(
      page.locator(`${FONT_ROW} [data-font-row-name]`).first(),
    ).toContainText("Inter");
    const fontsBeforeRetry = fontsRequests;

    await retry.click();
    try {
      await expect(statsAlert).toHaveCount(1, { timeout: 1_000 });
      await expect(retry).toBeDisabled();
    } finally {
      releaseStatsRetry();
    }
    await expect(statsAlert).toHaveCount(0);
    await expect(stats).toContainText("Fonts 6");
    await expect(stats).toContainText("Repos 120");
    await expect(stats).toContainText("Owners 42");
    await expect(stats).toContainText("Matched 1");
    expect(statsRequests).toBe(3);
    expect(fontsRequests).toBe(fontsBeforeRetry);
    await expect(
      stats.locator('[role="alert"], [role="status"], [aria-live]'),
    ).toHaveCount(0);
  });

  test("statistics recovery stays clear of catalog controls at 200% zoom", async ({
    page,
    mockGraphql,
  }) => {
    await page.setViewportSize({ width: 640, height: 900 });
    await mockGraphql();
    await page.route("**/api/graphql**", async (route) => {
      const body = route.request().postDataJSON() as { query?: string };
      if (!/\bquery\s+CatalogStats\b/.test(body.query ?? "")) {
        await route.fallback();
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          errors: [{ message: "statistics fixture failure" }],
        }),
      });
    });
    await page.goto("/");
    await waitForCatalog(page);
    await expect(page.locator(RESULT_STATUS)).toHaveText("6 matches");

    const statsAlert = page
      .locator("[data-stats-strip]")
      .getByRole("alert");
    const retry = statsAlert.getByRole("button", {
      name: "Retry statistics",
    });
    const filterBar = page.getByRole("search", {
      name: "Catalog filters",
    });
    await expect(statsAlert).toBeVisible();
    await expect(retry).toBeVisible();
    await expect(filterBar).toBeVisible();

    await page.evaluate(() => {
      document.documentElement.style.setProperty("zoom", "2");
    });
    await expect
      .poll(() =>
        page.evaluate(
          () => getComputedStyle(document.documentElement).zoom,
        ),
      )
      .toBe("2");

    const [alertBox, retryBox, filterBox] = await Promise.all([
      statsAlert.boundingBox(),
      retry.boundingBox(),
      filterBar.boundingBox(),
    ]);
    expect(alertBox).not.toBeNull();
    expect(retryBox).not.toBeNull();
    expect(filterBox).not.toBeNull();

    const viewport = await page.evaluate(() => {
      const scrollingElement =
        document.scrollingElement ?? document.documentElement;
      return {
        height: window.innerHeight,
        width: scrollingElement.clientWidth,
        scrollWidth: scrollingElement.scrollWidth,
      };
    });
    const alertBottom = alertBox!.y + alertBox!.height;
    const retryBottom = retryBox!.y + retryBox!.height;

    expect(
      alertBottom,
      "statistics alert overlaps the catalog filter bar",
    ).toBeLessThanOrEqual(filterBox!.y + 0.5);
    expect(
      retryBottom,
      "statistics retry overlaps the catalog filter bar",
    ).toBeLessThanOrEqual(filterBox!.y + 0.5);
    for (const [name, box] of [
      ["statistics alert", alertBox!],
      ["statistics retry", retryBox!],
      ["catalog filter bar", filterBox!],
    ] as const) {
      expect(box.x, `${name} starts outside the viewport`).toBeGreaterThanOrEqual(
        -0.5,
      );
      expect(
        box.x + box.width,
        `${name} ends outside the viewport`,
      ).toBeLessThanOrEqual(viewport.width + 0.5);
      expect(box.y, `${name} starts above the viewport`).toBeGreaterThanOrEqual(
        -0.5,
      );
    }
    expect(
      retryBottom,
      "statistics retry ends below the viewport",
    ).toBeLessThanOrEqual(viewport.height + 0.5);
    expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.width);
    await expectMinimumTargetSize(retry);
  });

  test("catalog errors suppress competing result announcements", async ({
    page,
    mockGraphql,
  }) => {
    await page.setViewportSize({ width: 320, height: 900 });
    await mockGraphql();
    await installFontRequestFailure(page, EXTREME_ERROR);
    await page.goto("/");

    const catalog = page.locator(CATALOG);
    const alert = catalog.getByRole("alert");
    await expect(alert).toBeVisible();
    await expect(alert).toContainText(
      "Unable to load the font catalog. Try again.",
    );
    await expect(alert).not.toContainText(EXTREME_ERROR);
    await expect(catalog.locator(RESULT_STATUS)).toHaveCount(0);
    await expect(catalog.locator("[data-filter-chip-strip]")).toHaveCount(0);
    await expectMinimumTargetSize(
      alert.getByRole("button", { name: "Retry" }),
    );
    const layout = await page.evaluate(() => {
      const scrollingElement =
        document.scrollingElement ?? document.documentElement;
      return {
        clientWidth: scrollingElement.clientWidth,
        scrollWidth: scrollingElement.scrollWidth,
      };
    });
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
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

  test("specimen recovery keeps its error visible until retry succeeds", async ({
    page,
    mockGraphql,
  }) => {
    await installRetryingFontFace(page);
    await mockGraphql();
    await page.goto("/?font=101");
    await waitForCatalog(page);

    const specimen = page.locator("[data-font-specimen]");
    const status = specimen.locator("[data-specimen-status]");
    await expect(status).toHaveCount(1);
    await expect(status).toHaveAttribute("role", "alert");
    await expect(specimen).toHaveAttribute("aria-busy", "false");
    await expect(status).toContainText("Specimen error:");

    await status.getByRole("button", { name: "Retry" }).click();

    await expect(specimen).toHaveAttribute("aria-busy", "true");
    await expect(status).toContainText("Specimen error:");
    await expect(status).toContainText("Retrying…");
    await expect(specimen.locator("[data-specimen-status]")).toHaveCount(1);
    await page.evaluate(() => {
      const harness = window as Window & {
        __resolveRetryingFontFace?: () => void;
      };
      harness.__resolveRetryingFontFace?.();
    });
    await expect(specimen).toHaveAttribute("aria-busy", "false");
    await expect(status).toHaveAttribute("role", "status");
    await expect(status).toHaveText("Specimen face ready.");
  });

  test("long selected file and repository metadata stay inside a 320px viewport", async ({
    page,
    mockGraphql,
  }) => {
    const longOwner = "OwnerName".repeat(80);
    await page.setViewportSize({ width: 320, height: 900 });
    await mockGraphql({
      fontNodes: [
        {
          ...MOCK_FONTS_PAGE1[0]!,
          familyGuess: null,
          fileName: EXTREME_FILENAME,
          fullName: EXTREME_REPOSITORY,
          ownerLogin: longOwner,
        },
      ],
    });
    await page.goto("/");
    await waitForCatalog(page);

    await page.locator(FONT_ROW).first().click();
    const usePanel = page.locator("[data-font-use-panel]");
    await expect(usePanel).toBeVisible();
    const expectedFallbackFamily = EXTREME_FILENAME
      .replace(/\.(ttf|otf|woff2?|ttc)$/i, "")
      .replace(/[-_]/g, " ")
      .trim();
    await expect(usePanel).toHaveAttribute(
      "aria-label",
      `Use ${expectedFallbackFamily}`,
    );
    await expect(
      usePanel.getByRole("link", {
        name: `Open ${EXTREME_REPOSITORY} on GitHub`,
      }),
    ).toBeVisible();
    const cssPreview = usePanel.getByRole("region", {
      name: "CSS snippet preview",
    });
    const expectedRepositoryComment = EXTREME_REPOSITORY.replaceAll(
      "*/",
      "*\\/",
    );
    await expect(cssPreview).toContainText(expectedRepositoryComment);
    const sourceComment = await cssPreview.evaluate((element) =>
      element.textContent
        ?.split("\n")
        .find((line) => line.trimStart().startsWith("* Source:")),
    );
    expect(sourceComment).toContain(expectedRepositoryComment);
    expect(sourceComment).not.toContain("*/");

    const layout = await page.evaluate(() => {
      const scrollingElement = document.scrollingElement;
      return {
        clientWidth:
          scrollingElement?.clientWidth ??
          document.documentElement.clientWidth,
        scrollWidth:
          scrollingElement?.scrollWidth ??
          document.documentElement.scrollWidth,
      };
    });
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
  });

  test("copy success and specimen recovery retain full-contrast controls", async ({
    page,
    mockGraphql,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async () => undefined,
        },
      });
    });
    await installFailingFontFace(page);
    await mockGraphql();
    await page.goto("/");
    await waitForCatalog(page);

    await page.locator(FONT_ROW).first().click();

    const retry = page
      .locator("[data-font-specimen]")
      .getByRole("button", { name: "Retry" });
    await retry.hover();
    await expect(retry).toHaveCSS("opacity", "1");
    await expect(retry).toHaveCSS("color", "rgb(255, 255, 255)");

    const copy = page.getByRole("button", {
      name: "Copy CSS @font-face",
    });
    await copy.click();
    await expect(copy).toHaveText("Copied ✓");
    await copy.hover();
    await expect(copy).toHaveCSS("opacity", "1");
    await expect(copy).toHaveCSS("color", "rgb(255, 255, 255)");
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
    await expect(boundary).toContainText(
      "Something went wrong rendering the font list.",
    );
    await expect(boundary).not.toContainText(/TypeError|toLocaleString/);
    await expectMinimumTargetSize(
      boundary.getByRole("button", { name: "Try again" }),
    );
  });

  test("catalog render recovery refetches current data", async ({
    page,
    mockGraphql,
  }) => {
    await mockGraphql();
    const requestCount = await installDenseRenderFailure(page, { once: true });
    await page.goto("/");
    await waitForCatalog(page);

    await page.getByRole("button", { name: "Dense table mode" }).click();
    const boundary = page.locator("[data-catalog-error-boundary]");
    await expect(boundary).toBeVisible();

    await boundary.getByRole("button", { name: "Try again" }).click();

    await expect.poll(requestCount).toBeGreaterThan(1);
    await expect(boundary).toHaveCount(0);
    await expect(page.locator(DENSE_TABLE)).toBeVisible();
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

  test("Tab follows the catalog task order with visible focus", async ({
    page,
    mockGraphql,
  }) => {
    await mockGraphql();
    await page.goto("/");
    await waitForCatalog(page);
    await page.evaluate(() => {
      (document.activeElement as HTMLElement | null)?.blur();
    });

    const focusOrder = [
      page.getByRole("searchbox", { name: "Search fonts" }),
      page.getByRole("combobox", { name: "Format" }),
      page.getByRole("textbox", { name: "Owner" }),
      page.getByRole("spinbutton", { name: "Minimum stars" }),
      page.getByRole("combobox", { name: "Sort" }),
      page.getByRole("button", { name: "Filter webfonts" }),
      page.getByRole("button", { name: "Filter variable fonts" }),
      page.getByRole("button", { name: "Dense table mode" }),
      page.getByRole("button", { name: "Next page" }),
      page.getByRole("button", { name: "Clear filters" }),
      page.getByRole("textbox", { name: "Editable specimen text" }),
      page.locator(FONT_ROW).first(),
    ];

    for (const control of focusOrder) {
      await page.keyboard.press("Tab");
      await expect(control).toBeFocused();
      const focus = await control.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          background: getComputedStyle(document.body).backgroundColor,
          focusVisible: element.matches(":focus-visible"),
          outlineColor: style.outlineColor,
          outlineStyle: style.outlineStyle,
          outlineWidth: Number.parseFloat(style.outlineWidth),
        };
      });
      expect(focus.focusVisible).toBe(true);
      expect(focus.outlineStyle).not.toBe("none");
      expect(focus.outlineWidth).toBeGreaterThan(0);
      expect(focus.outlineColor).not.toBe(focus.background);
    }
  });

  test("compact catalog actions have non-overlapping 24px targets", async ({
    page,
    mockGraphql,
  }) => {
    await page.setViewportSize({ width: 320, height: 900 });
    await mockGraphql();
    await page.goto("/");
    await waitForCatalog(page);

    const filterBar = page.getByRole("search", {
      name: "Catalog filters",
    });
    const filterActions = filterBar.locator("input, select, button");
    await expect(filterActions).toHaveCount(11);
    await expectMinimumTargetSize(filterActions);
    await expectNoTargetOverlap(filterActions);

    await page.getByRole("combobox", { name: "Format" }).selectOption("woff2");
    const chipActions = page
      .locator("[data-filter-chip-strip]")
      .getByRole("button");
    await expect(chipActions).toHaveCount(2);
    await expectMinimumTargetSize(chipActions);
    await expectNoTargetOverlap(chipActions);

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
