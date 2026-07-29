import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { describe, test } from "node:test";

const [
  accessibilityE2e,
  catalogE2e,
  invariants,
  issueRegisterSource,
  liveChildProcessSource,
  liveSmokeSource,
  packageJsonSource,
  paginationSource,
  qaReport,
  runIsolatedE2eSource,
  runTestsSource,
  siteMap,
  statsSource,
  uiTestReport,
  userStories,
] = await Promise.all([
  readFile("e2e/a11y-layout.spec.ts", "utf8"),
  readFile("e2e/catalog.spec.ts", "utf8"),
  readFile("INVARIANTS.md", "utf8"),
  readFile(".beads/issues.jsonl", "utf8"),
  readFile("scripts/live-child-process.ts", "utf8"),
  readFile("scripts/live-graphql-smoke.ts", "utf8"),
  readFile("package.json", "utf8"),
  readFile("src/components/catalog/pagination-controls.tsx", "utf8"),
  readFile("QA_REPORT.md", "utf8"),
  readFile("scripts/run-isolated-e2e.ts", "utf8"),
  readFile("scripts/run-tests.ts", "utf8"),
  readFile("SITE_MAP.md", "utf8"),
  readFile("src/hooks/use-stats-strip.ts", "utf8"),
  readFile("UI_TEST_REPORT.html", "utf8"),
  readFile("USER_STORIES.md", "utf8"),
]);
const packageJson = JSON.parse(packageJsonSource) as {
  scripts: Record<string, string>;
};

function markdownSection(markdown: string, heading: string): string {
  const marker = `## ${heading}`;
  const start = markdown.indexOf(marker);
  assert.notEqual(start, -1, `Missing ${marker}`);
  const contentStart = start + marker.length;
  const nextHeading = markdown.indexOf("\n## ", contentStart);
  return markdown.slice(
    contentStart,
    nextHeading === -1 ? markdown.length : nextHeading,
  );
}

function markdownSubsection(markdown: string, heading: string): string {
  const marker = `### ${heading}`;
  const start = markdown.indexOf(marker);
  assert.notEqual(start, -1, `Missing ${marker}`);
  const contentStart = start + marker.length;
  const nextSubsection = markdown.indexOf("\n### ", contentStart);
  const nextSection = markdown.indexOf("\n## ", contentStart);
  const candidates = [nextSubsection, nextSection].filter(
    (index) => index !== -1,
  );
  return markdown.slice(
    contentStart,
    candidates.length === 0 ? markdown.length : Math.min(...candidates),
  );
}

describe("artifact contracts", () => {
  test("maps the four statistics rendered by the catalog", () => {
    for (const label of ["Fonts", "Repos", "Owners", "Matched"]) {
      assert.match(statsSource, new RegExp(`label: "${label}"`));
    }
    assert.match(
      siteMap,
      /`Fonts`, `Repos`, `Owners`, and `Matched` statistics/,
    );
    assert.match(
      userStories,
      /Fonts, Repos, Owners, and Matched statistics/,
    );
    assert.doesNotMatch(
      `${siteMap}\n${userStories}`,
      /repository-with-files|populated-repository/i,
    );
  });

  test("retains a reproducible live GraphQL smoke command", async () => {
    assert.equal(
      packageJson.scripts["test:live"],
      "bun --env-file=.env.local scripts/live-graphql-smoke.ts",
    );
    await assert.doesNotReject(
      access("scripts/live-graphql-smoke.ts"),
    );
    assert.match(
      qaReport,
      /\[`bun run test:live`\]\(scripts\/live-graphql-smoke\.ts\)/,
    );
  });

  test("maps every pagination action", () => {
    assert.match(paginationSource, /page\.clearProps/);
    assert.match(siteMap, /Previous, Next, and Clear pagination controls/);
  });

  test("uses one declared normative vocabulary", () => {
    assert.match(
      invariants,
      /\*\*MUST\*\*, \*\*MUST NOT\*\*, \*\*SHOULD\*\*, and \*\*MAY\*\* are normative/,
    );
    assert.doesNotMatch(invariants, /\bMUST not\b/);
    assert.doesNotMatch(invariants, /\bmay\b/);
  });

  test("maps every invariant to production and regression seams", async () => {
    const invariantIds = [
      ...invariants.matchAll(/^### (INV-[A-Z0-9-]+) —/gm),
    ].map((match) => match[1]!);
    assert.equal(invariantIds.length, 47);
    assert.equal(new Set(invariantIds).size, invariantIds.length);

    const enforcementMap = markdownSection(invariants, "Enforcement map");
    const mappedInvariantIds = [
      ...enforcementMap.matchAll(/^- `(INV-[A-Z0-9-]+)`/gm),
    ].map((match) => match[1]!);
    assert.deepEqual(mappedInvariantIds, invariantIds);

    for (const invariantId of invariantIds) {
      const entry = enforcementMap.match(
        new RegExp(
          `(?:^|\\n)- \`${invariantId}\`[\\s\\S]*?(?=\\n- \`INV-|\\n### |$)`,
        ),
      )?.[0];
      assert.ok(entry, `Missing enforcement mapping for ${invariantId}`);
      const regressionMarker = entry.search(/Regression(?:s)?:/);
      assert.notEqual(
        regressionMarker,
        -1,
        `Missing regression section for ${invariantId}`,
      );
      const productionSection = entry.slice(0, regressionMarker);
      const regressionSection = entry.slice(regressionMarker);
      assert.match(
        productionSection,
        /Production:[\s\S]*\[[^\]]+\]\([^)]+\)/,
        `Missing production seam for ${invariantId}`,
      );
      assert.match(
        regressionSection,
        /Regression(?:s)?:[\s\S]*\[[^\]]+\]\((?:e2e|scripts|src)\/[^)]+\.(?:test|spec)\.ts\)/,
        `Missing retained regression for ${invariantId}`,
      );
      const linkedPaths = [
        ...entry.matchAll(/\]\(([^)#]+)(?:#[^)]+)?\)/g),
      ].map((match) => match[1]!);
      assert.ok(linkedPaths.length >= 2);
      for (const linkedPath of linkedPaths) {
        await assert.doesNotReject(
          access(linkedPath),
          `Missing enforcement link for ${invariantId}: ${linkedPath}`,
        );
      }
    }
  });

  test("limits the worktree claim to retained regression evidence", () => {
    assert.doesNotMatch(qaReport, /conflict-free semantic integration/i);
    assert.match(
      qaReport,
      /nine repository and isolation contract tests passed/,
    );
  });

  test("reconciles every companion artifact with the closed issue ledger", () => {
    for (const path of [
      "SITE_MAP.md",
      "USER_STORIES.md",
      "INVARIANTS.md",
      ".beads/issues.jsonl",
    ]) {
      assert.match(
        qaReport,
        new RegExp(`\\[${path.replace(".", "\\.")}\\]\\(${path.replace(".", "\\.")}\\)`),
      );
    }

    type IssueRow = {
      _type?: string;
      id?: string;
      status?: string;
      close_reason?: string;
      dependencies?: Array<{
        depends_on_id?: string;
        type?: string;
      }>;
    };
    const issues = issueRegisterSource
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as IssueRow)
      .filter((row) => row._type === "issue");
    const epic = issues.find((issue) => issue.id === "silofl-pzs");
    const findings = issues.filter((issue) =>
      issue.dependencies?.some(
        (dependency) =>
          dependency.depends_on_id === "silofl-pzs" &&
          dependency.type === "parent-child",
      ),
    );

    assert.equal(findings.length, 126);

    const reportedFindingNumbers = [
      ...qaReport.matchAll(/\| `silofl-pzs\.(\d+)` \|/g),
    ].map((match) => Number(match[1]));
    assert.deepEqual(
      reportedFindingNumbers,
      Array.from({ length: 126 }, (_, index) => index + 1),
    );
    assert.match(qaReport, /224 passed across 23 files/);
    assert.match(qaReport, /85 passed in isolated headless Chromium/);
    assert.match(
      uiTestReport,
      /126 findings: 125 reproduced defects with/,
    );
    assert.match(
      uiTestReport,
      /<strong>85<\/strong>\s*<span>isolated browser scenarios passed/,
    );
    assert.match(
      uiTestReport,
      /Accessibility and layout[\s\S]{0,300}29 passed/,
    );

    assert.equal(epic?.status, "closed");
    assert.deepEqual(
      findings
        .filter((finding) => finding.status !== "closed")
        .map((finding) => finding.id),
      [],
    );
    assert.deepEqual(
      findings
        .filter((finding) =>
          /not reproducible/i.test(finding.close_reason ?? ""),
        )
        .map((finding) => finding.id),
      ["silofl-pzs.30"],
    );
  });

  test("keeps browser concurrency stories outside the API section", () => {
    const browserConcurrency = markdownSection(
      userStories,
      "Browser concurrency and cache isolation",
    );
    const graphqlConsumer = markdownSection(userStories, "GraphQL consumer");
    for (const phrase of [
      "hover, focus, and click",
      "retry backoff",
      "disabled debounce draft",
    ]) {
      assert.match(browserConcurrency, new RegExp(phrase));
      assert.doesNotMatch(graphqlConsumer, new RegExp(phrase));
    }

    const storyNumbers = [...userStories.matchAll(/^(\d+)\. /gm)].map(
      (match) => Number(match[1]),
    );
    assert.deepEqual(
      storyNumbers,
      Array.from({ length: 128 }, (_, index) => index + 1),
    );
  });

  test("bounds every live-smoke HTTP request", () => {
    assert.match(liveSmokeSource, /AbortSignal\.timeout\(/);
    assert.match(liveSmokeSource, /LIVE_REQUEST_TIMEOUT_MS/);
  });

  test("forwards termination signals through every Bun child runner", () => {
    for (const signal of ["SIGHUP", "SIGINT", "SIGTERM"]) {
      assert.match(liveChildProcessSource, new RegExp(`"${signal}"`));
    }
    assert.match(
      liveSmokeSource,
      /forwardTerminationSignals\(server\)/,
    );
    assert.match(liveChildProcessSource, /process\.on\(signal, handler\)/);
    assert.match(liveChildProcessSource, /child\.kill\(signal\)/);
    for (const runnerSource of [
      liveSmokeSource,
      runIsolatedE2eSource,
      runTestsSource,
    ]) {
      assert.match(runnerSource, /forwardTerminationSignals\(/);
      assert.match(runnerSource, /\.removeHandlers\(\)/);
      assert.doesNotMatch(
        runnerSource,
        /process\.once\(signal, handler\)/,
      );
    }
    for (const runnerSource of [runIsolatedE2eSource, runTestsSource]) {
      assert.match(
        runnerSource,
        /let failure: \{ error: unknown \} \| null = null;/,
      );
      assert.match(runnerSource, /failure = \{ error \};/);
      assert.match(
        runnerSource,
        /finally \{\s*forwardedSignals\.removeHandlers\(\);\s*}/,
      );
      const parentSignalOutcome = runnerSource.indexOf(
        "if (forwardedSignals.firstSignal !== null)",
      );
      const spawnFailureOutcome = runnerSource.indexOf(
        "if (failure) throw failure.error",
      );
      assert.ok(parentSignalOutcome >= 0);
      assert.ok(spawnFailureOutcome > parentSignalOutcome);
    }
    assert.equal(
      [
        ...liveSmokeSource.matchAll(
          /forwardedSignals\.removeHandlers\(\)/g,
        ),
      ].length,
      2,
    );
  });

  test("forwards every received termination signal", () => {
    assert.match(
      liveChildProcessSource,
      /firstSignal \?\?= signal;\s*child\.kill\(signal\);/,
    );
    assert.doesNotMatch(
      liveChildProcessSource,
      /if \(firstSignal !== null\) return;/,
    );
    assert.doesNotMatch(
      liveChildProcessSource,
      /process\.once\(signal, handler\)/,
    );
  });

  test("forwards termination signals during the production build", () => {
    const runBuildStart = liveSmokeSource.indexOf(
      "async function runBuild",
    );
    const runBuildEnd = liveSmokeSource.indexOf(
      "\nawait runBuild();",
    );
    assert.notEqual(runBuildStart, -1);
    assert.notEqual(runBuildEnd, -1);
    const runBuildSource = liveSmokeSource.slice(
      runBuildStart,
      runBuildEnd,
    );
    assert.match(runBuildSource, /forwardTerminationSignals\(build\)/);
    assert.match(runBuildSource, /forwardedSignals\.removeHandlers\(\)/);
    assert.match(
      liveChildProcessSource,
      /removeHandlers\(\) \{[\s\S]*process\.off\(signal, handler\)/,
    );
  });

  test("captures asynchronous live-server spawn errors", () => {
    assert.match(
      liveSmokeSource,
      /rememberChildProcessErrors\(server\);/,
    );
    assert.match(
      liveChildProcessSource,
      /childProcessErrors\.get\(server\)/,
    );
  });

  test("uses an unambiguous caught-failure sentinel", () => {
    assert.match(
      liveSmokeSource,
      /let failure: \{ error: unknown \} \| null = null;/,
    );
    assert.match(liveSmokeSource, /failure = \{ error \};/);
    assert.match(liveSmokeSource, /if \(failure\) throw failure\.error;/);
  });

  test("cancels every non-ready response body", () => {
    assert.match(
      liveSmokeSource,
      /if \(response\.status === 200\)[\s\S]*break;\s*}\s*await response\.body\?\.cancel\(\);/,
    );
  });

  test("detects every child-process exit mode during readiness", () => {
    assert.match(
      liveChildProcessSource,
      /function assertServerRunning\(server: ChildProcess\)[\s\S]*server\.exitCode[\s\S]*server\.signalCode/,
    );
    assert.match(
      liveSmokeSource,
      /while \(Date\.now\(\) < deadline\) \{\s*assertServerRunning\(server\);/,
    );
  });

  test("cancels the losing live-server shutdown timer", () => {
    assert.match(liveChildProcessSource, /shutdownTimer\.unref\(\)/);
    assert.match(liveChildProcessSource, /clearTimeout\(shutdownTimer\)/);
  });

  test("does not await exit after an asynchronous spawn failure", () => {
    assert.match(
      liveChildProcessSource,
      /async function stopServer\(server: ChildProcess\)[\s\S]*childProcessErrors\.has\(server\)[\s\S]*server\.pid === undefined[\s\S]*return;/,
    );
  });

  test("maps arbitrary text and safe error copy to containment regressions", () => {
    const filterEnforcement = markdownSubsection(
      markdownSection(invariants, "Enforcement map"),
      "Filters and URL state",
    );
    assert.match(
      filterEnforcement,
      /\[filter chips\]\(src\/components\/catalog\/filter-chips\.tsx\)/,
    );
    assert.match(
      filterEnforcement,
      /\[accessibility\/layout browser suite\]\(e2e\/a11y-layout\.spec\.ts\)/,
    );
    for (const link of [
      "[font row](src/components/catalog/font-row.tsx)",
      "[font specimen](src/components/catalog/font-specimen.tsx)",
      "[dense table](src/components/catalog/dense-font-table.tsx)",
      "[font use panel](src/components/catalog/font-use-panel.tsx)",
      "[font list](src/components/catalog/font-list.tsx)",
    ]) {
      assert.match(filterEnforcement, new RegExp(
        link.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      ));
    }
    for (const fixture of [
      "EXTREME_FILENAME",
      "EXTREME_REPOSITORY",
      "EXTREME_ERROR",
    ]) {
      assert.match(accessibilityE2e, new RegExp(fixture));
    }
    assert.match(accessibilityE2e, /familyGuess: null/);
    assert.match(
      accessibilityE2e,
      /installFontRequestFailure\(page, EXTREME_ERROR\)/,
    );
    assert.match(
      filterEnforcement,
      /\[specimen\/export browser suite\]\(e2e\/specimen-export\.spec\.ts\)/,
    );
  });

  test("maps and tests the document heading and title", () => {
    const accessibilityEnforcement = markdownSubsection(
      markdownSection(invariants, "Enforcement map"),
      "Accessibility",
    );
    assert.match(
      accessibilityEnforcement,
      /\[root layout metadata\]\(src\/app\/layout\.tsx\)/,
    );
    assert.match(
      accessibilityEnforcement,
      /\[catalog heading\]\(src\/components\/catalog\/catalog-island\.tsx\)/,
    );
    assert.match(
      accessibilityEnforcement,
      /\[catalog skeleton\]\(src\/components\/catalog\/catalog-skeleton\.tsx\)/,
    );
    assert.match(catalogE2e, /toHaveTitle\("SIL OFL Fonts"\)/);
    assert.match(
      accessibilityE2e,
      /loadingPage\.getByRole\("heading", \{\s*level: 1,?\s*\}\)[\s\S]{0,100}\.toHaveCount\(1\)/,
    );
    assert.match(
      accessibilityE2e,
      /await expect\(\s*page\.getByRole\("heading", \{\s*level: 1,?\s*\}\),?\s*\)[\s\S]{0,40}\.toHaveCount\(1\)/,
    );
    assert.match(
      catalogE2e,
      /page\.locator\("head > title"\)[\s\S]{0,60}\.toHaveCount\(1\)/,
    );
  });

  test("retains a behavioral reduced-motion regression", () => {
    const accessibilityEnforcement = markdownSubsection(
      markdownSection(invariants, "Enforcement map"),
      "Accessibility",
    );
    assert.match(
      accessibilityEnforcement,
      /\[global styles\]\(src\/app\/globals\.css\)/,
    );
    assert.match(
      accessibilityE2e,
      /test\("honors reduced motion for catalog transitions"/,
    );
    assert.match(accessibilityE2e, /maxTransitionMs/);
    assert.match(accessibilityE2e, /maxAnimationMs/);
    assert.match(accessibilityE2e, /maxAnimationIterations/);
    assert.match(accessibilityE2e, /"::before"/);
    assert.match(accessibilityE2e, /"::after"/);
    assert.match(accessibilityE2e, /data-reduced-motion-probe/);
    assert.match(
      accessibilityE2e,
      /\[data-reduced-motion-probe\]::before/,
    );
    assert.match(
      accessibilityE2e,
      /\[data-reduced-motion-probe\]::after/,
    );
    assert.match(accessibilityE2e, /probeScrollBehavior/);
  });
});
