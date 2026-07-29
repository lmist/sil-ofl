import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);

const DOCUMENTED_E2E_DATA_CONTRACTS = [
  {
    surface: "Catalog shell, loading, result status, and error boundaries",
    attributes: [
      "catalog-error",
      "catalog-error-boundary",
      "catalog-results-status",
      "catalog-shell",
      "catalog-skeleton",
      "retained-results",
      "stats-strip",
    ],
  },
  {
    surface: "Filter controls, active chips, and pagination controls",
    attributes: [
      "filter-chip-strip",
      "font-filter-bar",
      "pagination-controls",
    ],
  },
  {
    surface: "List and dense result structure plus observable selection state",
    attributes: [
      "dense-font-table",
      "font-list",
      "font-list-empty",
      "font-row",
      "font-row-meta",
      "font-row-name",
      "font-row-sample",
      "selected",
      "sortable",
    ],
  },
  {
    surface: "Specimen, use panel, copy feedback, and external URL errors",
    attributes: [
      "copy-feedback",
      "external-url-error",
      "font-specimen",
      "font-use-panel",
      "specimen-status",
    ],
  },
  {
    surface: "Test-owned reduced-motion animation probe injected at runtime",
    attributes: ["reduced-motion-probe"],
  },
] as const;

const PUBLIC_E2E_DATA_ATTRIBUTES: ReadonlySet<string> = new Set(
  DOCUMENTED_E2E_DATA_CONTRACTS.flatMap(({ attributes }) => attributes),
);

const DOCUMENTED_DIRECT_DOM_ACTION_EXCEPTIONS = new Map<string, string>([
  [
    "e2e/catalog.spec.ts :: 7) PERFORMANCE: search interaction to list update :: dispatchEvent (2 calls)",
    "The in-page performance clock starts before the paired native input events.",
  ],
  [
    "e2e/catalog-state.spec.ts :: an inactive cached draft cannot roll back the selected face during debounce :: click",
    "The same browser task must select before controlled stale and active responses race.",
  ],
  [
    "e2e/catalog-state.spec.ts :: applies rapid Webfont and Variable toggles from current state :: click (2 calls)",
    "Two synchronous clicks intentionally exercise functional state updates in one browser task.",
  ],
  [
    "e2e/catalog-state.spec.ts :: filter-only removals preserve selection and session filters stay out of the URL :: click",
    "All removal controls intentionally fire in one browser task to exercise atomic cleanup.",
  ],
  [
    "e2e/catalog-state.spec.ts :: invalid row ids cannot select, cache, or load a specimen face :: click",
    "The invalid fixture must invoke its rendered handler without Playwright eligibility checks.",
  ],
  [
    "e2e/catalog-state.spec.ts :: late superseded search and navigation responses remain inert :: dispatchEvent",
    "A synthetic popstate event drives the controlled browser-history race in the same task.",
  ],
  [
    "e2e/catalog-state.spec.ts :: locks pagination and consumes a delayed forward cursor once :: click (2 calls)",
    "Two synchronous clicks intentionally challenge pagination locking before rerender.",
  ],
  [
    "e2e/catalog-state.spec.ts :: never exposes selected surfaces before their URL identity :: click",
    "The click must occur under an already-installed in-page MutationObserver.",
  ],
  [
    "e2e/catalog-state.spec.ts :: same-id metadata refresh reloads one coherent specimen and export identity :: click",
    "The same browser task must select before the controlled metadata revision arrives.",
  ],
  [
    "e2e/a11y-layout.spec.ts :: Tab follows the catalog task order with visible focus :: blur",
    "The test resets ambient document focus before observing an uninterrupted Tab sequence.",
  ],
]);

const DIRECT_DOM_ACTION_METHODS = new Set([
  "blur",
  "click",
  "dblclick",
  "dispatchEvent",
  "focus",
  "requestSubmit",
  "select",
  "submit",
]);

function dataAttributeSelectors(source: string) {
  return [
    ...new Set(
      [...source.matchAll(/\[data-([a-z0-9-]+)/g)].map(
        (match) => match[1]!,
      ),
    ),
  ].sort();
}

function directDomActionContracts(file: string, source: string) {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const findings = new Map<string, number>();

  const collectCallbackActions = (
    callback: ts.ArrowFunction | ts.FunctionExpression,
    testTitle: string,
  ) => {
    const visit = (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        DIRECT_DOM_ACTION_METHODS.has(node.expression.name.text)
      ) {
        const contract = `${file} :: ${testTitle} :: ${node.expression.name.text}`;
        findings.set(contract, (findings.get(contract) ?? 0) + 1);
      }
      ts.forEachChild(node, visit);
    };

    ts.forEachChild(callback.body, visit);
  };

  const visit = (node: ts.Node, testTitle = "<outside test>") => {
    let activeTestTitle = testTitle;
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "test" &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      activeTestTitle = node.arguments[0].text;
    }

    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      (node.expression.name.text === "evaluate" ||
        node.expression.name.text === "evaluateAll")
    ) {
      const callback = node.arguments[0];
      if (
        callback &&
        (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))
      ) {
        collectCallbackActions(callback, activeTestTitle);
      }
    }

    ts.forEachChild(node, (child) => visit(child, activeTestTitle));
  };

  visit(sourceFile);

  return [...findings]
    .map(
      ([contract, count]) =>
        `${contract}${count === 1 ? "" : ` (${count} calls)`}`,
    )
    .sort();
}

type ConductorSettings = {
  scripts: {
    setup: string;
    run_mode: string;
    run: Record<string, { command: string }>;
  };
};

describe("repository workspace contract", () => {
  it("keeps the patched legacy glob engine compatible with safe brace expansion", () => {
    const minimatch = require("minimatch") as (
      path: string,
      pattern: string,
    ) => boolean;

    assert.equal(minimatch("src/file.ts", "src/*.{js,ts}"), true);
    assert.equal(minimatch("src/file2.ts", "src/file{1..3}.ts"), true);
  });

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
    ) as {
      packageManager: string;
      scripts: Record<string, string>;
    };
    assert.equal(packageJson.packageManager, "bun@1.3.14");
    assert.equal(
      packageJson.scripts["test:e2e"],
      "bun scripts/run-isolated-e2e.ts",
    );
    assert.equal(
      packageJson.scripts["test:e2e:isolated"],
      "bun scripts/run-isolated-e2e.ts",
    );
    assert.equal(
      packageJson.scripts["test:e2e:playwright"],
      "playwright test",
    );
    assert.equal(packageJson.scripts.test, "bun scripts/run-tests.ts");
    assert.equal(packageJson.scripts.audit, "bun audit");
    assert.match(packageJson.scripts["test:machines"] ?? "", /^bun test /);
    assert.equal(
      packageJson.scripts.verify,
      "bun run audit && bun run lint && bun run typecheck && bun run test && bun run build && bun run test:e2e",
    );
    const dependencyAuditWorkflow = readFileSync(
      ".github/workflows/dependency-audit.yml",
      "utf8",
    );
    assert.match(
      dependencyAuditWorkflow,
      /uses: actions\/checkout@[0-9a-f]{40}/,
    );
    assert.match(
      dependencyAuditWorkflow,
      /uses: oven-sh\/setup-bun@[0-9a-f]{40}/,
    );
    assert.match(dependencyAuditWorkflow, /persist-credentials: false/);
    assert.match(dependencyAuditWorkflow, /run: bun ci --ignore-scripts/);
    assert.match(dependencyAuditWorkflow, /run: bun audit/);
    const dependabotConfig = readFileSync(
      ".github/dependabot.yml",
      "utf8",
    );
    assert.match(dependabotConfig, /package-ecosystem: bun/);
    assert.match(dependabotConfig, /package-ecosystem: github-actions/);
    const isolatedRunnerSource = readFileSync(
      "scripts/run-isolated-e2e.ts",
      "utf8",
    );
    assert.match(
      isolatedRunnerSource,
      /\["run", "test:e2e:playwright", \.\.\.process\.argv\.slice\(2\)\]/,
    );

    const listedFiles = spawnSync(
      "git",
      ["ls-files", "-co", "--exclude-standard"],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    assert.equal(listedFiles.status, 0, listedFiles.stderr);
    const lockfiles = listedFiles.stdout
      .split(/\r?\n/)
      .filter((path) =>
        /(?:^|\/)(?:bun\.lockb?|package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock)$/.test(
          path,
        ),
      );
    assert.deepEqual(lockfiles, ["bun.lock"]);
  });

  it("copies only the explicitly allowed local environment file", () => {
    const included = readFileSync(".worktreeinclude", "utf8")
      .split(/\r?\n/)
      .filter(Boolean);
    assert.deepEqual(included, [".env.local"]);
  });

  it("publishes Bun commands in performance documentation", () => {
    const performanceGuide = readFileSync("PERF.md", "utf8");

    assert.match(performanceGuide, /\bbun run analyze\b/);
    assert.match(performanceGuide, /\bbun run analyze:output\b/);
    assert.doesNotMatch(
      performanceGuide,
      /\b(?:npm|pnpm|yarn) (?:run|exec|dlx)\b|\bnpx\b/,
    );
  });

  it("keeps mount effects symmetric across React reconnects", () => {
    const source = readFileSync(
      "src/hooks/use-mount-effect.ts",
      "utf8",
    );

    assert.doesNotMatch(source, /useRef|ran\.current/);
    assert.match(source, /useEffect\(\(\) => effect\(\),\s*\[\]\)/);
  });

  it("detects undocumented data selectors and direct DOM actions", () => {
    const fixture = `
      test("policy fixture", async ({ page }) => {
        await page.locator("[data-public-contract]").click();
        await page.locator("[data-private-hook]").click();
        await page.evaluate(() => {
          document.querySelector("button")?.click();
        });
      });
    `;
    const fixtureContracts = new Set(["public-contract"]);

    assert.deepEqual(
      dataAttributeSelectors(fixture).filter(
        (attribute) => !fixtureContracts.has(attribute),
      ),
      ["private-hook"],
    );
    assert.deepEqual(directDomActionContracts("fixture.spec.ts", fixture), [
      "fixture.spec.ts :: policy fixture :: click",
    ]);
  });

  it("keeps browser actions on semantic or documented public locators", () => {
    const browserSources = readdirSync("e2e")
      .filter((path) => path.endsWith(".spec.ts"))
      .map((path) => ({
        file: `e2e/${path}`,
        source: readFileSync(`e2e/${path}`, "utf8"),
      }));
    const browserSource = browserSources
      .map(({ source }) => source)
      .join("\n");

    assert.doesNotMatch(
      browserSource,
      /\.locator\(\s*["'`]button(?:["'`]|\[)/,
    );
    assert.doesNotMatch(
      browserSource,
      /getByText\([^;]{0,240}\)\.click\(/,
    );
    assert.match(browserSource, /getByRole\("button", \{ name:/);

    const undocumentedDataSelectors = browserSources.flatMap(
      ({ file, source }) =>
        dataAttributeSelectors(source)
          .filter(
            (attribute) => !PUBLIC_E2E_DATA_ATTRIBUTES.has(attribute),
          )
          .map((attribute) => `${file} :: data-${attribute}`),
    );
    assert.deepEqual(undocumentedDataSelectors, []);
    for (const { surface } of DOCUMENTED_E2E_DATA_CONTRACTS) {
      assert.ok(surface.length >= 20);
    }

    const directDomActions = browserSources.flatMap(({ file, source }) =>
      directDomActionContracts(file, source),
    ).sort();
    assert.deepEqual(
      directDomActions,
      [...DOCUMENTED_DIRECT_DOM_ACTION_EXCEPTIONS.keys()].sort(),
    );
    for (const rationale of DOCUMENTED_DIRECT_DOM_ACTION_EXCEPTIONS.values()) {
      assert.ok(rationale.length >= 20);
    }

    const fontRowSource = readFileSync(
      "src/components/catalog/font-row.tsx",
      "utf8",
    );
    assert.doesNotMatch(fontRowSource, /aria-label=/);

    const denseHookSource = readFileSync(
      "src/hooks/use-dense-font-table.ts",
      "utf8",
    );
    const selectionProps = denseHookSource.slice(
      denseHookSource.indexOf("selectionProps:"),
      denseHookSource.indexOf("onClick: () => shell.selectFont"),
    );
    assert.doesNotMatch(selectionProps, /aria-label/);
  });
});
