import { test as base, expect } from "@playwright/test";
import { installGraphqlMock, type GraphqlMockOptions } from "./graphql-mock";

export type CatalogFixtures = {
  /**
   * Install GraphQL mocks before navigation.
   * Pass `{ live: true }` to hit the real API (requires DATABASE_URL).
   */
  mockGraphql: (options?: GraphqlMockOptions & { live?: boolean }) => Promise<{
    mocked: boolean;
  }>;
};

/**
 * Extended Playwright test with GraphQL route mocking for CI without DB.
 *
 * @example
 * ```ts
 * import { test, expect } from "./fixtures";
 * test("home", async ({ page, mockGraphql }) => {
 *   await mockGraphql();
 *   await page.goto("/");
 * });
 * ```
 */
export const test = base.extend<CatalogFixtures>({
  mockGraphql: async ({ page }, provide) => {
    await provide(async (options = {}) => {
      const { live = false, ...mockOptions } = options;
      if (live) {
        return { mocked: false };
      }
      await installGraphqlMock(page, {
        pageSizeOverride: 3,
        ...mockOptions,
      });
      return { mocked: true };
    });
  },
});

export { expect };
export {
  installGraphqlMock,
  ALL_MOCK_FONTS,
  MOCK_FONTS_PAGE1,
  MOCK_STATS,
  PAGE1_CURSOR,
} from "./graphql-mock";
