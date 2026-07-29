import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decodeFontCursor } from "../../src/graphql/schema/cursor";
import {
  resolveGraphqlMock,
  type GraphqlBody,
  type MockGraphqlPayload,
} from "./graphql-mock";

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
): FontConnection {
  const payload = resolveGraphqlMock({
    operationName: "Fonts",
    variables,
  });
  assert.ok("data" in payload);
  return (payload as MockGraphqlPayload<{ fonts: FontConnection }>).data.fonts;
}

describe("GraphQL Playwright mock", () => {
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
