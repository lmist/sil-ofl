import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  defaultCatalogContext,
  toFontsFilter,
} from "@/machines/catalog-machine";
import { serializeCatalogContext } from "@/machines/catalog-url";
import {
  normalizeFontsFilterKey,
  queryKeys,
  toFontsGraphqlVariables,
} from "./query-keys";
import { fetchFontsPage } from "@/machines/actors/fetch-fonts";

describe("catalog query identity", () => {
  it("keeps committed display, URL, cache key, and GraphQL variables aligned", () => {
    const context = {
      ...defaultCatalogContext,
      q: "Inter",
      filters: {
        format: "woff2",
        owner: "rsms",
        minStars: 1_000,
        webfont: true,
        variable: true,
      },
      sort: "STARS_ASC" as const,
      after: "cursor-2",
      selectedFontId: 101,
    };
    const filter = toFontsFilter(context);
    const normalized = normalizeFontsFilterKey(filter);
    const url = new URLSearchParams(serializeCatalogContext(context));

    assert.deepEqual(queryKeys.fonts.list(filter).at(-1), normalized);
    assert.deepEqual(toFontsGraphqlVariables(filter), {
      filter: {
        q: "Inter",
        owner: "rsms",
        format: ["woff2"],
        minStars: 1_000,
        webfont: true,
        variable: true,
      },
      sort: "STARS_ASC",
      first: 50,
      after: "cursor-2",
    });
    assert.deepEqual(Object.fromEntries(url), {
      q: "Inter",
      format: "woff2",
      owner: "rsms",
      after: "cursor-2",
      sort: "STARS_ASC",
      font: "101",
    });
    for (const sessionOnly of ["minStars", "webfont", "variable", "dense"]) {
      assert.equal(url.has(sessionOnly), false);
    }
  });

  it("sends the normalized query identity as the actual GraphQL POST variables", async () => {
    const originalFetch = globalThis.fetch;
    const capture: { request?: Request } = {};
    const connection = {
      totalCount: 0,
      pageInfo: { hasNextPage: false, endCursor: null },
      edges: [],
    };

    globalThis.fetch = (async (input, init) => {
      capture.request = new Request(input, init);
      return new Response(
        JSON.stringify({ data: { fonts: connection } }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }) as typeof fetch;

    try {
      const result = await fetchFontsPage({
        q: "Inter",
        owner: "rsms",
        format: ["woff2", "otf"],
        minStars: 1_000,
        webfont: true,
        variable: false,
        sort: "STARS_ASC",
        first: 24,
        after: "cursor-2",
      });

      assert.deepEqual(result, connection);
      const request = capture.request;
      assert.ok(request);
      assert.equal(request.method, "POST");
      assert.equal(new URL(request.url).pathname, "/api/graphql");
      const body = (await request.json()) as {
        query: string;
        variables: unknown;
      };
      assert.match(body.query, /query Fonts/);
      assert.deepEqual(body.variables, {
        filter: {
          q: "Inter",
          owner: "rsms",
          format: ["otf", "woff2"],
          minStars: 1_000,
          webfont: true,
          variable: false,
        },
        sort: "STARS_ASC",
        first: 24,
        after: "cursor-2",
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
