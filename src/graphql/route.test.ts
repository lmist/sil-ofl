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

  it("accepts omitted, empty, null, and object GET extensions", async () => {
    for (const extensions of [
      undefined,
      "",
      "null",
      JSON.stringify({ client: "catalog" }),
    ]) {
      const params = new URLSearchParams({
        query: "{ health { ok } }",
      });
      if (extensions !== undefined) params.set("extensions", extensions);

      const response = await GET(request(`${endpoint}?${params}`));
      const result = (await response.json()) as {
        data?: { health?: { ok?: boolean } };
      };

      assert.equal(response.status, 200, extensions);
      assert.equal(result.data?.health?.ok, true, extensions);
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

  it("rejects malformed and non-object GET extensions before database work", async () => {
    const databaseUrl = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;

    try {
      const invalidExtensions = [
        '{"persistedQuery":',
        "[]",
        JSON.stringify("extension"),
        "1",
        "true",
      ];
      for (const extensions of invalidExtensions) {
        const params = new URLSearchParams({
          query: '{ font(id: "1") { id } }',
          extensions,
        });
        const response = await GET(request(`${endpoint}?${params}`));
        const result = (await response.json()) as {
          errors?: Array<{ message?: string; extensions?: unknown }>;
        };

        assert.equal(response.status, 400, extensions);
        assert.equal(response.headers.get("Cache-Control"), "private, no-store");
        assert.deepEqual(result, {
          errors: [
            {
              message: "GraphQL extensions must be a JSON object or null.",
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

  it("rejects malformed and non-object form POST variables before database work", async () => {
    const databaseUrl = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;

    try {
      const contentTypes = [
        "application/x-www-form-urlencoded; charset=UTF-8",
      ];
      const invalidVariables = [
        '{"id":',
        "[]",
        JSON.stringify("1"),
        "1",
        "true",
      ];
      for (const contentType of contentTypes) {
        for (const variables of invalidVariables) {
          const response = await POST(
            request(endpoint, {
              method: "POST",
              headers: {
                Accept: "application/graphql-response+json",
                "Content-Type": contentType,
              },
              body: new URLSearchParams({
                query: 'query Font($id: ID! = "1") { font(id: $id) { id } }',
                variables,
              }),
            }),
          );
          const result = (await response.json()) as {
            errors?: Array<{ message?: string; extensions?: unknown }>;
          };

          const caseLabel = `${contentType}: ${variables}`;
          assert.equal(response.status, 400, caseLabel);
          assert.equal(
            response.headers.get("Cache-Control"),
            "private, no-store",
            caseLabel,
          );
          assert.deepEqual(
            result,
            {
              errors: [
                {
                  message: "GraphQL variables must be a JSON object or null.",
                },
              ],
            },
            caseLabel,
          );
        }
      }
    } finally {
      if (databaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = databaseUrl;
      }
    }
  });

  it("rejects malformed and non-object form POST extensions before database work", async () => {
    const databaseUrl = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;

    try {
      const contentTypes = ["application/x-www-form-urlencoded"];
      const invalidExtensions = [
        '{"persistedQuery":',
        "[]",
        JSON.stringify("extension"),
        "1",
        "true",
      ];
      for (const contentType of contentTypes) {
        for (const extensions of invalidExtensions) {
          const response = await POST(
            request(endpoint, {
              method: "POST",
              headers: {
                Accept: "application/graphql-response+json",
                "Content-Type": contentType,
              },
              body: new URLSearchParams({
                query: '{ font(id: "1") { id } }',
                extensions,
              }),
            }),
          );
          const result = (await response.json()) as {
            errors?: Array<{ message?: string; extensions?: unknown }>;
          };

          const caseLabel = `${contentType}: ${extensions}`;
          assert.equal(response.status, 400, caseLabel);
          assert.equal(
            response.headers.get("Cache-Control"),
            "private, no-store",
            caseLabel,
          );
          assert.deepEqual(
            result,
            {
              errors: [
                {
                  message: "GraphQL extensions must be a JSON object or null.",
                },
              ],
            },
            caseLabel,
          );
        }
      }
    } finally {
      if (databaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = databaseUrl;
      }
    }
  });

  it("accepts omitted, empty, null, and object form POST parameters", async () => {
    const serializedParameters: Array<Record<string, string>> = [
      {},
      { variables: "", extensions: "" },
      { variables: "null", extensions: "null" },
      {
        variables: JSON.stringify({ unused: 1 }),
        extensions: JSON.stringify({ client: "catalog" }),
      },
    ];

    for (const parameters of serializedParameters) {
      const response = await POST(
        request(endpoint, {
          method: "POST",
          headers: {
            Accept: "application/graphql-response+json",
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            query: "{ health { ok } }",
            ...parameters,
          }),
        }),
      );
      const result = (await response.json()) as {
        data?: { health?: { ok?: boolean } };
      };

      assert.equal(response.status, 200, JSON.stringify(parameters));
      assert.equal(
        result.data?.health?.ok,
        true,
        JSON.stringify(parameters),
      );
      assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    }
  });

  it("normalizes recognized POST media-type case and parameter whitespace", async () => {
    const cases = [
      {
        contentType: "APPLICATION/X-WWW-FORM-URLENCODED",
        body: new URLSearchParams({ query: "{ health { ok } }" }),
      },
      {
        contentType:
          "application/x-www-form-urlencoded ; charset=UTF-8",
        body: new URLSearchParams({ query: "{ health { ok } }" }),
      },
      {
        contentType: "APPLICATION/JSON",
        body: JSON.stringify({ query: "{ health { ok } }" }),
      },
      {
        contentType: "application/json ; charset=UTF-8",
        body: JSON.stringify({ query: "{ health { ok } }" }),
      },
      {
        contentType: 'application/json; charset="UTF-8"',
        body: JSON.stringify({ query: "{ health { ok } }" }),
      },
      {
        contentType: "APPLICATION/GRAPHQL+JSON",
        body: JSON.stringify({ query: "{ health { ok } }" }),
      },
      {
        contentType: "APPLICATION/GRAPHQL",
        body: "{ health { ok } }",
      },
    ];

    for (const { contentType, body } of cases) {
      const response = await POST(
        request(endpoint, {
          method: "POST",
          headers: {
            Accept: "application/graphql-response+json",
            "Content-Type": contentType,
          },
          body,
        }),
      );
      const result = (await response.json()) as {
        data?: { health?: { ok?: boolean } };
      };

      assert.equal(response.status, 200, contentType);
      assert.equal(result.data?.health?.ok, true, contentType);
      assert.equal(
        response.headers.get("Cache-Control"),
        "private, no-store",
        contentType,
      );
    }
  });

  it("rejects missing and unsupported POST media types with negotiated JSON", async () => {
    const cases = [
      {
        label: "missing Content-Type",
        accept: "application/json",
        contentType: null,
      },
      {
        label: "unsupported text/plain",
        accept: "application/graphql-response+json",
        contentType: "text/plain",
      },
    ] as const;

    for (const { label, accept, contentType } of cases) {
      const headers = new Headers({ Accept: accept });
      if (contentType) headers.set("Content-Type", contentType);
      const response = await POST(
        request(endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify({ query: "{ health { ok } }" }),
        }),
      );

      assert.equal(response.status, 415, label);
      assert.equal(
        response.headers.get("Content-Type"),
        `${accept}; charset=utf-8`,
        label,
      );
      assert.deepEqual(
        await response.json(),
        {
          errors: [{ message: "Unsupported GraphQL Content-Type." }],
        },
        label,
      );
      assert.equal(
        response.headers.get("Cache-Control"),
        "private, no-store",
        label,
      );
    }
  });

  it("rejects unsupported POST media types before size checks or body reads", async () => {
    const oversizedResponse = await POST(
      request(endpoint, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Length": "40000",
        },
        body: "{}",
      }),
    );

    assert.equal(oversizedResponse.status, 415);
    assert.equal(
      oversizedResponse.headers.get("Content-Type"),
      "application/json; charset=utf-8",
    );
    assert.deepEqual(await oversizedResponse.json(), {
      errors: [{ message: "Unsupported GraphQL Content-Type." }],
    });
    assert.equal(
      oversizedResponse.headers.get("Cache-Control"),
      "private, no-store",
    );

    let bodyReads = 0;
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          bodyReads += 1;
          controller.error(new Error("unsupported body must not be read"));
        },
      },
      { highWaterMark: 0 },
    );
    const unreadResponse = await POST(
      request(endpoint, {
        method: "POST",
        headers: {
          Accept: "application/graphql-response+json",
          "Content-Type": "text/plain",
        },
        body,
        duplex: "half",
      } as RequestInit),
    );

    assert.equal(bodyReads, 0);
    assert.equal(unreadResponse.status, 415);
    assert.equal(
      unreadResponse.headers.get("Content-Type"),
      "application/graphql-response+json; charset=utf-8",
    );
    assert.deepEqual(await unreadResponse.json(), {
      errors: [{ message: "Unsupported GraphQL Content-Type." }],
    });
    assert.equal(
      unreadResponse.headers.get("Cache-Control"),
      "private, no-store",
    );
  });

  it("rejects combined Content-Type field values instead of choosing the first", async () => {
    for (const contentType of [
      "application/json, application/graphql",
      "application/graphql, application/json",
      "application/json, application/json",
    ]) {
      const response = await POST(
        request(endpoint, {
          method: "POST",
          headers: {
            Accept: "application/graphql-response+json",
            "Content-Type": contentType,
          },
          body: JSON.stringify({ query: "{ health { ok } }" }),
        }),
      );

      assert.equal(response.status, 415, contentType);
      assert.deepEqual(
        await response.json(),
        {
          errors: [{ message: "Unsupported GraphQL Content-Type." }],
        },
        contentType,
      );
    }

    const bridgedHeaders = new Headers({
      Accept: "application/graphql-response+json",
    });
    bridgedHeaders.append("Content-Type", 'application/json;profile="left');
    bridgedHeaders.append(
      "Content-Type",
      'application/graphql;profile=right"',
    );
    const bridgedResponse = await POST(
      request(endpoint, {
        method: "POST",
        headers: bridgedHeaders,
        body: JSON.stringify({ query: "{ health { ok } }" }),
      }),
    );

    assert.equal(bridgedResponse.status, 415);
    assert.deepEqual(await bridgedResponse.json(), {
      errors: [{ message: "Unsupported GraphQL Content-Type." }],
    });
  });

  it("rejects unsupported GraphQL Content-Type parameters", async () => {
    const response = await POST(
      request(endpoint, {
        method: "POST",
        headers: {
          Accept: "application/graphql-response+json",
          "Content-Type": 'application/json; profile="catalog"',
        },
        body: JSON.stringify({ query: "{ health { ok } }" }),
      }),
    );

    assert.equal(response.status, 415);
    assert.deepEqual(await response.json(), {
      errors: [{ message: "Unsupported GraphQL Content-Type." }],
    });
  });

  it("rejects explicit non-UTF-8 GraphQL request charsets", async () => {
    const cases = [
      {
        contentType:
          "application/x-www-form-urlencoded; charset=iso-8859-1",
        body: "query=%7B%20health%20%7B%20ok%20%7D%20%7D&variables=%7B%22unused%22%3A%22%E9%22%7D",
      },
      {
        contentType: 'application/json; charset="utf-16"',
        body: JSON.stringify({ query: "{ health { ok } }" }),
      },
    ];

    for (const { contentType, body } of cases) {
      const response = await POST(
        request(endpoint, {
          method: "POST",
          headers: {
            Accept: "application/graphql-response+json",
            "Content-Type": contentType,
          },
          body,
        }),
      );

      assert.equal(response.status, 415, contentType);
      assert.deepEqual(
        await response.json(),
        {
          errors: [{ message: "Unsupported GraphQL Content-Type." }],
        },
        contentType,
      );
    }
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

  it("applies JSON response negotiation before early request validation errors", async () => {
    const unsupportedAccept = "text/event-stream";
    const cases: Array<{
      label: string;
      send: () => Promise<Response>;
    }> = [
      {
        label: "malformed GET variables",
        send: () =>
          GET(
            request(
              `${endpoint}?${new URLSearchParams({
                query: "{ health { ok } }",
                variables: "{",
              })}`,
              { headers: { Accept: unsupportedAccept } },
            ),
          ),
      },
      {
        label: "oversized GET parameters",
        send: () =>
          GET(
            request(
              `${endpoint}?${new URLSearchParams({
                query: `{ health { ok } } # ${"x".repeat(70_000)}`,
              })}`,
              { headers: { Accept: unsupportedAccept } },
            ),
          ),
      },
      {
        label: "malformed form variables",
        send: () =>
          POST(
            request(endpoint, {
              method: "POST",
              headers: {
                Accept: unsupportedAccept,
                "Content-Type": "application/x-www-form-urlencoded",
              },
              body: new URLSearchParams({
                query: "{ health { ok } }",
                variables: "{",
              }),
            }),
          ),
      },
      {
        label: "oversized POST body",
        send: () =>
          POST(
            request(endpoint, {
              method: "POST",
              headers: {
                Accept: unsupportedAccept,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                query: `{ health { ok } } # ${"x".repeat(70_000)}`,
              }),
            }),
          ),
      },
    ];

    for (const { label, send } of cases) {
      const response = await send();
      assert.equal(response.status, 406, label);
      assert.deepEqual(
        await response.json(),
        {
          errors: [
            {
              message: "Only JSON GraphQL responses are supported.",
            },
          ],
        },
        label,
      );
    }
  });

  it("uses the selected JSON representation for early GraphQL errors", async () => {
    const cases: Array<{
      expectedStatus: number;
      label: string;
      send: () => Promise<Response>;
    }> = [
      {
        expectedStatus: 400,
        label: "malformed GET variables",
        send: () =>
          GET(
            request(
              `${endpoint}?${new URLSearchParams({
                query: "{ health { ok } }",
                variables: "{",
              })}`,
              { headers: { Accept: "application/json" } },
            ),
          ),
      },
      {
        expectedStatus: 413,
        label: "oversized GET parameters",
        send: () =>
          GET(
            request(
              `${endpoint}?${new URLSearchParams({
                query: `{ health { ok } } # ${"x".repeat(70_000)}`,
              })}`,
              { headers: { Accept: "application/json" } },
            ),
          ),
      },
      {
        expectedStatus: 415,
        label: "unsupported POST charset",
        send: () =>
          POST(
            request(endpoint, {
              method: "POST",
              headers: {
                Accept: "application/json",
                "Content-Type": "application/json; charset=utf-16",
              },
              body: JSON.stringify({ query: "{ health { ok } }" }),
            }),
          ),
      },
    ];

    for (const { expectedStatus, label, send } of cases) {
      const response = await send();
      assert.equal(response.status, expectedStatus, label);
      assert.equal(
        response.headers.get("Content-Type"),
        "application/json; charset=utf-8",
        label,
      );
      assert.equal(
        response.headers.get("Cache-Control"),
        "private, no-store",
        label,
      );
    }
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

  it("bounds repeated fragment DAG traversal before resolver work", async () => {
    const databaseUrl = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;

    try {
      const fragmentDepth = 12;
      const fragments = Array.from(
        { length: fragmentDepth },
        (_, index) => `
          fragment BudgetFragment${index} on Query {
            ...BudgetFragment${index + 1}
            ...BudgetFragment${index + 1}
          }
        `,
      );
      fragments.push(`
        fragment BudgetFragment${fragmentDepth} on Query {
          ...MissingBudgetLeaf
        }
      `);
      const params = new URLSearchParams({
        query: `
          query FragmentDagBudget {
            fonts(first: 1) { totalCount }
            ...BudgetFragment0
          }
          ${fragments.join("\n")}
        `,
      });
      const response = await GET(
        request(`${endpoint}?${params}`, {
          headers: { Accept: "application/graphql-response+json" },
        }),
      );
      const result = (await response.json()) as {
        errors?: Array<{
          message?: string;
          extensions?: { code?: string };
        }>;
      };

      assert.equal(response.status, 400);
      assert.ok(
        result.errors?.some(
          (error) =>
            error.extensions?.code === "OPERATION_BUDGET_EXCEEDED" &&
            error.message === "GraphQL operation exceeds request budget.",
        ),
      );
      assert.doesNotMatch(JSON.stringify(result), /DATABASE_URL|Neon/i);
      assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    } finally {
      if (databaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = databaseUrl;
      }
    }
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

  it("does not reflect invalid GraphQL variable names or values in any negotiated encoding", async () => {
    const privateMarker = "private-variable-marker-7d2ca3";
    const query = `
      query InvalidPageSize($first: Int!) {
        fonts(first: $first) { totalCount }
      }
    `;
    const requiredVariableCanary = "SENSITIVE_REQUIRED_VARIABLE_CANARY";
    const requiredVariableQuery =
      `query Required($${requiredVariableCanary}: Int!) { ` +
      `fonts(first: $${requiredVariableCanary}) { totalCount } }`;

    for (const method of ["GET", "POST"] as const) {
      for (const accept of [
        "application/json",
        "application/graphql-response+json",
      ]) {
        for (const variables of [
          {},
          { [requiredVariableCanary]: null },
        ]) {
          const response =
            method === "GET"
              ? await GET(
                  request(
                    `${endpoint}?${new URLSearchParams({
                      query: requiredVariableQuery,
                      variables: JSON.stringify(variables),
                    })}`,
                    { headers: { Accept: accept } },
                  ),
                )
              : await POST(
                  request(endpoint, {
                    method: "POST",
                    headers: {
                      Accept: accept,
                      "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                      query: requiredVariableQuery,
                      variables,
                    }),
                  }),
                );
          const serialized = await response.text();
          const result = JSON.parse(serialized) as {
            errors?: Array<{
              message?: string;
              extensions?: { code?: string };
            }>;
          };
          const caseLabel = `${method} ${accept} ${JSON.stringify(variables)}`;

          assert.equal(response.status, 400, caseLabel);
          assert.doesNotMatch(
            serialized,
            new RegExp(requiredVariableCanary),
            caseLabel,
          );
          assert.equal(
            result.errors?.[0]?.message,
            "GraphQL variables contain invalid values.",
            caseLabel,
          );
          assert.equal(
            result.errors?.[0]?.extensions?.code,
            "BAD_USER_INPUT",
            caseLabel,
          );
          assert.equal(
            response.headers.get("Cache-Control"),
            "private, no-store",
            caseLabel,
          );
        }
      }
    }

    const acceptCases = [
      {
        accept: "application/graphql-response+json",
        status: 400,
        mediaType: "application/graphql-response+json",
      },
      {
        accept: "application/json",
        status: 400,
        mediaType: "application/json",
      },
      {
        accept: 'application/json;charset="utf-8"',
        status: 400,
        mediaType: "application/json",
      },
      {
        accept: "application/*",
        status: 400,
        mediaType: "application/graphql-response+json",
      },
      {
        accept: "text/event-stream, application/graphql-response+json;q=0.5",
        status: 400,
        mediaType: "application/graphql-response+json",
      },
      {
        accept: "text/*, application/*",
        status: 400,
        mediaType: "application/graphql-response+json",
      },
      {
        accept: "text/html, application/json",
        status: 400,
        mediaType: "application/json",
      },
      {
        accept:
          "application/graphql-response+json;q=0, application/json;q=1",
        status: 400,
        mediaType: "application/json",
      },
      {
        accept:
          "application/graphql-response+json;q=0.4, application/json;q=0.8",
        status: 400,
        mediaType: "application/json",
      },
      { accept: "text/event-stream", status: 406 },
      { accept: "multipart/mixed", status: 406 },
      { accept: "text/event-stream;q=0", status: 406 },
      { accept: "multipart/mixed;q=0.000", status: 406 },
      { accept: "text/*", status: 406 },
      { accept: "multipart/*", status: 406 },
      { accept: "text / event-stream", status: 406 },
      { accept: "text/ event-stream", status: 406 },
      { accept: "text/event - stream", status: 406 },
      { accept: "multipart / mixed", status: 406 },
      { accept: "text/html", status: 406 },
      { accept: "application/graphql-response+json;q=0", status: 406 },
      { accept: "application/json;q=0", status: 406 },
      { accept: "*/*;q=0", status: 406 },
    ];

    for (const method of ["GET", "POST"] as const) {
      for (const { accept, status, mediaType } of acceptCases) {
        const response =
          method === "GET"
            ? await GET(
                request(
                  `${endpoint}?${new URLSearchParams({
                    query,
                    variables: JSON.stringify({ first: privateMarker }),
                  })}`,
                  { headers: { Accept: accept } },
                ),
              )
            : await POST(
                request(endpoint, {
                  method: "POST",
                  headers: {
                    Accept: accept,
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({
                    query,
                    variables: { first: privateMarker },
                  }),
                }),
              );
        const serialized = await response.text();
        const caseLabel = `${method} ${accept}`;

        assert.equal(response.status, status, caseLabel);
        assert.doesNotMatch(
          serialized,
          new RegExp(privateMarker),
          caseLabel,
        );
        assert.match(
          response.headers.get("Content-Type") ?? "",
          /^(?:application\/graphql-response\+json|application\/json)\b/i,
          caseLabel,
        );
        if (mediaType) {
          assert.equal(
            response.headers.get("Content-Type")?.split(";")[0],
            mediaType,
            caseLabel,
          );
        }
        const expected =
          status === 400
            ? {
                errors: [
                  {
                    message: "GraphQL variables contain invalid values.",
                    locations: [{ line: 2, column: 29 }],
                    extensions: { code: "BAD_USER_INPUT" },
                  },
                ],
              }
            : {
                errors: [
                  {
                    message: "Only JSON GraphQL responses are supported.",
                  },
                ],
              };
        assert.deepEqual(JSON.parse(serialized), expected, caseLabel);
        assert.equal(
          response.headers.get("Cache-Control"),
          "private, no-store",
          caseLabel,
        );
      }
    }
  });

  it("does not reflect submitted document tokens in parse or validation errors", async () => {
    const cases = [
      {
        query: "query { SENSITIVE_VALIDATION_CANARY }",
        canary: "SENSITIVE_VALIDATION_CANARY",
        code: "GRAPHQL_VALIDATION_FAILED",
        message: "GraphQL operation is invalid.",
      },
      {
        query:
          "query { health { ok } } SENSITIVE_PARSE_CANARY",
        canary: "SENSITIVE_PARSE_CANARY",
        code: "GRAPHQL_PARSE_FAILED",
        message: "GraphQL document is invalid.",
      },
    ] as const;

    for (const method of ["GET", "POST"] as const) {
      for (const accept of [
        "application/json",
        "application/graphql-response+json",
      ]) {
        for (const testCase of cases) {
          const response =
            method === "GET"
              ? await GET(
                  request(
                    `${endpoint}?${new URLSearchParams({
                      query: testCase.query,
                    })}`,
                    { headers: { Accept: accept } },
                  ),
                )
              : await POST(
                  request(endpoint, {
                    method: "POST",
                    headers: {
                      Accept: accept,
                      "Content-Type": "application/json",
                    },
                    body: JSON.stringify({ query: testCase.query }),
                  }),
                );
          const serialized = await response.text();
          const result = JSON.parse(serialized) as {
            errors?: Array<{
              message?: string;
              extensions?: { code?: string };
            }>;
          };
          const label = `${method} ${accept} ${testCase.code}`;

          assert.equal(
            response.status,
            accept === "application/json" ? 200 : 400,
            label,
          );
          assert.doesNotMatch(serialized, new RegExp(testCase.canary), label);
          assert.equal(result.errors?.[0]?.message, testCase.message, label);
          assert.equal(
            result.errors?.[0]?.extensions?.code,
            testCase.code,
            label,
          );
          assert.equal(
            response.headers.get("Cache-Control"),
            "private, no-store",
            label,
          );
        }
      }
    }
  });

  it("requires JSON negotiation for a bare non-GraphiQL GET", async () => {
    const response = await GET(
      request(endpoint, {
        headers: { Accept: "text/*" },
      }),
    );

    assert.equal(response.status, 406);
    assert.deepEqual(await response.json(), {
      errors: [
        {
          message: "Only JSON GraphQL responses are supported.",
        },
      ],
    });
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  });

  it("does not split an Accept list at commas inside quoted parameters", async () => {
    const query = encodeURIComponent("{ health { ok } }");
    const response = await GET(
      request(`${endpoint}?query=${query}`, {
        headers: {
          Accept: 'application/json;profile="x,y";q=0',
        },
      }),
    );

    assert.equal(response.status, 406);
    assert.deepEqual(await response.json(), {
      errors: [
        {
          message: "Only JSON GraphQL responses are supported.",
        },
      ],
    });
  });

  it("honors a more specific media-parameter exclusion over a generic range", async () => {
    const query = encodeURIComponent("{ health { ok } }");
    for (const accept of [
      "application/json; charset=utf-8;q=0, application/json;q=1",
      "application/*;charset=utf-8;q=1, application/json;q=0, application/graphql-response+json;q=0",
    ]) {
      const response = await GET(
        request(`${endpoint}?query=${query}`, {
          headers: { Accept: accept },
        }),
      );

      assert.equal(response.status, 406, accept);
      assert.deepEqual(
        await response.json(),
        {
          errors: [
            {
              message: "Only JSON GraphQL responses are supported.",
            },
          ],
        },
        accept,
      );
    }
  });

  it("keeps media parameters after q in Accept representation matching", async () => {
    const query = encodeURIComponent("{ health { ok } }");
    for (const accept of [
      "application/json;q=0;charset=utf-8, application/json;q=1, application/graphql-response+json;q=0",
      "application/json;q=1;charset=iso-8859-1, application/graphql-response+json;q=0",
    ]) {
      const response = await GET(
        request(`${endpoint}?query=${query}`, {
          headers: { Accept: accept },
        }),
      );

      assert.equal(response.status, 406, accept);
      assert.deepEqual(
        await response.json(),
        {
          errors: [
            {
              message: "Only JSON GraphQL responses are supported.",
            },
          ],
        },
        accept,
      );
    }
  });

  it("rejects syntactically invalid Accept media ranges", async () => {
    const query = encodeURIComponent("{ health { ok } }");

    for (const accept of [
      "*/json",
      "*/graphql-response+json",
      "application / json",
    ]) {
      const response = await GET(
        request(`${endpoint}?query=${query}`, {
          headers: { Accept: accept },
        }),
      );

      assert.equal(response.status, 406, accept);
      assert.deepEqual(
        await response.json(),
        {
          errors: [
            {
              message: "Only JSON GraphQL responses are supported.",
            },
          ],
        },
        accept,
      );
    }
  });

  it("normalizes only HTTP OWS in Accept ranges and parameters", async () => {
    const query = encodeURIComponent("{ health { ok } }");
    for (const accept of [
      "\u00a0application/json",
      "application/json;\u00a0q=1",
    ]) {
      const response = await GET(
        request(`${endpoint}?query=${query}`, {
          headers: { Accept: accept },
        }),
      );
      assert.equal(response.status, 406, JSON.stringify(accept));
    }

    const response = await GET(
      request(`${endpoint}?query=${query}`, {
        headers: { Accept: " \tapplication/json \t; \tq=1" },
      }),
    );
    const result = (await response.json()) as {
      data?: { health?: { ok?: boolean } };
    };
    assert.equal(response.status, 200);
    assert.equal(result.data?.health?.ok, true);
  });

  it("accepts empty HTTP parameter slots but rejects malformed parameters", async () => {
    const query = encodeURIComponent("{ health { ok } }");
    for (const accept of [
      "application/json;",
      "application/json;;",
      "application/json;;q=1;",
    ]) {
      const response = await GET(
        request(`${endpoint}?query=${query}`, {
          headers: { Accept: accept },
        }),
      );
      const result = (await response.json()) as {
        data?: { health?: { ok?: boolean } };
      };
      assert.equal(response.status, 200, accept);
      assert.equal(result.data?.health?.ok, true, accept);
    }

    const malformedAcceptResponse = await GET(
      request(`${endpoint}?query=${query}`, {
        headers: { Accept: "application/json;=broken" },
      }),
    );
    assert.equal(malformedAcceptResponse.status, 406);

    for (const contentType of [
      "application/json;",
      "application/json;; charset=UTF-8;",
    ]) {
      const response = await POST(
        request(endpoint, {
          method: "POST",
          headers: {
            Accept: "application/graphql-response+json",
            "Content-Type": contentType,
          },
          body: JSON.stringify({ query: "{ health { ok } }" }),
        }),
      );
      const result = (await response.json()) as {
        data?: { health?: { ok?: boolean } };
      };
      assert.equal(response.status, 200, contentType);
      assert.equal(result.data?.health?.ok, true, contentType);
    }

    const malformedContentTypeResponse = await POST(
      request(endpoint, {
        method: "POST",
        headers: {
          Accept: "application/graphql-response+json",
          "Content-Type": "application/json;=broken",
        },
        body: JSON.stringify({ query: "{ health { ok } }" }),
      }),
    );
    assert.equal(malformedContentTypeResponse.status, 415);
  });

  it("rejects quoted Accept quality values for JSON and GraphiQL", async () => {
    const query = encodeURIComponent("{ health { ok } }");
    const requests = [
      request(`${endpoint}?query=${query}`, {
        headers: { Accept: 'application/json;q="1"' },
      }),
      request(endpoint, {
        headers: { Accept: 'text/html;q="1"' },
      }),
    ];

    for (const invalidRequest of requests) {
      const response = await GET(invalidRequest);
      assert.equal(
        response.status,
        406,
        invalidRequest.headers.get("Accept") ?? "missing Accept",
      );
      assert.deepEqual(await response.json(), {
        errors: [
          {
            message: "Only JSON GraphQL responses are supported.",
          },
        ],
      });
    }
  });

  it("rejects whitespace around the Accept quality equals sign", async () => {
    const query = encodeURIComponent("{ health { ok } }");
    const malformedVariables = new URLSearchParams({
      query: "{ health { ok } }",
      variables: "{",
    });
    const requests = [
      request(`${endpoint}?query=${query}`, {
        headers: { Accept: "application/json; q = 1" },
      }),
      request(endpoint, {
        headers: { Accept: "text/html; q = 1" },
      }),
      request(`${endpoint}?${malformedVariables}`, {
        headers: {
          Accept: "text/event-stream, application/json; q = 1",
        },
      }),
    ];

    for (const invalidRequest of requests) {
      const response = await GET(invalidRequest);
      assert.equal(
        response.status,
        406,
        invalidRequest.headers.get("Accept") ?? "missing Accept",
      );
      assert.deepEqual(await response.json(), {
        errors: [
          {
            message: "Only JSON GraphQL responses are supported.",
          },
        ],
      });
    }
  });

  it("preserves the non-production GraphiQL HTML entry point", async () => {
    const response = await GET(
      request(endpoint, {
        headers: { Accept: "text/html" },
      }),
    );
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(response.headers.get("Content-Type") ?? "", /^text\/html\b/);
    assert.match(html, /GraphiQL/);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  });

  it("negotiates the development GraphiQL entry point as an HTML representation", async () => {
    const excludedHtmlResponse = await GET(
      request(endpoint, {
        headers: { Accept: "text/html;q=0" },
      }),
    );
    assert.equal(excludedHtmlResponse.status, 406);

    const uppercaseHtmlResponse = await GET(
      request(endpoint, {
        headers: { Accept: "TEXT/HTML" },
      }),
    );
    assert.equal(uppercaseHtmlResponse.status, 200);
    assert.match(
      uppercaseHtmlResponse.headers.get("Content-Type") ?? "",
      /^text\/html\b/,
    );
    assert.match(await uppercaseHtmlResponse.text(), /GraphiQL/);

    const quotedSubstringResponse = await GET(
      request(endpoint, {
        headers: {
          Accept: 'application/json;profile="text/html"',
        },
      }),
    );
    assert.equal(quotedSubstringResponse.status, 406);
    assert.match(
      quotedSubstringResponse.headers.get("Content-Type") ?? "",
      /^application\/graphql-response\+json\b/,
    );
  });

  it("declares the negotiated UTF-8 GraphiQL representation", async () => {
    const acceptedResponse = await GET(
      request(endpoint, {
        headers: { Accept: "text/html;charset=utf-8" },
      }),
    );
    assert.equal(acceptedResponse.status, 200);
    assert.equal(
      acceptedResponse.headers.get("Content-Type"),
      "text/html; charset=utf-8",
    );
    assert.match(await acceptedResponse.text(), /GraphiQL/);

    const excludedResponse = await GET(
      request(endpoint, {
        headers: {
          Accept: "text/html;charset=utf-8;q=0, text/html;q=1",
        },
      }),
    );
    assert.equal(excludedResponse.status, 406);
  });

  it("selects the highest-quality bare development representation", async () => {
    const cases = [
      {
        accept: "application/json;q=1, text/html;q=0.1",
        mediaType: "application/json",
        graphiql: false,
      },
      {
        accept: "application/json;q=0.1, text/html;q=1",
        mediaType: "text/html",
        graphiql: true,
      },
      {
        accept: "application/json;q=1, text/html;q=1",
        mediaType: "text/html",
        graphiql: true,
      },
    ];

    for (const { accept, graphiql, mediaType } of cases) {
      const response = await GET(
        request(endpoint, {
          headers: { Accept: accept },
        }),
      );
      const body = await response.text();

      assert.equal(response.status, 200, accept);
      assert.equal(
        response.headers.get("Content-Type")?.split(";")[0],
        mediaType,
        accept,
      );
      if (graphiql) {
        assert.match(body, /GraphiQL/, accept);
      } else {
        assert.doesNotMatch(body, /GraphiQL/, accept);
        assert.deepEqual(JSON.parse(body), {
          errors: [
            {
              message: "Must provide query string.",
              extensions: { code: "BAD_REQUEST" },
            },
          ],
        });
      }
    }
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
