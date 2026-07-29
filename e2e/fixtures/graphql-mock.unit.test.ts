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

type DecodedFontCursor = NonNullable<ReturnType<typeof decodeFontCursor>>;

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

function cursorAt(
  keys: Partial<Omit<DecodedFontCursor, "v">> &
    Pick<DecodedFontCursor, "id">,
): string {
  const seed = decodeFontCursor(fonts({ first: 1 }).edges[0]!.cursor);
  assert.ok(seed);
  return encodeFontCursor({ ...seed, ...keys });
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

  it("exposes only OFL 1.0 and 1.1 rows through public mock views", () => {
    const accepted = {
      ...ALL_MOCK_FONTS[0]!,
      id: "901",
      fontFileId: 901,
      repoId: 901,
      ownerLogin: "accepted",
      fullName: "accepted/fonts",
      repoName: "fonts",
      licenseSpdx: "OFL-1.0",
    };
    const excluded = {
      ...ALL_MOCK_FONTS[1]!,
      id: "902",
      fontFileId: 902,
      repoId: 902,
      ownerLogin: "excluded",
      fullName: "excluded/fonts",
      repoName: "fonts",
      licenseSpdx: "MIT",
    };
    const fontNodes = [accepted, excluded];

    const connection = fonts({ first: 100 }, { fontNodes });
    assert.deepEqual(
      connection.edges.map(({ node }) => node.fontFileId),
      [901],
    );

    assert.deepEqual(
      resolveGraphqlMock(
        {
          operationName: "Font",
          variables: { id: excluded.id },
        },
        { fontNodes },
      ),
      { data: { font: null } },
    );
    assert.deepEqual(
      resolveGraphqlMock(
        {
          operationName: "Repo",
          variables: { owner: "excluded", name: "fonts" },
        },
        { fontNodes },
      ),
      { data: { repo: null } },
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

  it("rejects first values outside the production 1 through 100 contract", () => {
    for (const first of [0, 101, 1.5]) {
      const payload = resolveGraphqlMock({
        operationName: "Fonts",
        variables: { first },
      });
      assert.deepEqual(
        payload,
        {
          errors: [
            { message: "first must be an integer from 1 through 100" },
          ],
        },
        String(first),
      );
    }
  });

  it("applies structurally valid absent-ID cursors as keyset tuples", () => {
    const fontNodes = [...ALL_MOCK_FONTS, MOCK_NULL_FAMILY_FONT];
    const cases = [
      {
        sort: "REPUTATION_DESC",
        cursor: cursorAt({ rep: 87, id: 999_991 }),
        expected: [103, 201, 202, 203, 301],
      },
      {
        sort: "REPUTATION_ASC",
        cursor: cursorAt({ rep: 87, id: 999_992 }),
        expected: [102, 101],
      },
      {
        sort: "STARS_DESC",
        cursor: cursorAt({ stars: 1_000, id: 999_993 }),
        expected: [201, 202, 203, 301],
      },
      {
        sort: "STARS_ASC",
        cursor: cursorAt({ stars: 1_000, id: 999_994 }),
        expected: [103, 102, 101],
      },
      {
        sort: "FAMILY_ASC",
        cursor: cursorAt({ family: "Inter", id: 100 }),
        expected: [101, 201, 202, 203, 102, 301],
      },
      {
        sort: "FAMILY_DESC",
        cursor: cursorAt({ family: "Inter", id: 104 }),
        expected: [101, 103, 301],
      },
      {
        sort: "ID_ASC",
        cursor: cursorAt({ id: 150 }),
        expected: [201, 202, 203, 301],
      },
      {
        sort: "ID_DESC",
        cursor: cursorAt({ id: 150 }),
        expected: [103, 102, 101],
      },
    ] as const;

    for (const { sort, cursor, expected } of cases) {
      const connection = fonts(
        { sort, after: cursor, first: 100 },
        { fontNodes },
      );
      assert.deepEqual(
        connection.edges.map(({ node }) => node.fontFileId),
        expected,
        sort,
      );
    }
  });

  it("returns a deterministic GraphQL error for malformed cursor payloads", () => {
    const seed = decodeFontCursor(fonts({ first: 1 }).edges[0]!.cursor);
    assert.ok(seed);
    const invalidPayload = Buffer.from(
      JSON.stringify({ ...seed, id: "999999" }),
      "utf8",
    ).toString("base64url");

    for (const after of ["not-a-cursor", invalidPayload]) {
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

  it("applies absent-ID cursors within the null-family keyset", () => {
    const secondNullFamily = {
      ...MOCK_NULL_FAMILY_FONT,
      id: "303",
      fontFileId: 303,
      repoId: 303,
    };
    const fontNodes = [
      ...ALL_MOCK_FONTS,
      MOCK_NULL_FAMILY_FONT,
      secondNullFamily,
    ];
    const expected: Record<string, number[]> = {
      FAMILY_ASC: [303],
      FAMILY_DESC: [301],
    };

    for (const [sort, ids] of Object.entries(expected)) {
      const ordered = fonts({ sort, first: 100 }, { fontNodes });
      const nullEdge = ordered.edges.find(
        ({ node }) => node.familyGuess === null,
      );
      assert.ok(nullEdge);
      const decoded = decodeFontCursor(nullEdge.cursor);
      assert.ok(decoded);
      const after = encodeFontCursor({ ...decoded, id: 302 });

      const connection = fonts(
        { sort, first: 100, after },
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
    const decoded = decodeFontCursor(endCursor);
    assert.ok(decoded);
    assert.deepEqual(
      {
        rep: decoded.rep,
        stars: decoded.stars,
        family: decoded.family,
        id: decoded.id,
      },
      {
        rep: 99,
        stars: 5000,
        family: "Inter",
        id: 101,
      },
    );

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
