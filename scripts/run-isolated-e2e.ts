import { spawn } from "node:child_process";
import { resolveIsolatedE2ePort } from "./isolated-e2e";
import { forwardTerminationSignals } from "./live-child-process";

const port = await resolveIsolatedE2ePort(process.env.CONDUCTOR_PORT);
const baseURL = `http://localhost:${port}`;

console.log(`Running isolated Playwright at ${baseURL} with server reuse disabled`);

const tests = spawn(
  process.execPath,
  ["run", "test:e2e:playwright", ...process.argv.slice(2)],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PLAYWRIGHT_BASE_URL: baseURL,
      PLAYWRIGHT_FORCE_NEW_SERVER: "1",
      PORT: String(port),
    },
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
if (result === null) throw new Error("Playwright child returned no result");

if (result.signal) {
  process.kill(process.pid, result.signal);
  await new Promise<never>(() => {});
}
process.exit(result.code ?? 1);
