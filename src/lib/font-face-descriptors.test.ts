import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  cssFontFamilyValue,
  resolveFontFamily,
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
});
