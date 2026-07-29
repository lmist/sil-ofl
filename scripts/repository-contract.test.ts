import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

type ConductorSettings = {
  scripts: {
    setup: string;
    run_mode: string;
    run: Record<string, { command: string }>;
  };
};

describe("repository workspace contract", () => {
  it("keeps Conductor setup and verification on isolated Bun commands", () => {
    const parsed = spawnSync(
      process.execPath,
      [
        "-e",
        'import settings from "./.conductor/settings.toml"; console.log(JSON.stringify(settings));',
      ],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    assert.equal(parsed.status, 0, parsed.stderr);
    const settings = JSON.parse(parsed.stdout) as ConductorSettings;

    assert.equal(
      settings.scripts.setup,
      "bun install --frozen-lockfile && bunx playwright install chromium",
    );
    assert.equal(settings.scripts.run_mode, "concurrent");
    assert.equal(
      settings.scripts.run.dev?.command,
      'bun run dev -- --port "$CONDUCTOR_PORT"',
    );
    assert.equal(
      settings.scripts.run.e2e?.command,
      "bun run test:e2e:isolated",
    );
    assert.equal(settings.scripts.run.verify?.command, "bun run verify");

    const packageJson = JSON.parse(
      readFileSync("package.json", "utf8"),
    ) as { scripts: Record<string, string> };
    assert.equal(
      packageJson.scripts["test:e2e:isolated"],
      "bun scripts/run-isolated-e2e.ts",
    );
    assert.equal(packageJson.scripts.test, "bun scripts/run-tests.ts");
    assert.match(packageJson.scripts["test:machines"] ?? "", /^bun test /);
    assert.match(packageJson.scripts.verify ?? "", /test:e2e:isolated/);
  });

  it("copies only the explicitly allowed local environment file", () => {
    const included = readFileSync(".worktreeinclude", "utf8")
      .split(/\r?\n/)
      .filter(Boolean);
    assert.deepEqual(included, [".env.local"]);
  });
});
