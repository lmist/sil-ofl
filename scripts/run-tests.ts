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
  ...(await findFiles("e2e", ".unit.ts")),
];
testFiles.sort();

if (testFiles.length === 0) {
  console.error("No test files found");
  process.exit(1);
}

console.log(`Running ${testFiles.length} test files:\n${testFiles.join("\n")}`);

const tests = spawn("tsx", ["--test", ...testFiles], {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit",
});

const exitCode = await new Promise<number>((resolve, reject) => {
  tests.once("error", reject);
  tests.once("exit", (code, signal) => {
    if (signal) {
      reject(new Error(`Test runner exited from signal ${signal}`));
      return;
    }
    resolve(code ?? 1);
  });
});

process.exit(exitCode);
