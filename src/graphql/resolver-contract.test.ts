import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { graphql } from "graphql";
import { schema } from "@/graphql/schema";
import {
  encodeFontCursor,
  encodeRepoCursor,
} from "@/graphql/schema/cursor";

type SqlCall = {
  text: string;
  params: unknown[];
};

describe("GraphQL resolver SQL contracts", () => {
  it("rejects malformed database-bound text before SQL access", async () => {
    const invalidTextValues = [
      { label: "NUL", value: "bad\0text" },
      { label: "lone high surrogate", value: String.fromCharCode(0xd800) },
      { label: "lone low surrogate", value: String.fromCharCode(0xdc00) },
      {
        label: "high surrogate followed by ASCII",
        value: `${String.fromCharCode(0xd800)}x`,
      },
      {
        label: "ASCII followed by low surrogate",
        value: `x${String.fromCharCode(0xdc00)}`,
      },
      {
        label: "reversed surrogate pair",
        value: String.fromCharCode(0xdc00, 0xd800),
      },
    ];
    const operations = [
      {
        label: "FontFilter.q",
        source:
          "query InvalidText($value: String) { fonts(filter: { q: $value }, first: 1) { totalCount } }",
      },
      {
        label: "FontFilter.owner",
        source:
          "query InvalidText($value: String) { fonts(filter: { owner: $value }, first: 1) { totalCount } }",
      },
      {
        label: "FontFilter.format",
        source:
          "query InvalidText($value: String!) { fonts(filter: { format: [$value] }, first: 1) { totalCount } }",
      },
      {
        label: "RepoFilter.q",
        source:
          "query InvalidText($value: String) { repos(filter: { q: $value }, first: 1) { totalCount } }",
      },
      {
        label: "RepoFilter.owner",
        source:
          "query InvalidText($value: String) { repos(filter: { owner: $value }, first: 1) { totalCount } }",
      },
      {
        label: "repo.owner",
        source:
          'query InvalidText($value: String!) { repo(owner: $value, name: "repo") { id } }',
      },
      {
        label: "repo.name",
        source:
          'query InvalidText($value: String!) { repo(owner: "owner", name: $value) { id } }',
      },
    ];

    for (const operation of operations) {
      for (const invalid of invalidTextValues) {
        const capture = createSqlCapture();
        const result = await graphql({
          schema,
          source: operation.source,
          variableValues: { value: invalid.value },
          contextValue: capture.contextValue,
        });

        assert.equal(
          capture.sqlAccesses,
          0,
          `${operation.label} ${invalid.label} must not access SQL`,
        );
        assert.equal(capture.calls.length, 0);
        assert.equal(
          result.errors?.[0]?.extensions.code,
          "BAD_USER_INPUT",
          `${operation.label} ${invalid.label} must be client input`,
        );
        assert.equal(
          result.errors?.[0]?.message,
          `${operation.label} must be valid Unicode text without NUL characters`,
        );
      }
    }
  });

  it("preserves valid database text, format case normalization, and empty filters", async () => {
    const validText = `Alpha${String.fromCharCode(1, 31, 127)}😀\uffff`;
    const populated = createSqlCapture();
    const populatedResult = await graphql({
      schema,
      source: `query ValidText($filter: FontFilter) {
        fonts(filter: $filter, first: 1) { totalCount }
      }`,
      variableValues: {
        filter: {
          q: validText,
          owner: validText,
          format: ["TTF", "Woff2"],
          minStars: 0,
        },
      },
      contextValue: populated.contextValue,
    });

    assert.equal(populatedResult.errors, undefined);
    assert.equal(populated.sqlAccesses, 1);
    assert.deepEqual(populated.queryCalls[0]?.params, [
      0,
      validText,
      ["ttf", "woff2"],
      `%${validText}%`,
      2,
    ]);

    const empty = createSqlCapture();
    const emptyResult = await graphql({
      schema,
      source: `query EmptyFilters($filter: FontFilter) {
        fonts(filter: $filter, first: 1) { totalCount }
      }`,
      variableValues: {
        filter: {
          q: null,
          owner: null,
          format: [],
          minStars: null,
        },
      },
      contextValue: empty.contextValue,
    });

    assert.equal(emptyResult.errors, undefined);
    assert.equal(empty.sqlAccesses, 1);
    assert.deepEqual(empty.queryCalls[0]?.params, [0, 2]);
  });

  it("rejects negative star filters before SQL access", async () => {
    for (const field of ["fonts", "repos"] as const) {
      const capture = createSqlCapture();
      const result = await graphql({
        schema,
        source: `query NegativeStars($filter: ${
          field === "fonts" ? "FontFilter" : "RepoFilter"
        }) {
          ${field}(filter: $filter, first: 1) { totalCount }
        }`,
        variableValues: { filter: { minStars: -1 } },
        contextValue: capture.contextValue,
      });

      assert.equal(capture.sqlAccesses, 0);
      assert.equal(capture.calls.length, 0);
      assert.equal(result.errors?.[0]?.extensions.code, "BAD_USER_INPUT");
      assert.equal(
        result.errors?.[0]?.message,
        "minStars must be a nonnegative integer",
      );
    }
  });

  it("rejects unsupported font formats before SQL access", async () => {
    for (const format of ["png", "ttc", "", " ttf "]) {
      const capture = createSqlCapture();
      const result = await graphql({
        schema,
        source: `query InvalidFormat($filter: FontFilter) {
          fonts(filter: $filter, first: 1) { totalCount }
        }`,
        variableValues: { filter: { format: [format] } },
        contextValue: capture.contextValue,
      });

      assert.equal(capture.sqlAccesses, 0);
      assert.equal(capture.calls.length, 0);
      assert.equal(result.errors?.[0]?.extensions.code, "BAD_USER_INPUT");
      assert.equal(
        result.errors?.[0]?.message,
        "format must contain only ttf, otf, woff, or woff2",
      );
    }
  });

  it("uses the OFL-only public predicate for font rows and totalCount", async () => {
    const { contextValue, queryCalls } = createSqlCapture();

    const result = await graphql({
      schema,
      source: `{
        fonts(first: 1) {
          totalCount
          edges { cursor }
        }
      }`,
      contextValue,
    });

    assert.equal(result.errors, undefined);
    const data = result.data as
      | { fonts: { totalCount: number; edges: unknown[] } }
      | undefined;
    assert.equal(data?.fonts.totalCount, 0);
    assert.deepEqual(data?.fonts.edges, []);
    assert.equal(queryCalls.length, 2);

    const count = queryCalls.find((call) =>
      call.text.startsWith("SELECT COUNT(*)::int AS total"),
    );
    const list = queryCalls.find((call) => call !== count);
    assert.ok(list);
    assert.ok(count);

    const expectedWhere = [
      "NOT r.is_archived",
      "r.is_fontish",
      "NOT r.is_fork",
      "f.format IN ('ttf', 'otf', 'woff', 'woff2')",
      "r.license_spdx IN ('OFL-1.0', 'OFL-1.1')",
      "r.stars >= $1",
    ].join(" AND ");

    assert.equal(whereClauseOf(list.text), expectedWhere);
    assert.equal(whereClauseOf(count.text), expectedWhere);
    assert.deepEqual(list.params, [0, 2]);
    assert.deepEqual(count.params, [0]);
  });

  it("uses the same OFL-only public predicate for font detail", async () => {
    const { contextValue, calls } = createSqlCapture();

    const result = await graphql({
      schema,
      source: `query FontContract($id: ID!) {
        font(id: $id) { id }
      }`,
      variableValues: { id: "1" },
      contextValue,
    });

    assert.equal(result.errors, undefined);
    assert.equal((result.data as { font?: unknown } | undefined)?.font, null);
    assert.equal(calls.length, 1);
    assert.equal(
      whereClauseOf(calls[0]!.text),
      [
        "f.id = $1",
        "NOT r.is_archived",
        "r.is_fontish",
        "NOT r.is_fork",
        "f.format IN ('ttf', 'otf', 'woff', 'woff2')",
        "r.license_spdx IN ('OFL-1.0', 'OFL-1.1')",
      ].join(" AND "),
    );
    assert.deepEqual(calls[0]!.params, [1]);
  });

  it("uses the shared public repository predicate for rows and totalCount", async () => {
    const { contextValue, queryCalls } = createSqlCapture();

    const result = await graphql({
      schema,
      source: `{
        repos(first: 1) {
          totalCount
          edges { cursor }
        }
      }`,
      contextValue,
    });

    assert.equal(result.errors, undefined);
    assert.equal(queryCalls.length, 2);
    const count = queryCalls.find((call) =>
      call.text.startsWith("SELECT COUNT(*)::int AS total"),
    );
    const list = queryCalls.find((call) => call !== count);
    assert.ok(list);
    assert.ok(count);

    const expectedWhere = [
      "NOT r.is_archived",
      "r.is_fontish",
      "NOT r.is_fork",
      "r.license_spdx IN ('OFL-1.0', 'OFL-1.1')",
      "r.stars >= $1",
    ].join(" AND ");

    assert.equal(repoWhereClauseOf(list.text), expectedWhere);
    assert.equal(whereClauseOf(count.text), expectedWhere);
    assert.deepEqual(list.params, [0, 2]);
    assert.deepEqual(count.params, [0]);
  });

  it("uses the same public repository predicate for repo detail", async () => {
    const { contextValue, calls } = createSqlCapture();

    const result = await graphql({
      schema,
      source: `{
        repo(owner: "owner", name: "repo") { id }
      }`,
      contextValue,
    });

    assert.equal(result.errors, undefined);
    assert.equal((result.data as { repo?: unknown } | undefined)?.repo, null);
    assert.equal(calls.length, 1);
    assert.equal(
      repoWhereClauseOf(calls[0]!.text),
      [
        "r.full_name = $1",
        "NOT r.is_archived",
        "r.is_fontish",
        "NOT r.is_fork",
        "r.license_spdx IN ('OFL-1.0', 'OFL-1.1')",
      ].join(" AND "),
    );
    assert.deepEqual(calls[0]!.params, ["owner/repo"]);
  });

  it("defines repository font membership by publicly renderable files", async () => {
    const renderableFontSubquery =
      "SELECT 1 FROM font_files ff WHERE ff.repo_id = r.id AND ff.format IN ('ttf', 'otf', 'woff', 'woff2')";
    const renderableFontCount =
      "SELECT COUNT(*)::int FROM font_files ff WHERE ff.repo_id = r.id AND ff.format IN ('ttf', 'otf', 'woff', 'woff2')";

    for (const withFonts of [true, false]) {
      const { contextValue, queryCalls } = createSqlCapture();
      const result = await graphql({
        schema,
        source: `query RepoFonts($filter: RepoFilter) {
          repos(filter: $filter, first: 1) { totalCount }
        }`,
        variableValues: { filter: { withFonts } },
        contextValue,
      });

      assert.equal(result.errors, undefined);
      const count = queryCalls.find((call) =>
        call.text.startsWith("SELECT COUNT(*)::int AS total"),
      );
      const list = queryCalls.find((call) => call !== count);
      assert.ok(list);
      assert.ok(count);

      const membership = `${withFonts ? "" : "NOT "}EXISTS (${renderableFontSubquery})`;
      assert.ok(repoWhereClauseOf(list.text).endsWith(membership));
      assert.ok(whereClauseOf(count.text).endsWith(membership));
      assert.ok(list.text.includes(`COALESCE( (${renderableFontCount}), 0 )`));
    }

    const detail = createSqlCapture();
    const result = await graphql({
      schema,
      source: `{ repo(owner: "owner", name: "repo") { fontCount } }`,
      contextValue: detail.contextValue,
    });

    assert.equal(result.errors, undefined);
    assert.ok(
      detail.calls[0]!.text.includes(`COALESCE( (${renderableFontCount}), 0 )`),
    );
  });

  it("keeps active filters identical between edges and totalCount", async () => {
    const fontCapture = createSqlCapture();
    const fontResult = await graphql({
      schema,
      source: `query FilterParity(
        $filter: FontFilter
        $after: String
      ) {
        fonts(
          filter: $filter
          sort: FAMILY_ASC
          first: 1
          after: $after
        ) { totalCount }
      }`,
      variableValues: {
        filter: {
          q: "Alpha",
          owner: "owner",
          format: ["ttf"],
          minStars: 3,
          webfont: false,
          variable: true,
        },
        after: encodeFontCursor({
          v: 2,
          rep: 1,
          stars: 2,
          family: "Alpha",
          id: 41,
        }),
      },
      contextValue: fontCapture.contextValue,
    });
    assert.equal(fontResult.errors, undefined);
    assertListAndCountParity(
      fontCapture.queryCalls,
      "(f.family_guess > $5 OR (f.family_guess = $5 AND f.id > $6) OR f.family_guess IS NULL)",
    );

    const repoCapture = createSqlCapture();
    const repoResult = await graphql({
      schema,
      source: `query FilterParity(
        $filter: RepoFilter
        $after: String
      ) {
        repos(filter: $filter, first: 1, after: $after) { totalCount }
      }`,
      variableValues: {
        filter: {
          q: "Alpha",
          owner: "owner",
          minStars: 3,
          withFonts: true,
        },
        after: encodeRepoCursor({
          v: 1,
          rep: 9,
          stars: 2,
          name: "owner/repo",
          id: 41,
        }),
      },
      contextValue: repoCapture.contextValue,
    });
    assert.equal(repoResult.errors, undefined);
    assertListAndCountParity(
      repoCapture.queryCalls,
      "(r.reputation, r.id) < ($4, $5)",
      repoWhereClauseOf,
    );
  });

  it("rejects page sizes outside 1 through 100 before querying", async () => {
    const invalidFirstValues = [
      { value: 0, policyError: true },
      { value: -1, policyError: true },
      { value: 101, policyError: true },
      { value: 1.5, policyError: false },
      { value: Number.NaN, policyError: false },
      { value: Number.POSITIVE_INFINITY, policyError: false },
      { value: Number.MAX_SAFE_INTEGER, policyError: false },
      { value: 2 ** 31, policyError: false },
    ];

    for (const field of ["fonts", "repos"] as const) {
      for (const { value, policyError } of invalidFirstValues) {
        const { contextValue, calls } = createSqlCapture();
        const result = await graphql({
          schema,
          source: `query PageSize($first: Int) {
            ${field}(first: $first) { totalCount }
          }`,
          variableValues: { first: value },
          contextValue,
        });

        assert.ok(result.errors?.length, `${field} first=${value} should fail`);
        assert.equal(calls.length, 0);
        if (policyError) {
          assert.equal(result.errors[0]!.extensions.code, "BAD_USER_INPUT");
          assert.equal(
            result.errors[0]!.message,
            "first must be an integer from 1 through 100",
          );
        }
      }

      for (const first of [1, 100]) {
        const { contextValue, queryCalls } = createSqlCapture();
        const result = await graphql({
          schema,
          source: `query PageSize($first: Int) {
            ${field}(first: $first) { totalCount }
          }`,
          variableValues: { first },
          contextValue,
        });

        assert.equal(result.errors, undefined);
        assert.equal(queryCalls.length, 2);
        assert.equal(queryCalls[0]!.params.at(-1), first + 1);
      }
    }
  });

  it("rejects font IDs that are not canonical positive safe integers", async () => {
    const invalidIds = [
      "0",
      "-1",
      "1.5",
      "01",
      "+1",
      "1e1",
      " 1 ",
      "NaN",
      "Infinity",
      "9007199254740992",
      "999999999999999999999999999999",
    ];

    for (const id of invalidIds) {
      const { contextValue, calls } = createSqlCapture();
      const result = await graphql({
        schema,
        source: `query FontId($id: ID!) {
          font(id: $id) { id }
        }`,
        variableValues: { id },
        contextValue,
      });

      assert.equal(calls.length, 0);
      assert.equal(result.errors?.[0]?.extensions.code, "BAD_USER_INPUT");
      assert.equal(
        result.errors?.[0]?.message,
        "font id must be a positive safe integer",
      );
    }

    for (const id of ["1", String(Number.MAX_SAFE_INTEGER)]) {
      const { contextValue, calls } = createSqlCapture();
      const result = await graphql({
        schema,
        source: `query FontId($id: ID!) {
          font(id: $id) { id }
        }`,
        variableValues: { id },
        contextValue,
      });

      assert.equal(result.errors, undefined);
      assert.equal(calls.length, 1);
      assert.deepEqual(calls[0]!.params, [Number(id)]);
    }
  });

  it("serializes PostgreSQL BIGINT IDs above the GraphQL Int32 range", async () => {
    const fontFileId = 2_147_483_648;
    const repoId = 2_147_483_649;
    const calls: SqlCall[] = [];
    const query = async (text: string, params: unknown[] = []) => {
      calls.push({ text: normalizeSql(text), params });
      return [
        {
          font_file_id: String(fontFileId),
          cdn_url: "https://cdn.example/font.ttf",
          raw_url: "https://raw.example/font.ttf",
          format: "ttf",
          file_name: "Font.ttf",
          path: "fonts/Font.ttf",
          family_guess: "Font",
          weight_guess: 400,
          style_guess: "normal",
          is_variable: false,
          is_webfont: false,
          repo_id: String(repoId),
          full_name: "owner/repo",
          repo_name: "repo",
          repo_url: "https://github.com/owner/repo",
          stars: 10,
          reputation: 20,
          license_spdx: "OFL-1.1",
          default_branch: "main",
          owner_login: "owner",
          owner_type: "User",
          owner_url: "https://github.com/owner",
        },
      ];
    };
    const sqlClient = { query };

    const result = await graphql({
      schema,
      source: `{
        font(id: "2147483648") {
          id
          fontFileId
          repoId
        }
      }`,
      contextValue: { getSql: () => sqlClient },
    });

    assert.equal(result.errors, undefined);
    assert.deepEqual({ ...(result.data?.font as object) }, {
      id: String(fontFileId),
      fontFileId,
      repoId,
    });
    assert.deepEqual(calls[0]?.params, [fontFileId]);
  });

  it("reports malformed and out-of-contract cursors as safe client input", async () => {
    const cases = [
      {
        field: "fonts",
        cursor: encodeRaw(
          `{"v":2,"rep":1,"stars":2,"family":"Alpha","id":0}`,
        ),
      },
      {
        field: "repos",
        cursor: encodeRaw(
          `{"v":1,"rep":1,"stars":2,"name":"owner/repo","id":9007199254740992}`,
        ),
      },
      {
        field: "fonts",
        cursor: encodeRaw(
          `{"v":2,"rep":2147483648,"stars":2,"family":"Alpha","id":1}`,
        ),
      },
      {
        field: "repos",
        cursor: encodeRaw(
          `{"v":1,"rep":1,"stars":-2147483649,"name":"owner/repo","id":1}`,
        ),
      },
      {
        field: "fonts",
        cursor: encodeRaw(
          JSON.stringify({
            v: 2,
            rep: 1,
            stars: 2,
            family: "Al\0pha",
            id: 1,
          }),
        ),
      },
      {
        field: "repos",
        cursor: encodeRaw(
          JSON.stringify({
            v: 1,
            rep: 1,
            stars: 2,
            name: "owner/\0repo",
            id: 1,
          }),
        ),
      },
      { field: "fonts", cursor: "not-a-cursor" },
      { field: "repos", cursor: "not-a-cursor" },
      { field: "fonts", cursor: "" },
      { field: "repos", cursor: "" },
    ] as const;

    for (const { field, cursor } of cases) {
      const { contextValue, calls } = createSqlCapture();
      const result = await graphql({
        schema,
        source: `query Cursor($after: String) {
          ${field}(after: $after) { totalCount }
        }`,
        variableValues: { after: cursor },
        contextValue,
      });

      assert.equal(calls.length, 0);
      assert.equal(result.errors?.[0]?.extensions.code, "BAD_USER_INPUT");
      assert.equal(result.errors?.[0]?.message, "after must be a valid cursor");
    }
  });
});

function createSqlCapture() {
  const calls: SqlCall[] = [];
  const queryCalls: SqlCall[] = [];
  let sqlAccesses = 0;

  const query = async (text: string, params: unknown[] = []) => {
    const call = { text: normalizeSql(text), params };
    queryCalls.push(call);
    calls.push(call);
    return call.text.startsWith("SELECT COUNT(*)::int AS total")
      ? [{ total: 0 }]
      : [];
  };
  const sqlClient = { query };
  const sql = Object.assign(
    () => sqlClient,
    {
      query,
    },
  );

  return {
    contextValue: {
      sql,
      getSql: () => {
        sqlAccesses += 1;
        return sqlClient;
      },
    },
    calls,
    queryCalls,
    get sqlAccesses() {
      return sqlAccesses;
    },
  };
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

function whereClauseOf(sql: string): string {
  const match = normalizeSql(sql).match(/\bWHERE (.+?)(?: ORDER BY| LIMIT|$)/);
  assert.ok(match, `Expected a WHERE clause in: ${sql}`);
  return match[1]!;
}

function repoWhereClauseOf(sql: string): string {
  const match = normalizeSql(sql).match(
    /\bFROM repos r JOIN owners o ON o\.id = r\.owner_id WHERE (.+?)(?: ORDER BY| LIMIT|$)/,
  );
  assert.ok(match, `Expected a repository WHERE clause in: ${sql}`);
  return match[1]!;
}

function assertListAndCountParity(
  calls: SqlCall[],
  cursorClause: string,
  listWhere: (sql: string) => string = whereClauseOf,
): void {
  const count = calls.find((call) =>
    call.text.startsWith("SELECT COUNT(*)::int AS total"),
  );
  const list = calls.find((call) => call !== count);
  assert.ok(list);
  assert.ok(count);
  assert.equal(
    listWhere(list.text),
    `${whereClauseOf(count.text)} AND ${cursorClause}`,
  );
  assert.deepEqual(list.params.slice(0, count.params.length), count.params);
}

function encodeRaw(json: string): string {
  return Buffer.from(json, "utf8").toString("base64url");
}
