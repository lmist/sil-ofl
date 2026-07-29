import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";

const childScript = String.raw`
  const { GET, POST } = await import("./src/app/api/graphql/route.ts");
  const endpoint = "https://fonts.example/api/graphql";
  const capture = async (response) => ({
    status: response.status,
    cacheControl: response.headers.get("Cache-Control"),
    contentType: response.headers.get("Content-Type"),
    body: await response.text(),
  });

  const healthUrl = new URL(endpoint);
  healthUrl.searchParams.set(
    "query",
    "query { health { ok service } }",
  );
  const health = await capture(await GET(new Request(healthUrl, {
    headers: { Accept: "application/graphql-response+json" },
  })));

  const html = await capture(await GET(new Request(endpoint, {
    headers: { Accept: "text/html" },
  })));

  const databaseUrl = new URL(endpoint);
  databaseUrl.searchParams.set(
    "query",
    'query { font(id: "1") { fontFileId } }',
  );
  const database = await capture(await GET(new Request(databaseUrl, {
    headers: { Accept: "application/graphql-response+json" },
  })));

  const variable = await capture(await POST(new Request(endpoint, {
    method: "POST",
    headers: {
      Accept: "application/graphql-response+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: "query ProductionVariable($first: Int!) { fonts(first: $first) { totalCount } }",
      variables: { first: "PRODUCTION_VARIABLE_CANARY" },
    }),
  })));

  process.stdout.write(JSON.stringify({ health, html, database, variable }));
`;

type CapturedResponse = {
  status: number;
  cacheControl: string | null;
  contentType: string | null;
  body: string;
};

describe("production GraphQL privacy and liveness contract", () => {
  it("serves health without a database and keeps production failures private", () => {
    const environment: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_ENV: "production",
      NEXT_PUBLIC_APP_URL: "https://fonts.example",
    };
    delete environment.DATABASE_URL;

    const child = spawnSync(
      process.execPath,
      ["--no-env-file", "-e", childScript],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: environment,
      },
    );
    assert.equal(child.status, 0, child.stderr);
    const responses = JSON.parse(child.stdout) as Record<
      "health" | "html" | "database" | "variable",
      CapturedResponse
    >;

    assert.equal(responses.health.status, 200);
    assert.deepEqual(JSON.parse(responses.health.body), {
      data: {
        health: {
          ok: true,
          service: "sil-ofl-fonts-graphql",
        },
      },
    });
    assert.equal(
      responses.health.cacheControl,
      "public, s-maxage=60, stale-while-revalidate=300",
    );

    assert.equal(responses.html.status, 406);
    assert.match(
      responses.html.contentType ?? "",
      /^application\/graphql-response\+json\b/,
    );
    assert.doesNotMatch(responses.html.body, /GraphiQL|<html/i);

    assert.equal(responses.database.status, 200);
    assert.deepEqual(JSON.parse(responses.database.body), {
      errors: [
        {
          message: "Unexpected error.",
          path: ["font"],
          locations: [{ line: 1, column: 9 }],
          extensions: { code: "INTERNAL_SERVER_ERROR" },
        },
      ],
      data: { font: null },
    });
    assert.doesNotMatch(
      responses.database.body,
      /DATABASE_URL|environment|stack|db\.ts/i,
    );

    assert.equal(responses.variable.status, 400);
    assert.match(
      responses.variable.body,
      /GraphQL variables contain invalid values\./,
    );
    assert.doesNotMatch(
      responses.variable.body,
      /PRODUCTION_VARIABLE_CANARY/,
    );

    for (const response of [
      responses.html,
      responses.database,
      responses.variable,
    ]) {
      assert.equal(response.cacheControl, "private, no-store");
    }
  });
});
