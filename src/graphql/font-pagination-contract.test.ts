import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Database } from "bun:sqlite";
import { graphql } from "graphql";
import { schema } from "@/graphql/schema";
import {
  decodeFontCursor,
  encodeFontCursor,
} from "@/graphql/schema/cursor";
import {
  fontKeyset,
  fontOrderBy,
  type FontSortValue,
} from "@/graphql/schema/font-pagination";

type FontFixture = {
  id: number;
  rep: number;
  stars: number;
  family: string | null;
};

const fixtures: FontFixture[] = [
  { id: 11, rep: 30, stars: 10, family: "Bravo" },
  { id: 12, rep: 30, stars: 10, family: "Alpha" },
  { id: 13, rep: 20, stars: 30, family: null },
  { id: 14, rep: 20, stars: 30, family: "Alpha" },
  { id: 15, rep: 10, stars: 20, family: null },
  { id: 16, rep: 10, stars: 20, family: "" },
  { id: 17, rep: 20, stars: 30, family: "Zulu" },
  { id: 18, rep: 30, stars: 10, family: null },
];

const expectedOrder: Record<FontSortValue, number[]> = {
  REPUTATION_DESC: [18, 12, 11, 17, 14, 13, 16, 15],
  REPUTATION_ASC: [15, 16, 13, 14, 17, 11, 12, 18],
  STARS_DESC: [17, 14, 13, 16, 15, 18, 12, 11],
  STARS_ASC: [11, 12, 18, 15, 16, 13, 14, 17],
  FAMILY_ASC: [16, 12, 14, 11, 17, 13, 15, 18],
  FAMILY_DESC: [17, 11, 14, 12, 16, 18, 15, 13],
  ID_DESC: [18, 17, 16, 15, 14, 13, 12, 11],
  ID_ASC: [11, 12, 13, 14, 15, 16, 17, 18],
};

function createFixtureDatabase(): Database {
  const database = new Database(":memory:");
  database.exec(`
    CREATE TABLE repos (
      id INTEGER PRIMARY KEY,
      reputation INTEGER NOT NULL,
      stars INTEGER NOT NULL
    );
    CREATE TABLE font_files (
      id INTEGER PRIMARY KEY,
      repo_id INTEGER NOT NULL,
      family_guess TEXT
    );
  `);
  const insertRepo = database.prepare(
    "INSERT INTO repos (id, reputation, stars) VALUES (?, ?, ?)",
  );
  const insertFont = database.prepare(
    "INSERT INTO font_files (id, repo_id, family_guess) VALUES (?, ?, ?)",
  );
  for (const fixture of fixtures) {
    insertRepo.run(fixture.id, fixture.rep, fixture.stars);
    insertFont.run(fixture.id, fixture.id, fixture.family);
  }
  return database;
}

function traverse(database: Database, sort: FontSortValue): number[] {
  const pageSize = 2;
  const ids: number[] = [];
  let after: string | null = null;

  while (true) {
    const cursor = after ? decodeFontCursor(after) : null;
    const keyset = cursor ? fontKeyset(sort, cursor, 1) : null;
    const rows = database
      .query<FontFixture, Array<string | number>>(`
        SELECT
          f.id AS id,
          r.reputation AS rep,
          r.stars AS stars,
          f.family_guess AS family
        FROM font_files f
        JOIN repos r ON r.id = f.repo_id
        ${keyset ? `WHERE ${keyset.sql}` : ""}
        ORDER BY ${fontOrderBy(sort)}
        LIMIT ${pageSize + 1}
      `)
      .all(...(keyset?.values ?? []));
    const page = rows.slice(0, pageSize);
    ids.push(...page.map((row) => row.id));
    if (rows.length <= pageSize) break;

    const last = page.at(-1)!;
    after = encodeFontCursor({
      v: 2,
      rep: last.rep,
      stars: last.stars,
      family: last.family,
      id: last.id,
    });
  }

  return ids;
}

function resolverFontRow(
  id: number,
  reputation: number,
  stars: number,
  familyGuess: string | null,
) {
  return {
    font_file_id: id,
    cdn_url: `https://cdn.example/${id}.ttf`,
    raw_url: `https://raw.example/${id}.ttf`,
    format: "ttf",
    file_name: `${id}.ttf`,
    path: `fonts/${id}.ttf`,
    family_guess: familyGuess,
    weight_guess: 400,
    style_guess: "normal",
    is_variable: false,
    is_webfont: false,
    repo_id: id,
    full_name: `owner/repo-${id}`,
    repo_name: `repo-${id}`,
    repo_url: `https://github.com/owner/repo-${id}`,
    stars,
    reputation,
    license_spdx: "OFL-1.1",
    default_branch: "main",
    owner_login: "owner",
    owner_type: "User",
    owner_url: "https://github.com/owner",
  };
}

describe("font pagination SQL contract", () => {
  it("traverses every sort and nullable key exactly once", () => {
    const database = createFixtureDatabase();
    try {
      for (const [sort, expected] of Object.entries(expectedOrder) as Array<
        [FontSortValue, number[]]
      >) {
        const actual = traverse(database, sort);
        assert.deepEqual(actual, expected, sort);
        assert.equal(new Set(actual).size, fixtures.length, sort);
      }
    } finally {
      database.close();
    }
  });

  it("round-trips a resolver-emitted edge/end cursor into the next page", async () => {
    const calls: Array<{ text: string; params: unknown[] }> = [];
    const firstPageRows = [
      resolverFontRow(3, 30, 7, "Family 3"),
      resolverFontRow(2, 20, 11, null),
      resolverFontRow(1, 10, 13, "Family 1"),
    ];
    const nextPageRows = [resolverFontRow(1, 10, 13, "Family 1")];
    const query = async (text: string, params: unknown[] = []) => {
      const normalized = text.replace(/\s+/g, " ").trim();
      calls.push({ text: normalized, params });
      if (normalized.startsWith("SELECT COUNT(*)::int AS total")) {
        return [{ total: 3 }];
      }
      return normalized.includes("(r.reputation, f.id) <")
        ? nextPageRows
        : firstPageRows;
    };
    const source = `query ResolverCursor($after: String) {
      fonts(first: 2, after: $after) {
        edges { cursor node { id } }
        pageInfo { hasNextPage endCursor }
      }
    }`;
    const contextValue = { getSql: () => ({ query }) };

    const first = await graphql({
      schema,
      source,
      variableValues: { after: null },
      contextValue,
    });
    assert.equal(first.errors, undefined);
    const firstConnection = (
      first.data as {
        fonts: {
          edges: Array<{ cursor: string; node: { id: string } }>;
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
        };
      }
    ).fonts;

    assert.deepEqual(
      firstConnection.edges.map((edge) => edge.node.id),
      ["3", "2"],
    );
    assert.equal(firstConnection.pageInfo.hasNextPage, true);
    assert.equal(
      firstConnection.pageInfo.endCursor,
      firstConnection.edges[1]!.cursor,
    );
    assert.deepEqual(
      firstConnection.edges.map((edge) => decodeFontCursor(edge.cursor)),
      [
        {
          v: 2,
          rep: 30,
          stars: 7,
          family: "Family 3",
          id: 3,
        },
        {
          v: 2,
          rep: 20,
          stars: 11,
          family: null,
          id: 2,
        },
      ],
    );

    const second = await graphql({
      schema,
      source,
      variableValues: { after: firstConnection.pageInfo.endCursor },
      contextValue,
    });
    assert.equal(second.errors, undefined);
    const secondConnection = (
      second.data as {
        fonts: {
          edges: Array<{ cursor: string; node: { id: string } }>;
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
        };
      }
    ).fonts;

    assert.deepEqual(
      secondConnection.edges.map((edge) => edge.node.id),
      ["1"],
    );
    assert.equal(secondConnection.pageInfo.hasNextPage, false);
    assert.equal(
      secondConnection.pageInfo.endCursor,
      secondConnection.edges[0]!.cursor,
    );
    const secondListCall = calls.find((call) =>
      call.text.includes("(r.reputation, f.id) <"),
    );
    assert.ok(secondListCall);
    assert.deepEqual(secondListCall.params, [0, 20, 2, 3]);
  });
});
