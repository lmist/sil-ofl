import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  decodeFontCursor,
  decodeRepoCursor,
  encodeFontCursor,
} from "./schema/cursor";
import { fontKeyset, fontOrderBy } from "./schema/font-pagination";

describe("font cursor contract", () => {
  it("round-trips null and empty family keys distinctly", () => {
    const nullFamily = encodeFontCursor({
      v: 2,
      rep: 10,
      stars: 20,
      family: null,
      id: 30,
    });
    const emptyFamily = encodeFontCursor({
      v: 2,
      rep: 10,
      stars: 20,
      family: "",
      id: 31,
    });

    assert.notEqual(nullFamily, emptyFamily);
    assert.deepEqual(decodeFontCursor(nullFamily), {
      v: 2,
      rep: 10,
      stars: 20,
      family: null,
      id: 30,
    });
    assert.deepEqual(decodeFontCursor(emptyFamily), {
      v: 2,
      rep: 10,
      stars: 20,
      family: "",
      id: 31,
    });
    assert.equal(
      decodeFontCursor(
        encodeRaw(
          `{"v":1,"rep":10,"stars":20,"family":"","id":31}`,
        ),
      ),
      null,
      "ambiguous v1 family cursors must be invalidated",
    );
  });

  it("builds family keysets that match NULLS LAST ordering", () => {
    assert.equal(
      fontOrderBy("FAMILY_ASC"),
      "f.family_guess ASC NULLS LAST, f.id ASC",
    );
    assert.equal(
      fontOrderBy("FAMILY_DESC"),
      "f.family_guess DESC NULLS LAST, f.id DESC",
    );

    assert.deepEqual(
      fontKeyset(
        "FAMILY_ASC",
        { rep: 0, stars: 0, family: "Alpha", id: 41 },
        3,
      ),
      {
        sql:
          "(f.family_guess > $3 OR (f.family_guess = $3 AND f.id > $4) OR f.family_guess IS NULL)",
        values: ["Alpha", 41],
      },
    );
    assert.deepEqual(
      fontKeyset(
        "FAMILY_ASC",
        { rep: 0, stars: 0, family: null, id: 101 },
        3,
      ),
      {
        sql: "(f.family_guess IS NULL AND f.id > $3)",
        values: [101],
      },
    );
    assert.deepEqual(
      fontKeyset(
        "FAMILY_DESC",
        { rep: 0, stars: 0, family: "Alpha", id: 42 },
        5,
      ),
      {
        sql:
          "(f.family_guess < $5 OR (f.family_guess = $5 AND f.id < $6) OR f.family_guess IS NULL)",
        values: ["Alpha", 42],
      },
    );
    assert.deepEqual(
      fontKeyset(
        "FAMILY_DESC",
        { rep: 0, stars: 0, family: null, id: 102 },
        5,
      ),
      {
        sql: "(f.family_guess IS NULL AND f.id < $5)",
        values: [102],
      },
    );
  });

  it("rejects cursor IDs that are not positive safe integers", () => {
    const invalidIds = [
      "0",
      "-1",
      "1.5",
      "1e309",
      "9007199254740992",
      "999999999999999999999999999999",
    ];

    for (const id of invalidIds) {
      assert.equal(
        decodeFontCursor(
          encodeRaw(
            `{"v":2,"rep":1,"stars":2,"family":"Alpha","id":${id}}`,
          ),
        ),
        null,
        `font cursor id ${id} should be rejected`,
      );
      assert.equal(
        decodeRepoCursor(
          encodeRaw(
            `{"v":1,"rep":1,"stars":2,"name":"owner/repo","id":${id}}`,
          ),
        ),
        null,
        `repo cursor id ${id} should be rejected`,
      );
    }

    assert.equal(
      decodeFontCursor(
        encodeRaw(
          `{"v":2,"rep":1,"stars":2,"family":"Alpha","id":9007199254740991}`,
        ),
      )?.id,
      Number.MAX_SAFE_INTEGER,
    );
    assert.equal(
      decodeRepoCursor(
        encodeRaw(
          `{"v":1,"rep":1,"stars":2,"name":"owner/repo","id":9007199254740991}`,
        ),
      )?.id,
      Number.MAX_SAFE_INTEGER,
    );
  });

  it("rejects incomplete and non-finite cursor sort keys", () => {
    for (const payload of [
      `{"v":2,"rep":1e309,"stars":2,"family":"Alpha","id":1}`,
      `{"v":2,"rep":1,"stars":1.5,"family":"Alpha","id":1}`,
      `{"v":2,"stars":2,"family":"Alpha","id":1}`,
    ]) {
      assert.equal(decodeFontCursor(encodeRaw(payload)), null);
    }
    for (const payload of [
      `{"v":1,"rep":1e309,"stars":2,"name":"owner/repo","id":1}`,
      `{"v":1,"rep":1,"stars":1.5,"name":"owner/repo","id":1}`,
      `{"v":1,"rep":1,"stars":2,"name":null,"id":1}`,
    ]) {
      assert.equal(decodeRepoCursor(encodeRaw(payload)), null);
    }
  });

  it("traverses null, empty, duplicate, and mixed families exactly once", () => {
    const fixtures = [
      { family: null, id: 101 },
      { family: null, id: 102 },
      { family: "", id: 31 },
      { family: "", id: 32 },
      { family: "Alpha", id: 41 },
      { family: "Alpha", id: 42 },
      { family: "Zulu", id: 51 },
      { family: "Zulu", id: 52 },
    ];

    assert.deepEqual(twoPages("FAMILY_ASC", fixtures, 4), [
      [31, 32, 41, 42],
      [51, 52, 101, 102],
    ]);
    assert.deepEqual(twoPages("FAMILY_DESC", fixtures, 6), [
      [52, 51, 42, 41, 32, 31],
      [102, 101],
    ]);
  });
});

function encodeRaw(json: string): string {
  return Buffer.from(json, "utf8").toString("base64url");
}

function twoPages(
  sort: "FAMILY_ASC" | "FAMILY_DESC",
  fixtures: { family: string | null; id: number }[],
  first: number,
): number[][] {
  const ordered = [...fixtures].sort((left, right) =>
    compareFontFamilyKeys(sort, left, right),
  );
  const firstPage = ordered.slice(0, first);
  const last = firstPage.at(-1)!;
  const cursor = decodeFontCursor(
    encodeFontCursor({
      v: 2,
      rep: 0,
      stars: 0,
      family: last.family,
      id: last.id,
    }),
  )!;
  const secondPage = ordered
    .filter(
      (candidate) =>
        compareFontFamilyKeys(sort, candidate, {
          family: cursor.family,
          id: cursor.id,
        }) > 0,
    )
    .slice(0, first);

  return [
    firstPage.map((row) => row.id),
    secondPage.map((row) => row.id),
  ];
}

function compareFontFamilyKeys(
  sort: "FAMILY_ASC" | "FAMILY_DESC",
  left: { family: string | null; id: number },
  right: { family: string | null; id: number },
): number {
  if (left.family === null || right.family === null) {
    if (left.family === right.family) {
      return compareNumber(sort, left.id, right.id);
    }
    return left.family === null ? 1 : -1;
  }

  const familyComparison =
    left.family < right.family ? -1 : left.family > right.family ? 1 : 0;
  return familyComparison === 0
    ? compareNumber(sort, left.id, right.id)
    : sort === "FAMILY_ASC"
      ? familyComparison
      : -familyComparison;
}

function compareNumber(
  sort: "FAMILY_ASC" | "FAMILY_DESC",
  left: number,
  right: number,
): number {
  const comparison = left < right ? -1 : left > right ? 1 : 0;
  return sort === "FAMILY_ASC" ? comparison : -comparison;
}
