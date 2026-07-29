import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ACCEPTED_PUBLIC_FONT_LICENSES,
  isAcceptedPublicFontLicense,
} from "./schema/public-font-policy";

describe("public font license policy", () => {
  it("accepts only the documented SIL OFL SPDX identifiers", () => {
    assert.deepEqual(ACCEPTED_PUBLIC_FONT_LICENSES, ["OFL-1.0", "OFL-1.1"]);

    for (const license of ["OFL-1.0", "OFL-1.1"]) {
      assert.equal(isAcceptedPublicFontLicense(license), true);
    }
    for (const license of [
      null,
      undefined,
      "",
      "NOASSERTION",
      "Apache-2.0",
      "MIT",
      "OFL-1.1-only",
      "ofl-1.1",
      "OFL-1.1 ",
    ]) {
      assert.equal(
        isAcceptedPublicFontLicense(license),
        false,
        `${String(license)} should not be public`,
      );
    }
  });
});
