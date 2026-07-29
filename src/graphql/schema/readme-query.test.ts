import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { parse, validate } from "graphql";
import { schema } from "./index";

describe("README GraphQL examples", () => {
  it("validates against the generated schema", () => {
    const readme = readFileSync(resolve(process.cwd(), "README.md"), "utf8");
    const examples = Array.from(
      readme.matchAll(/```graphql\s*\n([\s\S]*?)```/g),
      (match) => match[1],
    );

    assert.ok(examples.length > 0, "README must include a GraphQL example");
    for (const source of examples) {
      assert.ok(source);
      const errors = validate(schema, parse(source));
      assert.deepEqual(
        errors.map(({ message }) => message),
        [],
      );
    }
  });
});
