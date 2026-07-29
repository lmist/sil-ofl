import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isEnumType,
  isInputObjectType,
  isObjectType,
  parse,
  printSchema,
  validate,
} from "graphql";
import {
  FONT_QUERY,
  FONTS_QUERY,
  HEALTH_QUERY,
  REPO_QUERY,
  REPOS_QUERY,
  STATS_QUERY,
} from "@/graphql/documents";
import { schema } from "@/graphql/schema";

describe("GraphQL schema contract", () => {
  it("publishes non-null resolver guarantees while preserving nullable data", () => {
    const sdl = printSchema(schema);

    for (const requiredField of [
      "health: Health!",
      "stats: Stats!",
      "edges: [FontEdge!]!",
      "pageInfo: PageInfo!",
      "totalCount: Int!",
      "cursor: String!",
      "node: FontFile!",
      "ok: Boolean!",
      "fontFiles: Int!",
      "cdnUrl: String!",
      "isVariable: Boolean!",
      "licenseSpdx: String!",
    ]) {
      assert.match(sdl, new RegExp(`\\b${escapeRegExp(requiredField)}`));
    }

    for (const nullableField of [
      "font(id: ID!): FontFile",
      "endCursor: String",
      "familyGuess: String",
      "weightGuess: Int",
      "styleGuess: String",
      "ownerUrl: String",
      "description: String",
    ]) {
      assert.ok(sdl.includes(nullableField), `${nullableField} should remain nullable`);
      assert.ok(!sdl.includes(`${nullableField}!`));
    }
  });

  it("accepts every shipped operation document", () => {
    for (const document of [
      HEALTH_QUERY,
      STATS_QUERY,
      FONTS_QUERY,
      FONT_QUERY,
      REPOS_QUERY,
      REPO_QUERY,
    ]) {
      assert.deepEqual(validate(schema, parse(document)), []);
    }
  });

  it("matches every shipped output, input, argument, and enum contract", () => {
    const expectedOutputs: Record<string, Record<string, string>> = {
      Query: {
        health: "Health!",
        stats: "Stats!",
        fonts: "FontConnection!",
        font: "FontFile",
        repos: "RepoConnection!",
        repo: "Repo",
      },
      Health: { ok: "Boolean!", service: "String!", ts: "String!" },
      Stats: {
        repos: "Int!",
        fontFiles: "Int!",
        owners: "Int!",
        reposWithFiles: "Int!",
      },
      FontFile: {
        id: "ID!",
        cdnUrl: "String!",
        rawUrl: "String!",
        format: "String!",
        fileName: "String!",
        path: "String!",
        familyGuess: "String",
        weightGuess: "Int",
        styleGuess: "String",
        isVariable: "Boolean!",
        isWebfont: "Boolean!",
        stars: "Int!",
        reputation: "Int!",
        ownerLogin: "String!",
        fullName: "String!",
        defaultBranch: "String!",
        fontFileId: "PositiveSafeInt!",
        repoId: "PositiveSafeInt!",
        repoName: "String!",
        repoUrl: "String!",
        licenseSpdx: "String!",
        ownerType: "String!",
        ownerUrl: "String",
      },
      PageInfo: { hasNextPage: "Boolean!", endCursor: "String" },
      FontEdge: { cursor: "String!", node: "FontFile!" },
      FontConnection: {
        edges: "[FontEdge!]!",
        pageInfo: "PageInfo!",
        totalCount: "Int!",
      },
      Repo: {
        id: "ID!",
        fullName: "String!",
        name: "String!",
        description: "String",
        htmlUrl: "String!",
        stars: "Int!",
        reputation: "Int!",
        licenseSpdx: "String!",
        defaultBranch: "String!",
        ownerLogin: "String!",
        fontCount: "Int!",
      },
      RepoEdge: { cursor: "String!", node: "Repo!" },
      RepoConnection: {
        edges: "[RepoEdge!]!",
        pageInfo: "PageInfo!",
        totalCount: "Int!",
      },
    };

    for (const [typeName, expectedFields] of Object.entries(expectedOutputs)) {
      const type = schema.getType(typeName);
      assert.ok(isObjectType(type), `${typeName} should be an object type`);
      assert.deepEqual(
        Object.fromEntries(
          Object.entries(type.getFields()).map(([name, field]) => [
            name,
            String(field.type),
          ]),
        ),
        expectedFields,
      );
    }

    const expectedInputs = {
      FontFilter: {
        q: "String",
        owner: "String",
        format: "[String!]",
        minStars: "Int",
        webfont: "Boolean",
        variable: "Boolean",
      },
      RepoFilter: {
        q: "String",
        owner: "String",
        minStars: "Int",
        withFonts: "Boolean",
      },
    };
    for (const [typeName, expectedFields] of Object.entries(expectedInputs)) {
      const type = schema.getType(typeName);
      assert.ok(isInputObjectType(type), `${typeName} should be an input type`);
      assert.deepEqual(
        Object.fromEntries(
          Object.entries(type.getFields()).map(([name, field]) => [
            name,
            String(field.type),
          ]),
        ),
        expectedFields,
      );
    }
    const fontFilter = schema.getType("FontFilter");
    const repoFilter = schema.getType("RepoFilter");
    assert.ok(isInputObjectType(fontFilter));
    assert.ok(isInputObjectType(repoFilter));
    assert.equal(
      fontFilter.getFields().format?.description,
      "Case-insensitive. Accepted values: ttf, otf, woff, woff2.",
    );
    assert.equal(
      fontFilter.getFields().minStars?.description,
      "Nonnegative minimum repository star count.",
    );
    assert.equal(
      repoFilter.getFields().minStars?.description,
      "Nonnegative minimum repository star count.",
    );

    const query = schema.getQueryType()!;
    assert.deepEqual(argumentContract(query.getFields().fonts!.args), {
      filter: { type: "FontFilter", defaultValue: undefined },
      sort: { type: "FontSort", defaultValue: "REPUTATION_DESC" },
      first: { type: "Int", defaultValue: 50 },
      after: { type: "String", defaultValue: undefined },
    });
    assert.deepEqual(argumentContract(query.getFields().font!.args), {
      id: { type: "ID!", defaultValue: undefined },
    });
    assert.deepEqual(argumentContract(query.getFields().repos!.args), {
      filter: { type: "RepoFilter", defaultValue: undefined },
      first: { type: "Int", defaultValue: 50 },
      after: { type: "String", defaultValue: undefined },
    });
    assert.deepEqual(argumentContract(query.getFields().repo!.args), {
      owner: { type: "String!", defaultValue: undefined },
      name: { type: "String!", defaultValue: undefined },
    });

    const sort = schema.getType("FontSort");
    assert.ok(isEnumType(sort));
    assert.deepEqual(
      sort
        .getValues()
        .map((value) => value.name)
        .sort(),
      [
        "FAMILY_ASC",
        "FAMILY_DESC",
        "ID_ASC",
        "ID_DESC",
        "REPUTATION_ASC",
        "REPUTATION_DESC",
        "STARS_ASC",
        "STARS_DESC",
      ],
    );
  });
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function argumentContract(
  args: readonly {
    name: string;
    type: { toString(): string };
    defaultValue?: unknown;
  }[],
) {
  return Object.fromEntries(
    args.map((arg) => [
      arg.name,
      { type: String(arg.type), defaultValue: arg.defaultValue },
    ]),
  );
}
