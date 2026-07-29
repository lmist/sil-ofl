import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { forwardTerminationSignals } from "./live-child-process";

async function findFiles(directory: string, suffix: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await findFiles(path, suffix)));
    } else if (entry.isFile() && entry.name.endsWith(suffix)) {
      files.push(path);
    }
  }
  return files;
}

const testFiles = [
  ...(await findFiles("src", ".test.ts")),
  ...(await findFiles("e2e", ".unit.test.ts")),
  ...(await findFiles("scripts", ".test.ts")),
];
testFiles.sort();

if (testFiles.length === 0) {
  console.error("No test files found");
  process.exit(1);
}

console.log(
  `Running ${testFiles.length} test files with Bun:\n${testFiles.join("\n")}`,
);

const tests = spawn(
  process.execPath,
  ["test", ...process.argv.slice(2), ...testFiles],
  {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  },
);

const forwardedSignals = forwardTerminationSignals(tests);

let result: {
  code: number | null;
  signal: NodeJS.Signals | null;
} | null = null;
let failure: { error: unknown } | null = null;
try {
  result = await new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((resolve, reject) => {
    tests.once("error", reject);
    tests.once("exit", (code, signal) => {
      resolve({ code, signal });
    });
  });
} catch (error) {
  failure = { error };
} finally {
  forwardedSignals.removeHandlers();
}

if (forwardedSignals.firstSignal !== null) {
  process.kill(process.pid, forwardedSignals.firstSignal);
  await new Promise<never>(() => {});
}
if (failure) throw failure.error;
if (result === null) throw new Error("Test child returned no result");

if (result.signal) {
  process.kill(process.pid, result.signal);
  await new Promise<never>(() => {});
}
process.exit(result.code ?? 1);
