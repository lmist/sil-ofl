import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import {
  forwardTerminationSignals,
  stopServer,
} from "../live-child-process";

const fixturePath = fileURLToPath(import.meta.url);

async function runSignalCountingChild(): Promise<never> {
  let signalCount = 0;
  process.on("SIGTERM", () => {
    signalCount += 1;
    process.stdout.write(`SIGNAL=${signalCount}\n`);
    if (signalCount === 2) process.exit(0);
  });
  process.stdout.write(`READY=${process.pid}\n`);
  return await new Promise<never>(() => {});
}

async function runForwardingParent(): Promise<never> {
  const child = spawn(process.execPath, [fixturePath, "child"], {
    stdio: ["ignore", "pipe", "ignore"],
  });
  const forwardedSignals = forwardTerminationSignals(child);
  if (child.pid !== undefined) {
    process.stdout.write(`CHILD=${child.pid}\n`);
  }
  child.stdout?.pipe(process.stdout);

  let failure: { error: unknown } | null = null;
  try {
    await once(child, "close");
  } catch (error) {
    failure = { error };
    try {
      await stopServer(child);
    } catch (cleanupError) {
      failure ??= { error: cleanupError };
    }
  } finally {
    forwardedSignals.removeHandlers();
  }

  if (forwardedSignals.firstSignal !== null) {
    process.kill(process.pid, forwardedSignals.firstSignal);
    await new Promise<never>(() => {});
  }
  if (failure) throw failure.error;

  throw new Error("Fixture parent expected a forwarded termination signal");
}

if (process.argv[2] === "child") {
  await runSignalCountingChild();
} else {
  await runForwardingParent();
}
