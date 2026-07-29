import {
  test,
  expect,
  ALL_MOCK_FONTS,
  PAGE1_CURSOR,
} from "./fixtures";
import { encodeFontCursor } from "../src/graphql/schema/cursor";

const ROW = "[data-font-row]";
const OPAQUE_DEEP_CURSOR = encodeFontCursor({
  v: 2,
  rep: 100,
  stars: 6_000,
  family: "Before",
  id: 999,
});
const HISTORY_CURSOR = encodeFontCursor({
  v: 2,
  rep: 0,
  stars: 0,
  family: "Before",
  id: 1,
});

async function openCatalog(
  page: import("@playwright/test").Page,
  mockGraphql: () => Promise<{ mocked: boolean }>,
): Promise<void> {
  await mockGraphql();
  await page.goto("/");
  await expect(page.locator("[data-catalog-shell]")).toBeVisible();
  await expect(page.locator(ROW).first()).toBeVisible();
}

async function installInstantFontFace(
  page: import("@playwright/test").Page,
): Promise<void> {
  await page.addInitScript(() => {
    class InstantFontFace {
      family: string;

      constructor(family: string) {
        this.family = family;
      }

      load(): Promise<this> {
        return Promise.resolve(this);
      }
    }

    Object.defineProperty(window, "FontFace", {
      configurable: true,
      value: InstantFontFace,
    });
    Object.defineProperty(document.fonts, "add", {
      configurable: true,
      value: () => document.fonts,
    });
  });
}

type RecordedFontFace = {
  family: string;
  source: string;
  weight: string;
  style: string;
};

async function installRecordingFontFace(
  page: import("@playwright/test").Page,
  failures = 0,
  failureDelayMs = 0,
): Promise<void> {
  await page.addInitScript(({ initialFailures, delayMs }) => {
    let remainingFailures = initialFailures;
    const loads: Array<{
      family: string;
      source: string;
      weight: string;
      style: string;
    }> = [];

    Object.defineProperty(window, "__recordedFontFaces", {
      configurable: true,
      value: loads,
    });

    class RecordingFontFace {
      family: string;

      constructor(
        family: string,
        source: string,
        descriptors: FontFaceDescriptors = {},
      ) {
        this.family = family;
        loads.push({
          family,
          source,
          weight: descriptors.weight ?? "normal",
          style: descriptors.style ?? "normal",
        });
      }

      load(): Promise<this> {
        if (remainingFailures > 0) {
          remainingFailures -= 1;
          if (delayMs > 0) {
            return new Promise<this>((_resolve, reject) => {
              window.setTimeout(
                () => reject(new Error("Synthetic face failure")),
                delayMs,
              );
            });
          }
          return Promise.reject(new Error("Synthetic face failure"));
        }
        return Promise.resolve(this);
      }
    }

    Object.defineProperty(window, "FontFace", {
      configurable: true,
      value: RecordingFontFace,
    });
    Object.defineProperty(document.fonts, "add", {
      configurable: true,
      value: () => document.fonts,
    });
    Object.defineProperty(document.fonts, "delete", {
      configurable: true,
      value: () => true,
    });
  }, { initialFailures: failures, delayMs: failureDelayMs });
}

async function recordedFontFaces(
  page: import("@playwright/test").Page,
): Promise<RecordedFontFace[]> {
  return page.evaluate(
    () =>
      (
        window as typeof window & {
          __recordedFontFaces?: RecordedFontFace[];
        }
      ).__recordedFontFaces ?? [],
  );
}

async function installReplacementFailure(
  page: import("@playwright/test").Page,
  mode: "http" | "graphql" | "json",
): Promise<() => void> {
  let shouldFail = true;

  await page.route("**/api/graphql**", async (route) => {
    const body = route.request().postDataJSON() as {
      query?: string;
      variables?: { filter?: { owner?: string | null } | null };
    };
    const isTarget =
      /\bquery\s+Fonts\b/.test(body.query ?? "") &&
      body.variables?.filter?.owner === "rsms";

    if (!isTarget || !shouldFail) {
      await route.fallback();
      return;
    }

    if (mode === "http") {
      await route.fulfill({
        status: 503,
        contentType: "text/plain",
        body: "query Fonts($filter: FontFilter) variables={catalog-secret}",
      });
      return;
    }
    if (mode === "graphql") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          errors: [
            {
              message:
                "query Fonts($filter: FontFilter) variables={catalog-secret}",
            },
          ],
        }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: '{"data":',
    });
  });

  return () => {
    shouldFail = false;
  };
}

async function installInvalidCursorFailure(
  page: import("@playwright/test").Page,
): Promise<void> {
  await page.route("**/api/graphql**", async (route) => {
    const body = route.request().postDataJSON() as {
      query?: string;
      variables?: { after?: string | null };
    };
    if (
      /\bquery\s+Fonts\b/.test(body.query ?? "") &&
      body.variables?.after === "not-a-cursor"
    ) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          errors: [
            {
              message:
                "Invalid cursor in query Fonts($after: String) variables={not-a-cursor}",
            },
          ],
        }),
      });
      return;
    }
    await route.fallback();
  });
}

test.describe("catalog state invariants", () => {
  test("rejects ambiguous or out-of-range minimum stars before activation", async ({
    page,
    mockGraphql,
  }) => {
    await openCatalog(page, mockGraphql);

    const minStars = page.getByLabel("Minimum stars");
    for (const invalid of ["1.5", "1e3", "2147483648"]) {
      await minStars.fill(invalid);
      await expect(minStars).toHaveValue("");
      await expect(
        page.getByRole("button", { name: /Remove filter ★/ }),
      ).toHaveCount(0);
    }

    await minStars.fill("1500");
    await expect(minStars).toHaveValue("1500");
    await expect(
      page.getByRole("button", { name: "Remove filter ★ ≥ 1500" }),
    ).toBeVisible();
  });

  test("applies rapid Webfont and Variable toggles from current state", async ({
    page,
    mockGraphql,
  }) => {
    await openCatalog(page, mockGraphql);

    for (const label of ["Filter webfonts", "Filter variable fonts"]) {
      const toggle = page.getByRole("button", { name: label });
      await toggle.evaluate((button) => {
        (button as HTMLButtonElement).click();
        (button as HTMLButtonElement).click();
      });

      await expect(toggle).toHaveAttribute("aria-pressed", "false");
    }

    await expect(
      page.getByRole("button", { name: "Remove filter Webfont" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Remove filter Variable" }),
    ).toHaveCount(0);
  });

  test("Clear atomically resets selection, URL, specimen, and use panel", async ({
    page,
    mockGraphql,
  }) => {
    await openCatalog(page, mockGraphql);

    const row = page.locator(ROW).first();
    await row.click();
    await expect(row).toHaveAttribute("data-selected", "true");
    await expect(page.locator("[data-font-use-panel]")).toBeVisible();
    await expect
      .poll(() => new URL(page.url()).searchParams.get("font"))
      .toBe("101");

    await page.getByRole("button", { name: "Clear filters" }).click();

    await expect
      .poll(() => new URL(page.url()).searchParams.get("font"))
      .toBeNull();
    await expect(row).toHaveAttribute("data-selected", "false");
    await expect(page.locator("[data-font-use-panel]")).toHaveCount(0);
    await expect(page.locator("[data-font-specimen]")).toContainText(
      "Select a face",
    );
  });

  test("never exposes selected surfaces before their URL identity", async ({
    page,
    mockGraphql,
  }) => {
    await installInstantFontFace(page);
    await openCatalog(page, mockGraphql);

    const observedMismatch = await page.evaluate(async () => {
      let mismatch = false;
      const checkIdentity = () => {
        const hasSelectedSurface = Boolean(
          document.querySelector('[data-font-row][data-selected="true"]') ||
            document.querySelector("[data-font-use-panel]"),
        );
        const selectedFont = new URL(window.location.href).searchParams.get(
          "font",
        );
        if (hasSelectedSurface && selectedFont !== "101") {
          mismatch = true;
        }
      };
      const observer = new MutationObserver(checkIdentity);
      observer.observe(document.body, {
        attributes: true,
        childList: true,
        subtree: true,
      });

      document.querySelector<HTMLElement>("[data-font-row]")?.click();
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });

      checkIdentity();
      observer.disconnect();
      return mismatch;
    });

    expect(observedMismatch).toBe(false);
    await expect
      .poll(() => new URL(page.url()).searchParams.get("font"))
      .toBe("101");
    await expect(page.locator("[data-font-use-panel]")).toContainText("Inter");
  });

  test("locks pagination and consumes a delayed forward cursor once", async ({
    page,
    mockGraphql,
  }) => {
    await mockGraphql({ fontsDelayMs: 500 });
    await page.goto("/");
    await expect(page.locator(ROW).first()).toBeVisible();

    const next = page.getByRole("button", { name: "Next page" });
    await next.evaluate((button) => {
      (button as HTMLButtonElement).click();
      (button as HTMLButtonElement).click();
    });

    await page.waitForTimeout(50);
    expect(await next.isDisabled()).toBe(true);

    await expect(page.getByText("Page 2", { exact: true })).toBeVisible();
    await expect(page.getByText("Page 3", { exact: true })).toHaveCount(0);
    await expect(page.locator(`${ROW} [data-font-row-name]`).first()).toContainText(
      "JetBrains Mono",
    );
  });

  test("disables pagination throughout debounced and unresolved search criteria", async ({
    page,
    mockGraphql,
  }) => {
    await mockGraphql({ fontsDelayMs: 450 });
    await page.goto("/");
    await expect(page.locator(ROW).first()).toBeVisible();

    const shell = page.locator("[data-catalog-shell]");
    const search = page.getByRole("searchbox", { name: "Search fonts" });
    const previous = page.getByRole("button", { name: "Previous page" });
    const next = page.getByRole("button", { name: "Next page" });

    await expect(next).toBeEnabled();
    await search.fill("Inter");
    expect(await shell.getAttribute("data-catalog-state")).toBe(
      "debouncing_q",
    );
    expect(await previous.isDisabled()).toBe(true);
    expect(await next.isDisabled()).toBe(true);
    await page.waitForTimeout(100);
    expect(await previous.isDisabled()).toBe(true);
    expect(await next.isDisabled()).toBe(true);
    await expect(
      page.locator(`${ROW} [data-font-row-name]`).first(),
    ).toContainText("Inter");

    await search.fill("");
    expect(await previous.isDisabled()).toBe(true);
    expect(await next.isDisabled()).toBe(true);
    await expect(next).toBeEnabled();

    await next.click();
    await expect(
      page.locator(`${ROW} [data-font-row-name]`).first(),
    ).toContainText("JetBrains Mono");
    await expect(previous).toBeEnabled();

    await search.fill("Source");
    expect(await shell.getAttribute("data-catalog-state")).toBe(
      "debouncing_q",
    );
    expect(await previous.isDisabled()).toBe(true);
    expect(await next.isDisabled()).toBe(true);
    await page.waitForTimeout(250);
    expect(await previous.isDisabled()).toBe(true);
    expect(await next.isDisabled()).toBe(true);
    await expect(
      page.locator(`${ROW} [data-font-row-name]`).first(),
    ).toContainText("Source Sans 3");
  });

  test("hover cannot replace the selected specimen and use-panel identity", async ({
    page,
    mockGraphql,
  }) => {
    await installInstantFontFace(page);
    await openCatalog(page, mockGraphql);

    const selected = page.locator(ROW).nth(0);
    const preview = page.locator(ROW).nth(1);
    const specimenText = page.getByLabel("Editable specimen text");

    await selected.click();
    await expect(specimenText).toHaveAttribute("style", /Inter/);
    await expect(page.locator("[data-font-use-panel]")).toContainText("Inter");

    await preview.hover();
    await page.waitForTimeout(50);

    await expect(selected).toHaveAttribute("data-selected", "true");
    await expect(preview).toHaveAttribute("data-selected", "false");
    await expect(specimenText).toHaveAttribute("style", /Inter/);
    await expect(page.locator("[data-font-use-panel]")).toContainText("Inter");
    expect(new URL(page.url()).searchParams.get("font")).toBe("101");
  });

  test("paging away preserves selected detail across URL, specimen, and use panel", async ({
    page,
    mockGraphql,
  }) => {
    await installInstantFontFace(page);
    await openCatalog(page, mockGraphql);

    await page.locator(ROW).first().click();
    await expect(page.locator("[data-font-use-panel]")).toContainText("Inter");

    await page.getByRole("button", { name: "Next page" }).click();
    await expect(page.locator(`${ROW} [data-font-row-name]`).first()).toContainText(
      "JetBrains Mono",
    );

    expect(new URL(page.url()).searchParams.get("font")).toBe("101");
    await expect(page.locator("[data-font-specimen]")).toContainText("Inter");
    await expect(page.locator("[data-font-use-panel]")).toContainText("Inter");
  });

  test("same-id metadata refresh reloads one coherent specimen and export identity", async ({
    page,
    mockGraphql,
  }) => {
    const revisionB = {
      ...ALL_MOCK_FONTS[0],
      cdnUrl:
        "https://cdn.jsdelivr.net/gh/rsms/inter@revision-b/docs/font-files/Inter-BoldItalic.woff2",
      rawUrl:
        "https://raw.githubusercontent.com/rsms/inter/revision-b/docs/font-files/Inter-BoldItalic.woff2",
      familyGuess: "Inter Revision B",
      fileName: "Inter-BoldItalic.woff2",
      path: "docs/font-files/Inter-BoldItalic.woff2",
      weightGuess: 700,
      styleGuess: "italic",
    };

    await installRecordingFontFace(page);
    await mockGraphql();
    await page.route("**/api/graphql**", async (route) => {
      const body = route.request().postDataJSON() as {
        query?: string;
        variables?: { filter?: { owner?: string | null } | null };
      };
      const isRevisionRequest =
        /\bquery\s+Fonts\b/.test(body.query ?? "") &&
        body.variables?.filter?.owner === "rsms";
      if (!isRevisionRequest) {
        await route.fallback();
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            fonts: {
              totalCount: 1,
              pageInfo: {
                hasNextPage: false,
                endCursor: "revision-b",
              },
              edges: [{ cursor: "revision-b", node: revisionB }],
            },
          },
        }),
      });
    });
    await page.goto("/");
    await expect(page.locator(ROW).first()).toBeVisible();

    await page.locator(ROW).first().evaluate((row) => {
      (row as HTMLButtonElement).click();
    });
    await expect
      .poll(async () => (await recordedFontFaces(page)).length)
      .toBe(1);
    expect((await recordedFontFaces(page))[0]).toMatchObject({
      family: "Inter",
      weight: "400",
      style: "normal",
    });

    await page.getByRole("textbox", { name: "Owner" }).fill("rsms");
    await expect(
      page.locator(`${ROW} [data-font-row-name]`).first(),
    ).toContainText("Inter Revision B");
    await expect(page.locator("[data-font-use-panel]")).toContainText(
      "Inter Revision B",
    );
    await expect
      .poll(async () => (await recordedFontFaces(page)).length)
      .toBe(2);

    expect((await recordedFontFaces(page))[1]).toMatchObject({
      family: "Inter Revision B",
      weight: "700",
      style: "italic",
    });
    expect((await recordedFontFaces(page))[1]?.source).toContain(
      "Inter-BoldItalic.woff2",
    );
    await expect
      .poll(() =>
        page.getByLabel("Editable specimen text").evaluate((textarea) => ({
          family: (textarea as HTMLTextAreaElement).style.fontFamily,
          weight: (textarea as HTMLTextAreaElement).style.fontWeight,
          style: (textarea as HTMLTextAreaElement).style.fontStyle,
        })),
      )
      .toEqual({
        family: '"Inter Revision B", sans-serif',
        weight: "700",
        style: "italic",
      });

    const snippet = page.getByRole("region", {
      name: "CSS snippet preview",
    });
    await expect(snippet).toContainText("Inter Revision B");
    await expect(snippet).toContainText("Inter-BoldItalic.woff2");
    await expect(snippet).toContainText("font-weight: 700");
    await expect(snippet).toContainText("font-style: italic");
  });

  test("an inactive cached draft cannot roll back the selected face during debounce", async ({
    page,
    mockGraphql,
  }) => {
    const cachedRevision = {
      ...ALL_MOCK_FONTS[0],
      cdnUrl:
        "https://cdn.jsdelivr.net/gh/rsms/inter@cached/docs/font-files/Inter-Cached.woff2",
      rawUrl:
        "https://raw.githubusercontent.com/rsms/inter/cached/docs/font-files/Inter-Cached.woff2",
      familyGuess: "Inter Cached",
      fileName: "Inter-Cached.woff2",
      path: "docs/font-files/Inter-Cached.woff2",
      weightGuess: 500,
    };
    const activeRevision = {
      ...ALL_MOCK_FONTS[0],
      cdnUrl:
        "https://cdn.jsdelivr.net/gh/rsms/inter@active/docs/font-files/Inter-Active.woff2",
      rawUrl:
        "https://raw.githubusercontent.com/rsms/inter/active/docs/font-files/Inter-Active.woff2",
      familyGuess: "Inter Active",
      fileName: "Inter-Active.woff2",
      path: "docs/font-files/Inter-Active.woff2",
      weightGuess: 650,
    };

    await installRecordingFontFace(page);
    await mockGraphql();
    await page.route("**/api/graphql**", async (route) => {
      const body = route.request().postDataJSON() as {
        query?: string;
        variables?: { filter?: { q?: string | null } | null };
      };
      const q = body.variables?.filter?.q;
      const revision =
        q === "Cached"
          ? cachedRevision
          : q === "Active"
            ? activeRevision
            : null;
      if (!/\bquery\s+Fonts\b/.test(body.query ?? "") || !revision) {
        await route.fallback();
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            fonts: {
              totalCount: 1,
              pageInfo: {
                hasNextPage: false,
                endCursor: `revision-${q?.toLowerCase()}`,
              },
              edges: [
                {
                  cursor: `revision-${q?.toLowerCase()}`,
                  node: revision,
                },
              ],
            },
          },
        }),
      });
    });
    await page.goto("/");
    await expect(page.locator(ROW).first()).toBeVisible();
    await page.locator(ROW).first().evaluate((row) => {
      (row as HTMLButtonElement).click();
    });
    await expect
      .poll(async () => (await recordedFontFaces(page)).length)
      .toBe(1);

    const search = page.getByRole("searchbox", {
      name: "Search fonts",
    });
    await search.fill("Cached");
    await expect(
      page.locator(`${ROW} [data-font-row-name]`).first(),
    ).toContainText("Inter Cached");
    await expect
      .poll(async () => (await recordedFontFaces(page)).length)
      .toBe(2);

    await search.fill("Active");
    await expect(
      page.locator(`${ROW} [data-font-row-name]`).first(),
    ).toContainText("Inter Active");
    await expect
      .poll(async () => (await recordedFontFaces(page)).length)
      .toBe(3);

    await search.fill("Cached");
    await page.waitForTimeout(50);
    const duringDebounce = await page.evaluate(() => {
      const textarea = document.querySelector<HTMLTextAreaElement>(
        '[aria-label="Editable specimen text"]',
      );
      return {
        catalogState: document
          .querySelector("[data-catalog-shell]")
          ?.getAttribute("data-catalog-state"),
        row: document.querySelector("[data-font-row-name]")?.textContent,
        usePanel: document.querySelector("[data-font-use-panel]")
          ?.textContent,
        snippet: document.querySelector(
          '[data-font-use-panel] [aria-label="CSS snippet preview"]',
        )?.textContent,
        specimenFamily: textarea?.style.fontFamily,
        specimenWeight: textarea?.style.fontWeight,
        specimenStyle: textarea?.style.fontStyle,
        faceCount:
          (
            window as typeof window & {
              __recordedFontFaces?: RecordedFontFace[];
            }
          ).__recordedFontFaces?.length ?? 0,
      };
    });
    expect(duringDebounce.catalogState).toBe("debouncing_q");
    expect(duringDebounce.row).toContain("Inter Active");
    expect(duringDebounce.usePanel).toContain("Inter Active");
    expect(duringDebounce.snippet).toContain("Inter-Active.woff2");
    expect(duringDebounce.snippet).toContain("font-weight: 650");
    expect(duringDebounce.specimenFamily).toBe(
      '"Inter Active", sans-serif',
    );
    expect(duringDebounce.specimenWeight).toBe("650");
    expect(duringDebounce.specimenStyle).toBe("normal");
    expect(duringDebounce.faceCount).toBe(3);

    await expect(
      page.locator("[data-catalog-shell]"),
    ).toHaveAttribute("data-catalog-state", "ready");
    await expect
      .poll(async () => (await recordedFontFaces(page)).length)
      .toBe(4);
    expect((await recordedFontFaces(page))[3]).toMatchObject({
      family: "Inter Cached",
      weight: "500",
    });
    await expect(
      page.locator(`${ROW} [data-font-row-name]`).first(),
    ).toContainText("Inter Cached");
    await expect(page.locator("[data-font-use-panel]")).toContainText(
      "Inter Cached",
    );
    const cachedSnippet = page.getByRole("region", {
      name: "CSS snippet preview",
    });
    await expect(cachedSnippet).toContainText("Inter-Cached.woff2");
    await expect(cachedSnippet).toContainText("font-weight: 500");
    await expect
      .poll(() =>
        page.getByLabel("Editable specimen text").evaluate((textarea) => ({
          family: (textarea as HTMLTextAreaElement).style.fontFamily,
          weight: (textarea as HTMLTextAreaElement).style.fontWeight,
          style: (textarea as HTMLTextAreaElement).style.fontStyle,
        })),
      )
      .toEqual({
        family: '"Inter Cached", sans-serif',
        weight: "500",
        style: "normal",
      });
  });

  test("a cached failed draft stays silent until its search becomes active", async ({
    page,
    mockGraphql,
  }) => {
    await mockGraphql();
    await page.route("**/api/graphql**", async (route) => {
      const body = route.request().postDataJSON() as {
        query?: string;
        variables?: { filter?: { q?: string | null } | null };
      };
      const isFailedSearch =
        /\bquery\s+Fonts\b/.test(body.query ?? "") &&
        body.variables?.filter?.q === "Failed";
      if (!isFailedSearch) {
        await route.fallback();
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          errors: [{ message: "cached failed search fixture" }],
        }),
      });
    });
    await page.goto("/");
    await expect(page.locator(ROW).first()).toBeVisible();

    const shell = page.locator("[data-catalog-shell]");
    const search = page.getByRole("searchbox", {
      name: "Search fonts",
    });
    const alert = page.locator("[data-catalog-error]");

    await search.fill("Failed");
    await expect(alert).toContainText(
      "Unable to load the font catalog. Try again.",
    );

    await search.fill("Inter");
    await expect(
      page.locator(`${ROW} [data-font-row-name]`).first(),
    ).toContainText("Inter");
    await expect(alert).toHaveCount(0);
    await expect(shell).toHaveAttribute("data-catalog-state", "ready");

    await search.fill("Failed");
    await page.waitForTimeout(50);
    const draft = await page.evaluate(() => ({
      catalogState: document
        .querySelector("[data-catalog-shell]")
        ?.getAttribute("data-catalog-state"),
      hasCatalogError: Boolean(
        document.querySelector("[data-catalog-error]"),
      ),
    }));
    expect(draft.catalogState).toBe("debouncing_q");
    expect(draft.hasCatalogError).toBe(false);

    await expect(shell).toHaveAttribute("data-catalog-state", "ready");
    await expect(alert).toContainText(
      "Unable to load the font catalog. Try again.",
    );
  });

  test("pointer hover, focus, and selection load one identical face", async ({
    page,
    mockGraphql,
  }) => {
    await installRecordingFontFace(page);
    await openCatalog(page, mockGraphql);

    const row = page.locator(ROW).first();
    await row.click();
    await expect(row).toHaveAttribute("data-selected", "true");
    await expect(page.locator("[data-font-use-panel]")).toContainText(
      "Inter",
    );
    await page.waitForTimeout(50);

    expect(await recordedFontFaces(page)).toHaveLength(1);
    expect((await recordedFontFaces(page))[0]).toMatchObject({
      family: "Inter",
      weight: "400",
      style: "normal",
    });
  });

  test("identical-load deduplication preserves same-row error recovery", async ({
    page,
    mockGraphql,
  }) => {
    // One specimen LOAD tries the approved CDN and raw fallback.
    await installRecordingFontFace(page, 2, 25);
    await openCatalog(page, mockGraphql);

    const row = page.locator(ROW).first();
    await row.click();
    await expect(page.locator("[data-specimen-status]")).toContainText(
      "Specimen error: Font face is unavailable.",
    );
    expect(await recordedFontFaces(page)).toHaveLength(2);

    await row.click();
    await expect(page.locator("[data-specimen-status]")).toContainText(
      "Specimen face ready.",
    );
    expect(await recordedFontFaces(page)).toHaveLength(3);
    await expect(row).toHaveAttribute("data-selected", "true");
    await expect(page.locator("[data-font-use-panel]")).toContainText(
      "Inter",
    );
  });

  test("invalid row ids cannot select, cache, or load a specimen face", async ({
    page,
    mockGraphql,
  }) => {
    const invalidFont = {
      ...ALL_MOCK_FONTS[0],
      id: "-7",
      fontFileId: -7,
    };

    await installRecordingFontFace(page);
    await mockGraphql();
    await page.route("**/api/graphql**", async (route) => {
      const body = route.request().postDataJSON() as { query?: string };
      if (!/\bquery\s+Fonts\b/.test(body.query ?? "")) {
        await route.fallback();
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            fonts: {
              totalCount: 1,
              pageInfo: {
                hasNextPage: false,
                endCursor: "invalid-node",
              },
              edges: [{ cursor: "invalid-node", node: invalidFont }],
            },
          },
        }),
      });
    });
    await page.goto("/");
    const row = page.locator(ROW).first();
    await expect(row).toBeVisible();

    await row.hover();
    await row.focus();
    await row.evaluate((button) => {
      (button as HTMLButtonElement).click();
    });
    await page.waitForTimeout(50);

    expect(await recordedFontFaces(page)).toEqual([]);
    expect(new URL(page.url()).searchParams.get("font")).toBeNull();
    await expect(row).toHaveAttribute("data-selected", "false");
    await expect(page.locator("[data-font-use-panel]")).toHaveCount(0);
    await expect(page.locator("[data-font-specimen]")).toContainText(
      "Select a face",
    );
  });

  test("a direct off-page font link hydrates coherent selected detail", async ({
    page,
    mockGraphql,
  }) => {
    await installInstantFontFace(page);
    await mockGraphql();
    await page.goto("/?font=201");
    await expect(page.locator(ROW).first()).toBeVisible();

    await expect(page.locator("[data-font-specimen]")).toContainText(
      "JetBrains Mono",
    );
    await expect(page.locator("[data-font-use-panel]")).toContainText(
      "JetBrains Mono",
    );
    expect(new URL(page.url()).searchParams.get("font")).toBe("201");
  });

  test("an unresolved font deep link removes only the invalid identity", async ({
    page,
    mockGraphql,
  }) => {
    await installInstantFontFace(page);
    await mockGraphql();
    await page.goto("/?q=Inter&font=999");
    await expect(page.locator(ROW).first()).toBeVisible();

    await expect
      .poll(() => new URL(page.url()).searchParams.get("font"))
      .toBeNull();
    await expect
      .poll(() => new URL(page.url()).searchParams.get("q"))
      .toBe("Inter");
    await expect(page.getByLabel("Search fonts")).toHaveValue("Inter");
    await expect(page.locator(`${ROW}[data-selected="true"]`)).toHaveCount(0);
    await expect(page.locator("[data-font-use-panel]")).toHaveCount(0);
    await expect(page.locator("[data-font-specimen]")).toContainText(
      "Font not found",
    );
  });

  test("a direct opaque cursor exposes unknown position without fabricated history", async ({
    page,
    mockGraphql,
  }) => {
    const opaqueCursor = OPAQUE_DEEP_CURSOR;
    await mockGraphql();
    await page.goto(`/?after=${encodeURIComponent(opaqueCursor)}`);
    await expect(page.locator(`${ROW} [data-font-row-name]`).first()).toContainText(
      "Inter",
    );

    await expect(page.getByText("Page unknown", { exact: true })).toBeVisible();
    const previous = page.getByRole("button", { name: "Previous page" });
    const listItems = page
      .getByRole("list", { name: "Font families" })
      .getByRole("listitem");
    await expect(previous).toBeDisabled();
    await expect(listItems.first()).not.toHaveAttribute(
      "aria-posinset",
      /\d+/,
    );
    await expect(listItems.first()).not.toHaveAttribute(
      "aria-setsize",
      /\d+/,
    );

    await page.getByRole("button", { name: "Next page" }).click();
    await expect(page.locator(`${ROW} [data-font-row-name]`).first()).toContainText(
      "JetBrains Mono",
    );
    await expect(page.getByText("Page unknown", { exact: true })).toBeVisible();
    await expect(previous).toBeEnabled();
    await expect(listItems.first()).not.toHaveAttribute(
      "aria-posinset",
      /\d+/,
    );
    await expect(listItems.first()).not.toHaveAttribute(
      "aria-setsize",
      /\d+/,
    );
    expect(new URL(page.url()).searchParams.get("after")).toBe(PAGE1_CURSOR);

    await previous.click();
    await expect(page.locator(`${ROW} [data-font-row-name]`).first()).toContainText(
      "Inter",
    );
    await expect(page.getByText("Page unknown", { exact: true })).toBeVisible();
    await expect(previous).toBeDisabled();
    await expect(listItems.first()).not.toHaveAttribute(
      "aria-posinset",
      /\d+/,
    );
    await expect(listItems.first()).not.toHaveAttribute(
      "aria-setsize",
      /\d+/,
    );
    expect(new URL(page.url()).searchParams.get("after")).toBe(opaqueCursor);
  });

  test("Back and Forward hydrate URL state without resetting session state", async ({
    page,
    mockGraphql,
  }) => {
    await installInstantFontFace(page);
    await openCatalog(page, mockGraphql);

    const denseMode = page.getByRole("button", {
      name: "Dense table mode",
    });
    const specimenText = page.getByLabel("Editable specimen text");
    await denseMode.click();
    await specimenText.fill("History keeps this specimen");

    const fullState = new URLSearchParams({
      q: "JetBrains",
      format: "ttf",
      owner: "JetBrains",
      after: HISTORY_CURSOR,
      sort: "STARS_ASC",
      font: "201",
    });
    await page.evaluate((query) => {
      window.history.pushState(null, "", `/?${query}`);
    }, fullState.toString());

    await page.goBack();
    await expect
      .poll(() => new URL(page.url()).searchParams.toString())
      .toBe("");

    await page.goForward();

    await expect(page.getByLabel("Search fonts")).toHaveValue("JetBrains");
    await expect(page.getByLabel("Format", { exact: true })).toHaveValue(
      "ttf",
    );
    await expect(page.getByLabel("Owner", { exact: true })).toHaveValue(
      "JetBrains",
    );
    await expect(page.getByLabel("Sort")).toHaveValue("STARS_ASC");
    await expect(page.getByText("Page unknown", { exact: true })).toBeVisible();
    await expect(
      page.locator(
        '[data-dense-font-table] button[data-selected="true"]',
      ),
    ).toContainText("JetBrains Mono");
    await expect(page.locator("[data-font-specimen]")).toContainText(
      "JetBrains Mono",
    );
    await expect(page.locator("[data-font-use-panel]")).toContainText(
      "JetBrains Mono",
    );
    await expect(denseMode).toHaveAttribute("aria-pressed", "true");
    await expect(specimenText).toHaveValue("History keeps this specimen");
    await expect
      .poll(() => new URL(page.url()).searchParams.toString())
      .toBe(fullState.toString());

    await page.goBack();

    await expect(page.getByLabel("Search fonts")).toHaveValue("");
    await expect(page.getByLabel("Format", { exact: true })).toHaveValue("");
    await expect(page.getByLabel("Owner", { exact: true })).toHaveValue("");
    await expect(page.getByLabel("Sort")).toHaveValue("REPUTATION_DESC");
    await expect(page.getByText("Page 1", { exact: true })).toBeVisible();
    await expect(
      page.locator(
        '[data-dense-font-table] button[data-selected="true"]',
      ),
    ).toHaveCount(0);
    await expect(page.locator("[data-font-specimen]")).toContainText(
      "Select a face",
    );
    await expect(page.locator("[data-font-use-panel]")).toHaveCount(0);
    await expect(denseMode).toHaveAttribute("aria-pressed", "true");
    await expect(specimenText).toHaveValue("History keeps this specimen");
    await expect
      .poll(() => new URL(page.url()).searchParams.toString())
      .toBe("");
  });

  test("Space activates the focused virtualized row coherently", async ({
    page,
    mockGraphql,
  }) => {
    await installInstantFontFace(page);
    await openCatalog(page, mockGraphql);

    const row = page.locator(ROW).nth(1);
    await row.focus();
    await expect(row).toBeFocused();
    await page.keyboard.press("Space");

    await expect(row).toHaveAttribute("data-selected", "true");
    await expect
      .poll(() => new URL(page.url()).searchParams.get("font"))
      .toBe("102");
    await expect(page.locator("[data-font-specimen]")).toContainText(
      "Source Sans 3",
    );
    await expect(page.locator("[data-font-use-panel]")).toContainText(
      "Source Sans 3",
    );
  });

  test("a failed replacement request labels retained rows and retries safely", async ({
    page,
    mockGraphql,
  }) => {
    await mockGraphql();
    const recover = await installReplacementFailure(page, "http");
    await page.goto("/");
    await expect(page.locator(ROW).first()).toBeVisible();

    await page.getByLabel("Owner").fill("rsms");

    const alert = page.locator("[data-catalog-error]");
    await expect(alert).toContainText(
      "Unable to load the font catalog. Try again.",
    );
    await expect(alert).not.toContainText("catalog-secret");
    await expect(page.locator(ROW).first()).toBeVisible();
    await expect(page.locator("[data-font-list]")).toHaveAttribute(
      "data-placeholder",
      "true",
    );

    recover();
    await alert.getByRole("button", { name: "Retry" }).click();
    await expect(alert).toHaveCount(0);
    await expect(page.locator(ROW).first()).toBeVisible();
  });

  test("dense mode recovers safely from GraphQL replacement errors", async ({
    page,
    mockGraphql,
  }) => {
    await mockGraphql();
    const recover = await installReplacementFailure(page, "graphql");
    await page.goto("/");
    await expect(page.locator(ROW).first()).toBeVisible();
    await page.getByRole("button", { name: "Dense table mode" }).click();
    await expect(page.locator("[data-dense-font-table]")).toBeVisible();

    await page.getByLabel("Owner").fill("rsms");

    const alert = page.locator("[data-catalog-error]");
    await expect(alert).toContainText(
      "Unable to load the font catalog. Try again.",
    );
    await expect(alert).not.toContainText("catalog-secret");
    await expect(page.locator("[data-dense-font-table]")).toBeVisible();
    await expect(page.locator("[data-dense-font-table]")).toHaveAttribute(
      "data-placeholder",
      "true",
    );

    recover();
    await alert.getByRole("button", { name: "Retry" }).click();
    await expect(alert).toHaveCount(0);
    await expect(page.locator("[data-dense-font-table]")).toBeVisible();
  });

  test("malformed JSON replacement failures remain safe and retryable", async ({
    page,
    mockGraphql,
  }) => {
    await mockGraphql();
    const recover = await installReplacementFailure(page, "json");
    await page.goto("/");
    await expect(page.locator(ROW).first()).toBeVisible();

    await page.getByLabel("Owner").fill("rsms");

    const alert = page.locator("[data-catalog-error]");
    await expect(alert).toContainText(
      "Unable to load the font catalog. Try again.",
    );
    await expect(alert).not.toContainText('{"data":');
    await expect(page.locator(ROW).first()).toBeVisible();

    recover();
    await alert.getByRole("button", { name: "Retry" }).click();
    await expect(alert).toHaveCount(0);
    await expect(page.locator(ROW).first()).toBeVisible();
  });

  test("a malformed cursor exposes safe Reset recovery", async ({
    page,
    mockGraphql,
  }) => {
    await mockGraphql();
    await installInvalidCursorFailure(page);
    await page.goto("/?after=not-a-cursor");

    const alert = page.locator("[data-catalog-error]");
    await expect(alert).toContainText(
      "Unable to load the font catalog. Try again.",
    );
    await expect(alert).not.toContainText("query Fonts");
    await expect(alert).not.toContainText("not-a-cursor");

    const reset = alert.getByRole("button", { name: "Reset" });
    await reset.focus();
    await reset.press("Enter");
    await expect
      .poll(() => new URL(page.url()).searchParams.get("after"))
      .toBeNull();
    await expect(alert).toHaveCount(0);
    await expect(page.locator(ROW).first()).toBeVisible();
  });

  test("Reset clears cursor and selected identity atomically", async ({
    page,
    mockGraphql,
  }) => {
    await installInstantFontFace(page);
    await mockGraphql();
    await installInvalidCursorFailure(page);
    await page.goto("/?after=not-a-cursor&font=101");

    const alert = page.locator("[data-catalog-error]");
    await expect(alert).toBeVisible();
    await expect(page.locator("[data-font-use-panel]")).toBeVisible();

    const reset = alert.getByRole("button", { name: "Reset" });
    await reset.focus();
    await reset.press("Enter");

    await expect
      .poll(() => new URL(page.url()).searchParams.get("after"))
      .toBeNull();
    await expect
      .poll(() => new URL(page.url()).searchParams.get("font"))
      .toBeNull();
    await expect(page.locator("[data-font-use-panel]")).toHaveCount(0);
    await expect(page.locator("[data-font-specimen]")).toContainText(
      "Select a face",
    );
  });

  test("invalid closed URL values are canonicalized without hidden state", async ({
    page,
    mockGraphql,
  }) => {
    await mockGraphql();
    await page.goto(
      "/?q=%20%20Inter%20%20&owner=%20%20rsms%20%20&format=png&sort=POPULAR&font=01",
    );
    await expect(page.locator("[data-catalog-shell]")).toBeVisible();

    await expect(page.getByLabel("Search fonts")).toHaveValue("Inter");
    await expect(
      page.getByRole("textbox", { name: "Owner" }),
    ).toHaveValue("rsms");
    await expect(page.getByLabel("Format", { exact: true })).toHaveValue("");
    await expect(page.getByLabel("Sort")).toHaveValue("REPUTATION_DESC");
    await expect
      .poll(() => new URL(page.url()).searchParams.toString())
      .toBe("q=Inter&owner=rsms");
  });

  test("typed whitespace never diverges between controls, URL, and GraphQL", async ({
    page,
    mockGraphql,
  }) => {
    const filters: Array<{
      q?: string | null;
      owner?: string | null;
    }> = [];
    await mockGraphql();
    await page.route("**/api/graphql**", async (route) => {
      const body = route.request().postDataJSON() as {
        query?: string;
        variables?: {
          filter?: {
            q?: string | null;
            owner?: string | null;
          } | null;
        };
      };
      if (/\bquery\s+Fonts\b/.test(body.query ?? "")) {
        filters.push(body.variables?.filter ?? {});
      }
      await route.fallback();
    });
    await page.goto("/");
    await expect(page.locator(ROW).first()).toBeVisible();

    const search = page.getByRole("searchbox", {
      name: "Search fonts",
    });
    const owner = page.getByRole("textbox", { name: "Owner" });

    await search.fill("Noto ");
    await expect(page.locator("[data-catalog-shell]")).toHaveAttribute(
      "data-catalog-state",
      "ready",
    );
    await expect(search).toHaveValue("Noto ");
    await expect
      .poll(() => filters.some((filter) => filter.q === "Noto"))
      .toBe(true);
    await search.pressSequentially("Sans");
    await expect
      .poll(() =>
        filters.some((filter) => filter.q === "Noto Sans"),
      )
      .toBe(true);
    await search.press("Enter");
    await expect(search).toHaveValue("Noto Sans");

    await search.fill("  Inter  ");
    await expect(search).toHaveValue("  Inter  ");
    await owner.fill("  rsms  ");
    await expect(search).toHaveValue("Inter");
    await expect(owner).toHaveValue("rsms");

    await expect
      .poll(() =>
        filters.some(
          (filter) =>
            filter.q === "Inter" && filter.owner === "rsms",
        ),
      )
      .toBe(true);
    expect(
      filters.every(
        (filter) =>
          filter.q == null ||
          filter.q === filter.q.trim(),
      ),
    ).toBe(true);
    expect(
      filters.every(
        (filter) =>
          filter.owner == null ||
          filter.owner === filter.owner.trim(),
      ),
    ).toBe(true);

    await expect
      .poll(() => new URL(page.url()).searchParams.toString())
      .toBe("q=Inter&owner=rsms");

    await search.blur();
    await expect(search).toHaveValue("Inter");
  });

  test("dense Stars ascending remains representable in the main sort select", async ({
    page,
    mockGraphql,
  }) => {
    await openCatalog(page, mockGraphql);
    await page.getByRole("button", { name: "Dense table mode" }).click();

    const starsHeader = page
      .locator("[data-dense-font-table] button")
      .filter({ hasText: "Stars" });
    await starsHeader.click();
    await expect
      .poll(() => new URL(page.url()).searchParams.get("sort"))
      .toBe("STARS_DESC");
    await starsHeader.click();
    await expect
      .poll(() => new URL(page.url()).searchParams.get("sort"))
      .toBe("STARS_ASC");

    const sort = page.getByLabel("Sort");
    await expect(sort).toHaveValue("STARS_ASC");
    await expect(sort.locator('option[value="STARS_ASC"]')).toHaveText(
      "Stars ↑",
    );
  });
});
