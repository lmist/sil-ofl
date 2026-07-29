/**
 * Run: bun test src/machines/catalog-url.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseCatalogSearchParams,
  serializeCatalogContext,
} from "./catalog-url";
import { defaultCatalogFilters } from "./catalog-machine";

describe("catalog-url", () => {
  it("serialises non-default catalog fields", () => {
    const qs = serializeCatalogContext({
      q: "charis",
      filters: { ...defaultCatalogFilters, format: "woff2", owner: "silnrsi" },
      sort: "FAMILY_ASC",
      after: "abc",
      selectedFontId: 12,
    });
    const params = new URLSearchParams(qs);
    assert.equal(params.get("q"), "charis");
    assert.equal(params.get("format"), "woff2");
    assert.equal(params.get("owner"), "silnrsi");
    assert.equal(params.get("after"), "abc");
    assert.equal(params.get("sort"), "FAMILY_ASC");
    assert.equal(params.get("font"), "12");
  });

  it("omits defaults", () => {
    const qs = serializeCatalogContext({
      q: "",
      filters: { ...defaultCatalogFilters },
      sort: "REPUTATION_DESC",
      after: null,
      selectedFontId: null,
    });
    assert.equal(qs, "");
  });

  it("parses search params", () => {
    const params = new URLSearchParams(
      "q=noto&format=ttf&owner=google&after=c1&sort=STARS_DESC&font=99",
    );
    const slice = parseCatalogSearchParams(params);
    assert.equal(slice.q, "noto");
    assert.equal(slice.filters?.format, "ttf");
    assert.equal(slice.filters?.owner, "google");
    assert.equal(slice.after, "c1");
    assert.equal(slice.sort, "STARS_DESC");
    assert.equal(slice.selectedFontId, 99);
  });

  it("parses missing keys as explicit catalog defaults", () => {
    const slice = parseCatalogSearchParams(new URLSearchParams());

    assert.equal(slice.q, "");
    assert.deepEqual(slice.filters, { format: "", owner: "" });
    assert.equal(slice.sort, "REPUTATION_DESC");
    assert.equal(slice.after, null);
    assert.equal(slice.selectedFontId, null);
  });

  it("round-trips serialize → parse", () => {
    const original = {
      q: "sil",
      filters: { format: "otf", owner: "silnrsi" },
      sort: "ID_DESC" as const,
      after: "zz",
      selectedFontId: 3,
    };
    const slice = parseCatalogSearchParams(
      new URLSearchParams(
        serializeCatalogContext({
          ...original,
          filters: { ...defaultCatalogFilters, ...original.filters },
        }),
      ),
    );
    assert.equal(slice.q, original.q);
    assert.equal(slice.filters?.format, original.filters.format);
    assert.equal(slice.filters?.owner, original.filters.owner);
    assert.equal(slice.sort, original.sort);
    assert.equal(slice.after, original.after);
    assert.equal(slice.selectedFontId, original.selectedFontId);
  });

  it("round-trips positive-safe font IDs above the GraphQL Int range", () => {
    for (const selectedFontId of [
      2_147_483_648,
      Number.MAX_SAFE_INTEGER,
    ]) {
      const query = serializeCatalogContext({
        q: "",
        filters: { ...defaultCatalogFilters },
        sort: "REPUTATION_DESC",
        after: null,
        selectedFontId,
      });

      assert.equal(
        parseCatalogSearchParams(new URLSearchParams(query)).selectedFontId,
        selectedFontId,
      );
    }
  });

  it("rejects non-canonical and unsafe font IDs", () => {
    for (const font of [
      "0",
      "-1",
      "1.5",
      "01",
      "+1",
      "1e1",
      " 1 ",
      "0x10",
      "NaN",
      "Infinity",
      "9007199254740992",
      "999999999999999999999999999999",
    ]) {
      assert.equal(
        parseCatalogSearchParams(
          new URLSearchParams({ font }),
        ).selectedFontId,
        null,
        `font=${JSON.stringify(font)} should be rejected`,
      );
    }
  });
});
