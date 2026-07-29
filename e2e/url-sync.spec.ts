import { expect, test } from "./fixtures";

test.describe("catalog URL synchronization", () => {
  test("one catalog event writes one canonical URL", async ({
    page,
    mockGraphql,
  }) => {
    await page.addInitScript(() => {
      const target = window as Window & {
        __catalogReplaceCalls?: Array<{ url: string; stack: string }>;
      };
      target.__catalogReplaceCalls = [];
      const replaceState = window.history.replaceState.bind(window.history);
      window.history.replaceState = (data, unused, url) => {
        target.__catalogReplaceCalls?.push({
          url: String(url ?? ""),
          stack: new Error().stack ?? "",
        });
        replaceState(data, unused, url);
      };
    });
    await mockGraphql();
    await page.goto("/");
    await expect(page.locator("[data-font-row]").first()).toBeVisible();

    await page.evaluate(() => {
      const target = window as Window & {
        __catalogReplaceCalls?: Array<{ url: string; stack: string }>;
      };
      target.__catalogReplaceCalls = [];
    });
    await page.getByLabel("Format").selectOption("woff2");
    await expect
      .poll(() => new URL(page.url()).searchParams.get("format"))
      .toBe("woff2");

    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              window as Window & {
                __catalogReplaceCalls?: Array<{
                  url: string;
                  stack: string;
                }>;
              }
            ).__catalogReplaceCalls
              ?.filter(({ stack }) => stack.includes("useCatalogMachine"))
              .map(({ url }) => url) ?? [],
        ),
      )
      .toEqual(["/?format=woff2"]);
  });
});
