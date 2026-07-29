import { spawn } from "node:child_process";
import { resolveIsolatedE2ePort } from "./isolated-e2e";

const port = await resolveIsolatedE2ePort(process.env.CONDUCTOR_PORT);
const baseURL = `http://localhost:${port}`;

console.log(`Running isolated Playwright at ${baseURL} with server reuse disabled`);

const tests = spawn(
  process.execPath,
  ["run", "test:e2e", ...process.argv.slice(2)],
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
