import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Kind, parse, print, visit } from "graphql";
import { GET, OPTIONS, POST } from "@/app/api/graphql/route";
import {
  FONT_QUERY,
  FONTS_QUERY,
  HEALTH_QUERY,
  REPO_QUERY,
  REPOS_QUERY,
  STATS_QUERY,
} from "./documents";

const endpoint = "https://fonts.example/api/graphql";
const appUrl = process.env.NEXT_PUBLIC_APP_URL;

before(() => {
  process.env.NEXT_PUBLIC_APP_URL = "https://fonts.example";
});

after(() => {
  if (appUrl === undefined) {
    delete process.env.NEXT_PUBLIC_APP_URL;
  } else {
    process.env.NEXT_PUBLIC_APP_URL = appUrl;
  }
});

function request(
  url: string,
  init?: RequestInit,
): Request {
  return new Request(url, init);
}

function headerTokens(value: string | null): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((token) => token.trim().toLowerCase())
      .filter(Boolean),
  );
}

function skipRootFields(document: string): string {
  return print(
    visit(parse(document), {
      OperationDefinition(node) {
        return {
          ...node,
          selectionSet: {
            ...node.selectionSet,
            selections: node.selectionSet.selections.map((selection) =>
              selection.kind === Kind.FIELD
                ? {
                    ...selection,
                    directives: [
                      ...(selection.directives ?? []),
                      {
                        kind: Kind.DIRECTIVE,
                        name: { kind: Kind.NAME, value: "skip" },
                        arguments: [
                          {
                            kind: Kind.ARGUMENT,
                            name: { kind: Kind.NAME, value: "if" },
                            value: { kind: Kind.BOOLEAN, value: true },
                          },
                        ],
                      },
                    ],
                  }
                : selection,
            ),
          },
        };
      },
    }),
  );
}

describe("GraphQL HTTP policy", () => {
  it("rejects CORS preflights from arbitrary origins", async () => {
    const response = await OPTIONS(
      request(endpoint, {
        method: "OPTIONS",
        headers: {
          Origin: "https://attacker.example",
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "content-type",
        },
      }),
    );

    assert.equal(response.status, 403);
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
    assert.match(response.headers.get("Cache-Control") ?? "", /no-store/);
    assert.match(response.headers.get("Vary") ?? "", /(?:^|,\s*)Origin(?:,|$)/i);
  });

  it("rejects GraphQL requests from arbitrary origins", async () => {
    const query = encodeURIComponent("{ health { ok } }");
    const response = await GET(
      request(`${endpoint}?query=${query}`, {
        headers: { Origin: "https://attacker.example" },
      }),
    );

    assert.equal(response.status, 403);
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  });

  it("does not trust spoofed forwarding headers on GraphQL GET requests", async () => {
    const query = encodeURIComponent("{ health { ok } }");
    const response = await GET(
      request(`${endpoint}?query=${query}`, {
        headers: {
          Host: "attacker.example",
          Origin: "https://attacker.example",
          "X-Forwarded-Proto": "https",
        },
      }),
    );

    assert.equal(response.status, 403);
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
    assert.equal(response.headers.get("Access-Control-Allow-Credentials"), null);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.deepEqual(
      headerTokens(response.headers.get("Vary")),
      new Set([
        "origin",
        "access-control-request-method",
        "access-control-request-headers",
      ]),
    );
  });

  it("does not trust spoofed forwarding headers on CORS preflights", async () => {
    const response = await OPTIONS(
      request(endpoint, {
        method: "OPTIONS",
        headers: {
          Host: "attacker.example",
          Origin: "https://attacker.example",
          "X-Forwarded-Proto": "https",
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "content-type",
        },
      }),
    );

    assert.equal(response.status, 403);
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
    assert.equal(response.headers.get("Access-Control-Allow-Credentials"), null);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.deepEqual(
      headerTokens(response.headers.get("Vary")),
      new Set([
        "origin",
        "access-control-request-method",
        "access-control-request-headers",
      ]),
    );
  });

  it("does not trust an unconfigured request URL as a deployment origin", async () => {
    const query = encodeURIComponent("{ health { ok } }");
    const response = await GET(
      request(`https://unconfigured.example/api/graphql?query=${query}`, {
        headers: { Origin: "https://unconfigured.example" },
      }),
    );

    assert.equal(response.status, 403);
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
    assert.equal(response.headers.get("Access-Control-Allow-Credentials"), null);
  });

  it("rejects non-serialized same-origin values", async () => {
    const query = encodeURIComponent("{ health { ok } }");
    const malformedOrigins = [
      "https://fonts.example/",
      "https://fonts.example/path",
      "https://user@fonts.example",
    ];

    for (const origin of malformedOrigins) {
      const response = await GET(
        request(`${endpoint}?query=${query}`, {
          headers: { Origin: origin },
        }),
      );

      assert.equal(response.status, 403, origin);
      assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
    }
  });

  it("accepts the configured local development origin aliases", async () => {
    const query = encodeURIComponent("{ health { ok } }");
    const response = await GET(
      request(`http://localhost:3000/api/graphql?query=${query}`, {
        headers: {
          Origin: "http://127.0.0.1:3000",
        },
      }),
    );

    assert.equal(response.status, 200);
    assert.equal(
      response.headers.get("Access-Control-Allow-Origin"),
      "http://127.0.0.1:3000",
    );
  });

  it("answers same-origin preflights with an explicit credentialed policy", async () => {
    const response = await OPTIONS(
      request(endpoint, {
        method: "OPTIONS",
        headers: {
          Origin: "https://fonts.example",
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "content-type, accept",
        },
      }),
    );

    assert.equal(response.status, 204);
    assert.equal(
      response.headers.get("Access-Control-Allow-Origin"),
      "https://fonts.example",
    );
    assert.equal(response.headers.get("Access-Control-Allow-Credentials"), "true");
    assert.deepEqual(
      headerTokens(response.headers.get("Access-Control-Allow-Methods")),
      new Set(["get", "post", "options"]),
    );
    assert.deepEqual(
      headerTokens(response.headers.get("Access-Control-Allow-Headers")),
      new Set(["accept", "content-type"]),
    );
    assert.deepEqual(
      headerTokens(response.headers.get("Vary")),
      new Set([
        "accept",
        "content-type",
        "origin",
        "access-control-request-method",
        "access-control-request-headers",
      ]),
    );
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  });

  it("accepts canonical and explicitly allowlisted deployment origins", async () => {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL;
    const allowedOrigins = process.env.GRAPHQL_ALLOWED_ORIGINS;
    process.env.NEXT_PUBLIC_APP_URL = "https://canonical.example/catalog";
    process.env.GRAPHQL_ALLOWED_ORIGINS =
      "https://preview.example, https://partner.example";

    try {
      const query = encodeURIComponent("{ health { ok } }");
      for (const origin of [
        "https://canonical.example",
        "https://preview.example",
        "https://partner.example",
      ]) {
        const response = await GET(
          request(`${endpoint}?query=${query}`, {
            headers: { Origin: origin },
          }),
        );

        assert.equal(response.status, 200, origin);
        assert.equal(
          response.headers.get("Access-Control-Allow-Origin"),
          origin,
        );
        assert.equal(
          response.headers.get("Access-Control-Allow-Credentials"),
          "true",
        );
      }
    } finally {
      if (appUrl === undefined) {
        delete process.env.NEXT_PUBLIC_APP_URL;
      } else {
        process.env.NEXT_PUBLIC_APP_URL = appUrl;
      }
      if (allowedOrigins === undefined) {
        delete process.env.GRAPHQL_ALLOWED_ORIGINS;
      } else {
        process.env.GRAPHQL_ALLOWED_ORIGINS = allowedOrigins;
      }
    }
  });

  it("rejects unsupported CORS preflight methods", async () => {
    const response = await OPTIONS(
      request(endpoint, {
        method: "OPTIONS",
        headers: {
          Origin: "https://fonts.example",
          "Access-Control-Request-Method": "DELETE",
        },
      }),
    );

    assert.equal(response.status, 405);
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
    assert.deepEqual(
      headerTokens(response.headers.get("Allow")),
      new Set(["get", "post", "options"]),
    );
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  });

  it("rejects unsupported CORS preflight headers", async () => {
    const response = await OPTIONS(
      request(endpoint, {
        method: "OPTIONS",
        headers: {
          Origin: "https://fonts.example",
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "content-type, x-api-key",
        },
      }),
    );

    assert.equal(response.status, 403);
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  });

  it("never marks GraphQL validation errors as shared-cacheable", async () => {
    const query = encodeURIComponent("{ fonts { definitelyMissing } }");
    const response = await GET(
      request(`${endpoint}?query=${query}`, {
        headers: { Accept: "application/graphql-response+json" },
      }),
    );
    const result = (await response.json()) as { errors?: unknown[] };

    assert.ok(result.errors?.length);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  });

  it("never marks GraphQL execution errors as shared-cacheable", async () => {
    const query = encodeURIComponent(
      '{ fonts(after: "not-a-cursor") { totalCount } }',
    );
    const response = await GET(request(`${endpoint}?query=${query}`));
    const result = (await response.json()) as { errors?: unknown[] };

    assert.ok(result.errors?.length);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  });

  it("never marks malformed GraphQL input as shared-cacheable", async () => {
    const query = encodeURIComponent("{");
    const response = await GET(request(`${endpoint}?query=${query}`));
    const result = (await response.json()) as { errors?: unknown[] };

    assert.ok(result.errors?.length);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  });

  it("accepts omitted, empty, null, and object GET variables", async () => {
    for (const variables of [
      undefined,
      "",
      "null",
      JSON.stringify({ unused: 1 }),
    ]) {
      const params = new URLSearchParams({
        query: "{ health { ok } }",
      });
      if (variables !== undefined) params.set("variables", variables);

      const response = await GET(request(`${endpoint}?${params}`));
      const result = (await response.json()) as {
        data?: { health?: { ok?: boolean } };
      };

      assert.equal(response.status, 200, variables);
      assert.equal(result.data?.health?.ok, true, variables);
    }
  });

  it("rejects malformed and non-object GET variables before database work", async () => {
    const databaseUrl = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;

    try {
      const invalidVariables = [
        '{"id":',
        "[]",
        JSON.stringify("1"),
        "1",
        "true",
      ];
      for (const variables of invalidVariables) {
        const params = new URLSearchParams({
          query: 'query Font($id: ID! = "1") { font(id: $id) { id } }',
          variables,
        });
        const response = await GET(request(`${endpoint}?${params}`));
        const result = (await response.json()) as {
          errors?: Array<{ message?: string; extensions?: unknown }>;
        };

        assert.equal(response.status, 400, variables);
        assert.equal(response.headers.get("Cache-Control"), "private, no-store");
        assert.deepEqual(result, {
          errors: [
            {
              message: "GraphQL variables must be a JSON object or null.",
            },
          ],
        });
      }
    } finally {
      if (databaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = databaseUrl;
      }
    }
  });

  it("derives cache safety from the parsed selected operation", async () => {
    const document = `
      query CacheSafeTextOnly {
        health { ok }
      }

      query Selected {
        __typename
      }

      # fonts
    `;
    const params = new URLSearchParams({
      query: document,
      operationName: "Selected",
    });
    const response = await GET(request(`${endpoint}?${params}`));
    const result = (await response.json()) as {
      data?: { __typename?: string };
    };

    assert.equal(result.data?.__typename, "Query");
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  });

  it("never marks POST responses as shared-cacheable", async () => {
    const response = await POST(
      request(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "{ health { ok } }" }),
      }),
    );
    const result = (await response.json()) as {
      data?: { health?: { ok?: boolean } };
    };

    assert.equal(result.data?.health?.ok, true);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  });

  it("rejects oversized POST bodies before GraphQL execution", async () => {
    const oversizedDocument = `{ health { ok } } # ${"x".repeat(70_000)}`;
    const response = await POST(
      request(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: oversizedDocument }),
      }),
    );
    const result = (await response.json()) as {
      errors?: Array<{ message?: string }>;
    };

    assert.equal(response.status, 413);
    assert.equal(result.errors?.[0]?.message, "GraphQL request is too large.");
    assert.doesNotMatch(JSON.stringify(result), /x{100}/);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  });

  it("rejects oversized GET documents before GraphQL execution", async () => {
    const oversizedDocument = `{ health { ok } } # ${"x".repeat(70_000)}`;
    const params = new URLSearchParams({ query: oversizedDocument });
    const response = await GET(request(`${endpoint}?${params}`));
    const result = (await response.json()) as {
      errors?: Array<{ message?: string }>;
    };

    assert.equal(response.status, 413);
    assert.equal(result.errors?.[0]?.message, "GraphQL request is too large.");
    assert.doesNotMatch(JSON.stringify(result), /x{100}/);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  });

  it("applies the GET byte limit to every GraphQL parameter", async () => {
    const params = new URLSearchParams({
      query: "{ health { ok } }",
      variables: JSON.stringify({ padding: "x".repeat(70_000) }),
    });
    const response = await GET(request(`${endpoint}?${params}`));
    const result = (await response.json()) as {
      errors?: Array<{ message?: string }>;
    };

    assert.equal(response.status, 413);
    assert.equal(result.errors?.[0]?.message, "GraphQL request is too large.");
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  });

  it("rejects repeated expensive root connections before database work", async () => {
    const query = encodeURIComponent(`
      query TooManyConnections {
        first: fonts(first: 1) { totalCount }
        second: fonts(first: 1) { totalCount }
        third: repos(first: 1) { totalCount }
      }
    `);
    const response = await GET(
      request(`${endpoint}?query=${query}`, {
        headers: { Accept: "application/graphql-response+json" },
      }),
    );
    const result = (await response.json()) as {
      errors?: Array<{ message?: string }>;
    };

    assert.equal(response.status, 400);
    assert.equal(
      result.errors?.[0]?.message,
      "GraphQL operation exceeds request budget.",
    );
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  });

  it("applies the budget separately to each selected operation", async () => {
    const document = `
      query Safe { health { ok } }
      query Expensive {
        first: fonts(first: 1) { totalCount }
        second: fonts(first: 1) { totalCount }
        third: repos(first: 1) { totalCount }
      }
    `;
    const safeParams = new URLSearchParams({
      query: document,
      operationName: "Safe",
    });
    const safeResponse = await GET(request(`${endpoint}?${safeParams}`));
    assert.equal(safeResponse.status, 200);

    const expensiveParams = new URLSearchParams({
      query: document,
      operationName: "Expensive",
    });
    const expensiveResponse = await GET(
      request(`${endpoint}?${expensiveParams}`, {
        headers: { Accept: "application/graphql-response+json" },
      }),
    );
    const result = (await expensiveResponse.json()) as {
      errors?: Array<{ message?: string }>;
    };

    assert.equal(expensiveResponse.status, 400);
    assert.equal(
      result.errors?.[0]?.message,
      "GraphQL operation exceeds request budget.",
    );
    assert.equal(
      expensiveResponse.headers.get("Cache-Control"),
      "private, no-store",
    );
  });

  it("rejects operations with excessive aliases", async () => {
    const aliasedFields = Array.from(
      { length: 21 },
      (_, index) => `value${index}: ok`,
    ).join("\n");
    const params = new URLSearchParams({
      query: `query TooManyAliases { health { ${aliasedFields} } }`,
    });
    const response = await GET(
      request(`${endpoint}?${params}`, {
        headers: { Accept: "application/graphql-response+json" },
      }),
    );
    const result = (await response.json()) as {
      errors?: Array<{ message?: string }>;
    };

    assert.equal(response.status, 400);
    assert.equal(
      result.errors?.[0]?.message,
      "GraphQL operation exceeds request budget.",
    );
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  });

  it("rejects operations with excessive field selections", async () => {
    const repeatedFields = Array.from({ length: 251 }, () => "ok").join("\n");
    const params = new URLSearchParams({
      query: `query TooManyFields { health { ${repeatedFields} } }`,
    });
    const response = await GET(
      request(`${endpoint}?${params}`, {
        headers: { Accept: "application/graphql-response+json" },
      }),
    );
    const result = (await response.json()) as {
      errors?: Array<{ message?: string }>;
    };

    assert.equal(response.status, 400);
    assert.equal(
      result.errors?.[0]?.message,
      "GraphQL operation exceeds request budget.",
    );
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  });

  it("rejects operations with excessive selection depth", async () => {
    let nestedSelection = "kind";
    for (let depth = 0; depth < 16; depth += 1) {
      nestedSelection = `ofType { ${nestedSelection} }`;
    }
    const params = new URLSearchParams({
      query: `query TooDeep { __type(name: "Query") { ${nestedSelection} } }`,
    });
    const response = await GET(
      request(`${endpoint}?${params}`, {
        headers: { Accept: "application/graphql-response+json" },
      }),
    );
    const result = (await response.json()) as {
      errors?: Array<{ message?: string }>;
    };

    assert.equal(response.status, 400);
    assert.equal(
      result.errors?.[0]?.message,
      "GraphQL operation exceeds request budget.",
    );
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  });

  it("keeps every shipped operation within the request budget", async () => {
    const shippedOperations = [
      { query: HEALTH_QUERY, operationName: "Health", variables: {} },
      { query: STATS_QUERY, operationName: "CatalogStats", variables: {} },
      { query: FONTS_QUERY, operationName: "Fonts", variables: {} },
      {
        query: FONT_QUERY,
        operationName: "Font",
        variables: { id: "1" },
      },
      { query: REPOS_QUERY, operationName: "Repos", variables: {} },
      {
        query: REPO_QUERY,
        operationName: "Repo",
        variables: { owner: "owner", name: "repo" },
      },
    ];

    for (const operation of shippedOperations) {
      const response = await POST(
        request(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...operation,
            query: skipRootFields(operation.query),
          }),
        }),
      );
      const result = (await response.json()) as {
        data?: Record<string, unknown>;
        errors?: Array<{ message?: string }>;
      };

      assert.equal(response.status, 200, operation.operationName);
      assert.deepEqual(result.errors, undefined, operation.operationName);
      assert.deepEqual(result.data, {}, operation.operationName);
      assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    }
  });

  it("never shares responses to credential-bearing GET requests", async () => {
    const query = encodeURIComponent("{ health { ok } }");
    const credentialHeaders: HeadersInit[] = [
      { Cookie: "session=private" },
      { Authorization: "Bearer private" },
    ];

    for (const headers of credentialHeaders) {
      const response = await GET(
        request(`${endpoint}?query=${query}`, { headers }),
      );

      assert.equal(response.status, 200);
      assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    }
  });

  it("varies anonymous shared-cache responses on credential headers", async () => {
    const query = encodeURIComponent("{ health { ok } }");
    const response = await GET(request(`${endpoint}?query=${query}`));
    const vary = headerTokens(response.headers.get("Vary"));

    assert.match(response.headers.get("Cache-Control") ?? "", /^public,/);
    assert.ok(vary.has("cookie"));
    assert.ok(vary.has("authorization"));
  });

  it("uses the POST body instead of URL GraphQL parameters", async () => {
    const urlQuery = encodeURIComponent("{ health { ok } }");
    const response = await POST(
      request(`${endpoint}?query=${urlQuery}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "{ definitelyMissing }" }),
      }),
    );
    const result = (await response.json()) as {
      data?: { health?: unknown };
      errors?: unknown[];
    };

    assert.ok(result.errors?.length);
    assert.equal(result.data?.health, undefined);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  });

  it("does not expose JSON parser internals", async () => {
    const response = await POST(
      request(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{",
      }),
    );
    const result = (await response.json()) as {
      errors?: Array<{ message?: string }>;
    };
    const serialized = JSON.stringify(result);

    assert.equal(response.status, 400);
    assert.equal(result.errors?.[0]?.message, "POST body sent invalid JSON.");
    assert.doesNotMatch(
      serialized,
      /originalError|SyntaxError|Unexpected end|JSON input|stack/i,
    );
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  });

  it("masks database configuration failures", async () => {
    const databaseUrl = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;

    try {
      const query = encodeURIComponent('{ font(id: "1") { fontFileId } }');
      const response = await GET(request(`${endpoint}?query=${query}`));
      const result = (await response.json()) as {
        errors?: Array<{ message?: string }>;
      };
      const serialized = JSON.stringify(result);

      assert.ok(result.errors?.length);
      assert.equal(result.errors?.[0]?.message, "Unexpected error.");
      assert.doesNotMatch(serialized, /DATABASE_URL|\.env\.local|Neon/i);
      assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    } finally {
      if (databaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = databaseUrl;
      }
    }
  });

  it("serves process health without DATABASE_URL", async () => {
    const databaseUrl = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;

    try {
      const query = encodeURIComponent("{ health { ok service } }");
      const response = await GET(request(`${endpoint}?query=${query}`));
      const result = (await response.json()) as {
        data?: { health?: { ok?: boolean; service?: string } };
      };

      assert.equal(response.status, 200);
      assert.deepEqual(result.data?.health, {
        ok: true,
        service: "sil-ofl-fonts-graphql",
      });
      assert.equal(
        response.headers.get("Cache-Control"),
        "public, s-maxage=60, stale-while-revalidate=300",
      );
      assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
    } finally {
      if (databaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = databaseUrl;
      }
    }
  });

  it("retains same-origin CORS variation on successful GraphQL responses", async () => {
    const query = encodeURIComponent("{ health { ok } }");
    const response = await GET(
      request(`${endpoint}?query=${query}`, {
        headers: {
          Accept: "application/graphql-response+json",
          Origin: "https://fonts.example",
        },
      }),
    );

    assert.equal(response.status, 200);
    assert.equal(
      response.headers.get("Access-Control-Allow-Origin"),
      "https://fonts.example",
    );
    assert.equal(response.headers.get("Access-Control-Allow-Credentials"), "true");
    assert.deepEqual(
      headerTokens(response.headers.get("Vary")),
      new Set(["accept", "content-type", "cookie", "authorization", "origin"]),
    );
  });
});
