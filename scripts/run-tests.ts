import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

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

const forwardedSignals: NodeJS.Signals[] = ["SIGHUP", "SIGINT", "SIGTERM"];
const signalHandlers = new Map<NodeJS.Signals, () => void>();
for (const signal of forwardedSignals) {
  const handler = () => {
    tests.kill(signal);
  };
  signalHandlers.set(signal, handler);
  process.once(signal, handler);
}

const result = await new Promise<{
  code: number | null;
  signal: NodeJS.Signals | null;
}>((resolve, reject) => {
  tests.once("error", reject);
  tests.once("exit", (code, signal) => {
    resolve({ code, signal });
  });
});

for (const [signal, handler] of signalHandlers) {
  process.removeListener(signal, handler);
}

if (result.signal) {
  process.kill(process.pid, result.signal);
  await new Promise(() => {});
}

process.exit(result.code ?? 1);
