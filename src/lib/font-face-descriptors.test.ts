import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  cssFontFamilyValue,
  resolveFontFamily,
  resolveFontWeight,
} from "./font-face-descriptors";

describe("font face descriptors", () => {
  it("uses one readable fallback family for missing metadata", () => {
    assert.equal(
      resolveFontFamily({
        familyGuess: null,
        fileName: "Unknown-Regular.ttf",
      }),
      "Unknown Regular",
    );
  });

  it("keeps adversarial family names inert in browser CSS", () => {
    assert.equal(
      cssFontFamilyValue('A"B\nC\\D'),
      `'A"B\\A C\\\\D'`,
    );
    assert.equal(cssFontFamilyValue("serif"), "'serif'");
  });

  it("accepts only integer CSS font weights from 1 through 1000", () => {
    for (const weight of [1, 400, 1000]) {
      assert.equal(resolveFontWeight(weight), weight);
    }

    for (const weight of [
      null,
      undefined,
      Number.NaN,
      Number.NEGATIVE_INFINITY,
      Number.POSITIVE_INFINITY,
      -1,
      0,
      0.5,
      400.5,
      1000.1,
      1001,
    ]) {
      assert.equal(resolveFontWeight(weight), 400);
    }
  });
});
