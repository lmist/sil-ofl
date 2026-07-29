import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Page, Route } from "@playwright/test";
import {
  decodeFontCursor,
  encodeFontCursor,
} from "../../src/graphql/schema/cursor";
import {
  installGraphqlMock,
  resolveGraphqlMock,
  type GraphqlBody,
  type MockGraphqlPayload,
} from "./graphql-mock";
import {
  ALL_MOCK_FONTS,
  MOCK_NULL_FAMILY_FONT,
} from "./mock-data";

type FontConnection = {
  totalCount: number;
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  edges: {
    cursor: string;
    node: {
      fontFileId: number;
      familyGuess: string | null;
      ownerLogin: string;
      isWebfont: boolean;
      isVariable: boolean;
      reputation: number;
      stars: number;
    };
  }[];
};

function fonts(
  variables: NonNullable<GraphqlBody["variables"]>,
  options?: NonNullable<Parameters<typeof resolveGraphqlMock>[1]>,
): FontConnection {
  const payload = resolveGraphqlMock({
    operationName: "Fonts",
    variables,
  }, options);
  assert.ok("data" in payload);
  return (payload as MockGraphqlPayload<{ fonts: FontConnection }>).data.fonts;
}

async function createGetAdapter() {
  let handler: ((route: Route) => Promise<void> | void) | undefined;
  const page = {
    route: async (
      _pattern: string,
      routeHandler: (route: Route) => Promise<void> | void,
    ) => {
      handler = routeHandler;
    },
  } as unknown as Page;
  await installGraphqlMock(page);
  assert.ok(handler);
  const routeHandler = handler;

  return async (url: URL) => {
    let responseBody: string | undefined;
    const route = {
      request: () => ({
        method: () => "GET",
        postDataJSON: () => null,
        url: () => url.toString(),
      }),
      fulfill: async ({ body }: { body?: string }) => {
        responseBody = body;
      },
    } as unknown as Route;

    await routeHandler(route);
    assert.ok(responseBody);
    return JSON.parse(responseBody) as Record<string, unknown>;
  };
}

describe("GraphQL Playwright mock", () => {
  it("adapts bodyless GET query, operationName, and JSON variables safely", async () => {
    const get = await createGetAdapter();
    const fontsUrl = new URL("http://localhost/api/graphql");
    fontsUrl.searchParams.set(
      "query",
      "query Fonts($first: Int) { fonts(first: $first) { totalCount } }",
    );
    fontsUrl.searchParams.set(
      "variables",
      JSON.stringify({ filter: { q: "fonts/" }, first: 2 }),
    );
    const fontsPayload = (await get(fontsUrl)) as {
      data: { fonts: FontConnection };
    };
    assert.equal(fontsPayload.data.fonts.totalCount, 6);
    assert.equal(fontsPayload.data.fonts.edges.length, 2);

    const fontUrl = new URL("http://localhost/api/graphql");
    fontUrl.searchParams.set(
      "query",
      [
        "query Fonts { fonts { totalCount } }",
        "query Font($id: ID!) { font(id: $id) { fontFileId } }",
      ].join("\n"),
    );
    fontUrl.searchParams.set("operationName", "Font");
    fontUrl.searchParams.set("variables", JSON.stringify({ id: "101" }));
    const fontPayload = (await get(fontUrl)) as {
      data: { font: { fontFileId: number } | null };
    };
    assert.equal(fontPayload.data.font?.fontFileId, 101);

    const malformedVariablesUrl = new URL("http://localhost/api/graphql");
    malformedVariablesUrl.searchParams.set("query", "query Health { health { ok } }");
    malformedVariablesUrl.searchParams.set("variables", "{not-json");
    const healthPayload = (await get(malformedVariablesUrl)) as {
      data: { health: { ok: boolean } };
    };
    assert.equal(healthPayload.data.health.ok, true);
  });

  it("trims owner input and applies the production exact-match predicate", () => {
    const exact = fonts({
      filter: { owner: "  rsms  " },
      first: 100,
    });
    assert.deepEqual(
      exact.edges.map(({ node }) => node.ownerLogin),
      ["rsms"],
    );

    const partial = fonts({ filter: { owner: "rsm" }, first: 100 });
    assert.equal(partial.totalCount, 0);
    assert.deepEqual(partial.edges, []);
  });

  it("searches font paths in addition to display metadata", () => {
    const connection = fonts({
      filter: { q: "fonts/" },
      first: 100,
    });
    assert.equal(connection.totalCount, 6);
    assert.equal(connection.edges.length, 6);
  });

  it("honors explicit false boolean filters", () => {
    const connection = fonts({
      filter: { webfont: false, variable: false },
      first: 100,
    });
    assert.deepEqual(
      connection.edges.map(({ node }) => node.fontFileId),
      [102, 201, 202],
    );
    assert.ok(
      connection.edges.every(
        ({ node }) => !node.isWebfont && !node.isVariable,
      ),
    );
  });

  it("computes totalCount before applying the page size", () => {
    const connection = fonts({
      filter: { q: "fonts/" },
      first: 2,
    });
    assert.equal(connection.totalCount, 6);
    assert.equal(connection.edges.length, 2);
    assert.equal(connection.pageInfo.hasNextPage, true);
  });

  it("honors first by default and caps pages only with an explicit fixture override", () => {
    const productionDefault = fonts({ first: 50 });
    assert.equal(productionDefault.edges.length, 6);
    assert.equal(productionDefault.pageInfo.hasNextPage, false);

    const firstFixturePage = fonts(
      { first: 50 },
      { pageSizeOverride: 3 },
    );
    assert.deepEqual(
      firstFixturePage.edges.map(({ node }) => node.fontFileId),
      [101, 102, 103],
    );
    assert.equal(firstFixturePage.pageInfo.hasNextPage, true);

    const secondFixturePage = fonts(
      { first: 50, after: firstFixturePage.pageInfo.endCursor },
      { pageSizeOverride: 3 },
    );
    assert.deepEqual(
      secondFixturePage.edges.map(({ node }) => node.fontFileId),
      [201, 202, 203],
    );
    assert.equal(secondFixturePage.pageInfo.hasNextPage, false);
  });

  it("returns a deterministic GraphQL error for malformed or unknown cursors", () => {
    const unknownCursor = encodeFontCursor({
      v: 1,
      rep: 0,
      stars: 0,
      family: "Missing",
      id: 999_999,
    });

    for (const after of ["not-a-cursor", unknownCursor]) {
      const payload = resolveGraphqlMock({
        operationName: "Fonts",
        variables: { after },
      });
      assert.deepEqual(payload, {
        errors: [{ message: "Invalid cursor" }],
      });
    }
  });

  it("applies every schema-supported font sort", () => {
    const expected: Record<string, number[]> = {
      REPUTATION_DESC: [101, 102, 103, 201, 202, 203],
      REPUTATION_ASC: [203, 202, 201, 103, 102, 101],
      STARS_DESC: [101, 102, 103, 201, 202, 203],
      STARS_ASC: [203, 202, 201, 103, 102, 101],
      FAMILY_ASC: [103, 101, 201, 202, 203, 102],
      FAMILY_DESC: [102, 203, 202, 201, 101, 103],
      ID_DESC: [203, 202, 201, 103, 102, 101],
      ID_ASC: [101, 102, 103, 201, 202, 203],
    };

    for (const [sort, ids] of Object.entries(expected)) {
      const connection = fonts({
        filter: { q: "fonts/" },
        first: 100,
        sort,
      });
      assert.deepEqual(
        connection.edges.map(({ node }) => node.fontFileId),
        ids,
        sort,
      );
    }
  });

  it("keeps null families last for both family sort directions", () => {
    const fontNodes = [...ALL_MOCK_FONTS, MOCK_NULL_FAMILY_FONT];
    const expected: Record<string, number[]> = {
      FAMILY_ASC: [103, 101, 201, 202, 203, 102, 301],
      FAMILY_DESC: [102, 203, 202, 201, 101, 103, 301],
    };

    for (const [sort, ids] of Object.entries(expected)) {
      const connection = fonts(
        {
          filter: { q: "fonts/" },
          first: 100,
          sort,
        },
        { fontNodes },
      );
      assert.deepEqual(
        connection.edges.map(({ node }) => node.fontFileId),
        ids,
        sort,
      );
    }
  });

  it("uses deterministic production-shaped cursors for edges and pagination", () => {
    const firstPage = fonts({
      filter: { q: "fonts/" },
      sort: "FAMILY_ASC",
      first: 2,
    });
    const endCursor = firstPage.pageInfo.endCursor;
    assert.equal(endCursor, firstPage.edges.at(-1)?.cursor);
    assert.ok(endCursor);
    assert.deepEqual(decodeFontCursor(endCursor), {
      v: 1,
      rep: 99,
      stars: 5000,
      family: "Inter",
      id: 101,
    });

    const repeated = fonts({
      filter: { q: "fonts/" },
      sort: "FAMILY_ASC",
      first: 2,
    });
    assert.equal(repeated.pageInfo.endCursor, endCursor);

    const secondPage = fonts({
      filter: { q: "fonts/" },
      sort: "FAMILY_ASC",
      first: 2,
      after: endCursor,
    });
    assert.deepEqual(
      secondPage.edges.map(({ node }) => node.fontFileId),
      [201, 202],
    );
    assert.equal(secondPage.totalCount, 6);
  });

  it("handles Repo detail operations separately from Repos connections", () => {
    const found = resolveGraphqlMock({
      query: `
        query Repo($owner: String!, $name: String!) {
          repo(owner: $owner, name: $name) { id fullName fontCount }
        }
      `,
      variables: { owner: "rsms", name: "fonts" },
    });
    assert.ok("data" in found);
    assert.deepEqual(found.data, {
      repo: {
        id: "101",
        fullName: "rsms/fonts",
        name: "fonts",
        description: null,
        htmlUrl: "https://github.com/rsms/fonts",
        stars: 5000,
        reputation: 99,
        licenseSpdx: "OFL-1.1",
        defaultBranch: "main",
        ownerLogin: "rsms",
        fontCount: 1,
      },
    });

    const missing = resolveGraphqlMock({
      operationName: "Repo",
      variables: { owner: "missing", name: "fonts" },
    });
    assert.ok("data" in missing);
    assert.deepEqual(missing.data, { repo: null });
  });
});
