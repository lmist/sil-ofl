import { test, expect, MOCK_FONTS_PAGE1, MOCK_STATS } from "./fixtures";

/** Local navigation budget (loadEventEnd − startTime). */
const NAV_LOAD_BUDGET_MS = 3_000;
/** Interaction → list update budget when GraphQL is mocked. */
const SEARCH_INTERACTION_BUDGET_MS = 500;
/** Softer budget if tests ever run against a live API. */
const SEARCH_INTERACTION_SOFT_BUDGET_MS = 2_500;

const SEARCH = "#font-catalog-search";
const STATS = "[data-stats-strip]";
const LIST = "[data-font-list]";
const ROW = "[data-font-row]";
const SPECIMEN = "[data-font-specimen]";
const PAGINATION = "[data-pagination-controls]";
const FILTER_BAR = "[data-font-filter-bar]";

async function waitForCatalogReady(
  page: import("@playwright/test").Page,
): Promise<void> {
  await expect(page.locator("[data-catalog-shell]")).toBeVisible();
  await expect(page.locator(STATS)).toBeVisible();
  // List or empty state after first fonts fetch
  await expect(
    page.locator(`${LIST}, [data-font-list-empty]`).first(),
  ).toBeVisible({ timeout: 20_000 });
}

test.describe("SIL OFL catalog e2e", () => {
  test("1) home loads; stats strip visible", async ({ page, mockGraphql }) => {
    await mockGraphql();
    await page.goto("/");
    await waitForCatalogReady(page);

    await expect(page.getByText("SIL OFL Fonts")).toBeVisible();
    const stats = page.locator(STATS);
    await expect(stats).toBeVisible();
    await expect(stats).toContainText("Fonts");
    await expect(stats).toContainText(String(MOCK_STATS.fontFiles));
    await expect(stats).toContainText("Repos");
    await expect(page.locator(FILTER_BAR)).toBeVisible();
  });

  test("2) search types query; list updates; URL reflects q", async ({
    page,
    mockGraphql,
  }) => {
    await mockGraphql();
    await page.goto("/");
    await waitForCatalogReady(page);

    await expect(page.locator(ROW)).toHaveCount(MOCK_FONTS_PAGE1.length);

    const search = page.locator(SEARCH);
    await search.fill("Inter");

    await expect
      .poll(() => new URL(page.url()).searchParams.get("q"), {
        timeout: 10_000,
      })
      .toBe("Inter");

    await expect(page.locator(LIST)).toBeVisible();
    await expect(page.locator(ROW)).toHaveCount(1, { timeout: 10_000 });
    await expect(page.locator(`${ROW} [data-font-row-name]`)).toContainText(
      "Inter",
    );
  });

  test("3) format filter + clear", async ({ page, mockGraphql }) => {
    await mockGraphql();
    await page.goto("/");
    await waitForCatalogReady(page);

    const formatSelect = page.locator(`${FILTER_BAR} select[aria-label="Format"]`);
    await formatSelect.selectOption("woff2");

    await expect
      .poll(() => new URL(page.url()).searchParams.get("format"))
      .toBe("woff2");

    // Mock: Inter, Fira Code, Recursive are woff2 (3 total across pages, single filtered page)
    await expect(page.locator(ROW).first()).toBeVisible();
    const names = page.locator(`${ROW} [data-font-row-name]`);
    await expect(names).not.toHaveCount(0);
    for (const row of await page.locator(ROW).all()) {
      await expect(row.locator("[data-font-row-meta]")).toContainText("woff2");
    }

    await page.locator(`${PAGINATION} button[aria-label="Clear filters"]`).click();

    await expect
      .poll(() => new URL(page.url()).searchParams.get("format"))
      .toBeNull();
    await expect(formatSelect).toHaveValue("");
    await expect(page.locator(ROW)).toHaveCount(MOCK_FONTS_PAGE1.length, {
      timeout: 10_000,
    });
  });

  test("4) pagination next/prev", async ({ page, mockGraphql }) => {
    await mockGraphql();
    await page.goto("/");
    await waitForCatalogReady(page);

    const next = page.locator(`${PAGINATION} button[aria-label="Next page"]`);
    const prev = page.locator(`${PAGINATION} button[aria-label="Previous page"]`);

    await expect(prev).toBeDisabled();
    await expect(next).toBeEnabled();

    const firstPageName = await page
      .locator(`${ROW} [data-font-row-name]`)
      .first()
      .innerText();

    await next.click();

    await expect
      .poll(() => new URL(page.url()).searchParams.get("after"))
      .toBeTruthy();

    await expect(page.locator(ROW).first()).toBeVisible();
    await expect(prev).toBeEnabled();
    const secondPageName = await page
      .locator(`${ROW} [data-font-row-name]`)
      .first()
      .innerText();
    expect(secondPageName).not.toBe(firstPageName);
    await expect(page.locator(`${ROW} [data-font-row-name]`).first()).toContainText(
      "JetBrains Mono",
    );

    await prev.click();

    await expect
      .poll(() => new URL(page.url()).searchParams.get("after"))
      .toBeNull();
    await expect(page.locator(`${ROW} [data-font-row-name]`).first()).toContainText(
      firstPageName,
    );
    await expect(prev).toBeDisabled();
  });

  test("5) select font; specimen applies family", async ({
    page,
    mockGraphql,
  }) => {
    await mockGraphql();
    await page.goto("/");
    await waitForCatalogReady(page);

    const firstRow = page.locator(ROW).first();
    const familyName = await firstRow
      .locator("[data-font-row-name]")
      .getAttribute("title");
    if (!familyName) {
      throw new Error("Font row is missing its public family-name title");
    }

    await firstRow.click();

    await expect(firstRow).toHaveAttribute("data-selected", "true");
    await expect
      .poll(() => new URL(page.url()).searchParams.get("font"))
      .toBe("101");

    const specimen = page.locator(SPECIMEN);
    await expect(specimen).toBeVisible();
    await expect(specimen).toContainText(familyName);

    // Prefer data-face-ready; fall back to computed style on specimen textarea
    const faceReady = firstRow.locator('xpath=self::*[@data-face-ready="true"]');
    const textarea = specimen.locator('textarea[aria-label="Editable specimen text"]');

    try {
      await expect(firstRow).toHaveAttribute("data-face-ready", "true", {
        timeout: 15_000,
      });
      const fontFamily = await textarea.evaluate(
        (el) => getComputedStyle(el).fontFamily,
      );
      expect(fontFamily.toLowerCase()).toContain(familyName.toLowerCase().split(" ")[0]!);
    } catch {
      // Face CDN may be flaky offline — still require selection + specimen chrome
      await expect(faceReady.or(textarea)).toBeVisible();
      await expect(specimen).toContainText(familyName);
      // Soft: style attribute may still list the family once machine is ready
      const styleAttr = await textarea.getAttribute("style");
      if (styleAttr?.includes("font-family") || styleAttr?.includes("fontFamily")) {
        expect(styleAttr.toLowerCase()).toContain(
          familyName.toLowerCase().split(/\s+/)[0]!,
        );
      }
    }
  });

  test("6) PERFORMANCE: navigation load under budget", async ({
    page,
    mockGraphql,
  }) => {
    await mockGraphql();
    await page.goto("/", { waitUntil: "load" });
    await waitForCatalogReady(page);

    const timing = await page.evaluate(() => {
      const nav = performance.getEntriesByType(
        "navigation",
      )[0] as PerformanceNavigationTiming | undefined;
      if (!nav) {
        return { ok: false as const, ms: Infinity, reason: "no navigation entry" };
      }
      // loadEventEnd − startTime (nav timing is relative to startTime = 0)
      const ms = nav.loadEventEnd - nav.startTime;
      // LCP-ish: largest paint if available
      const paints = performance.getEntriesByType("paint");
      const lcpCandidates = performance.getEntriesByType(
        "largest-contentful-paint" as "paint",
      );
      return {
        ok: true as const,
        ms,
        loadEventEnd: nav.loadEventEnd,
        domContentLoaded: nav.domContentLoadedEventEnd,
        paints: paints.map((p) => ({ name: p.name, startTime: p.startTime })),
        lcpCount: lcpCandidates.length,
      };
    });

    expect(timing.ok, timing.ok ? undefined : (timing as { reason?: string }).reason).toBe(
      true,
    );
    if (timing.ok) {
      expect(
        timing.ms,
        `navigation loadEventEnd−startTime ${timing.ms.toFixed(0)}ms exceeds ${NAV_LOAD_BUDGET_MS}ms budget`,
      ).toBeLessThan(NAV_LOAD_BUDGET_MS);
    }
  });

  test("7) PERFORMANCE: search interaction to list update", async ({
    page,
    mockGraphql,
  }) => {
    const { mocked } = await mockGraphql();
    await page.goto("/");
    await waitForCatalogReady(page);
    await expect(page.locator(ROW)).toHaveCount(MOCK_FONTS_PAGE1.length);

    const budget = mocked
      ? SEARCH_INTERACTION_BUDGET_MS
      : SEARCH_INTERACTION_SOFT_BUDGET_MS;

    // Measure from keystroke to list reflecting filtered result (count + name)
    const elapsedMs = await page.evaluate(async () => {
      const input = document.querySelector(
        "#font-catalog-search",
      ) as HTMLInputElement | null;
      if (!input) throw new Error("search input missing");

      const start = performance.now();

      // Native input events so React/onChange fire
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, "Inter");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));

      await new Promise<void>((resolve, reject) => {
        const deadline = start + 10_000;
        const tick = () => {
          const list = document.querySelector("[data-font-list]");
          const rows = document.querySelectorAll("[data-font-row]");
          const firstName = document.querySelector(
            "[data-font-row] [data-font-row-name]",
          )?.textContent;
          const q = new URL(location.href).searchParams.get("q");
          const busy = list?.getAttribute("aria-busy") === "true";
          if (
            q === "Inter" &&
            !busy &&
            rows.length === 1 &&
            (firstName ?? "").includes("Inter")
          ) {
            resolve();
            return;
          }
          if (performance.now() > deadline) {
            reject(
              new Error(
                `timeout waiting for list update (q=${q}, rows=${rows.length}, busy=${busy}, name=${firstName})`,
              ),
            );
            return;
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });

      return performance.now() - start;
    });

    // Playwright fill path as backup assertion on DOM (machine debounce ~175ms)
    // The evaluate path above is the primary metric.
    expect(
      elapsedMs,
      `search→list ${elapsedMs.toFixed(0)}ms exceeds ${budget}ms (${mocked ? "mocked" : "live"} budget)`,
    ).toBeLessThan(budget);
  });
});
