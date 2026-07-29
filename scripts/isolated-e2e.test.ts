import assert from "node:assert/strict";
import { createServer } from "node:net";
import { describe, it } from "node:test";
import {
  conductorCompanionPort,
  resolveIsolatedE2ePort,
} from "./isolated-e2e";
import { shouldReusePlaywrightServer } from "../playwright.config";

describe("isolated E2E port selection", () => {
  it("uses the first companion port from Conductor's allocation", () => {
    assert.equal(conductorCompanionPort("43150"), 43151);
    assert.equal(conductorCompanionPort(undefined), null);
    assert.throws(
      () => conductorCompanionPort("65535"),
      /valid CONDUCTOR_PORT/,
    );
  });

  it("asks the OS for an available local port outside Conductor", async () => {
    const port = await resolveIsolatedE2ePort(undefined);
    assert.ok(port > 0 && port <= 65_535);

    const server = createServer();
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", resolve);
    });
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("forces isolated and CI runs to own their web server", () => {
    assert.equal(
      shouldReusePlaywrightServer({ PLAYWRIGHT_FORCE_NEW_SERVER: "1" }),
      false,
    );
    assert.equal(shouldReusePlaywrightServer({ CI: "1" }), false);
    assert.equal(shouldReusePlaywrightServer({}), true);
  });
});
