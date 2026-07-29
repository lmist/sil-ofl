import assert from "node:assert/strict";
import type { ChildProcess } from "node:child_process";
import { once } from "node:events";

const childProcessErrors = new WeakMap<ChildProcess, Error>();

export const LIVE_TERMINATION_SIGNALS: readonly NodeJS.Signals[] = [
  "SIGHUP",
  "SIGINT",
  "SIGTERM",
];

export type ForwardedTerminationSignals = {
  readonly firstSignal: NodeJS.Signals | null;
  removeHandlers: () => void;
};

export function forwardTerminationSignals(
  child: ChildProcess,
): ForwardedTerminationSignals {
  let firstSignal: NodeJS.Signals | null = null;
  const signalHandlers = new Map<NodeJS.Signals, () => void>();
  for (const signal of LIVE_TERMINATION_SIGNALS) {
    const handler = () => {
      firstSignal ??= signal;
      child.kill(signal);
    };
    signalHandlers.set(signal, handler);
    process.on(signal, handler);
  }

  return {
    get firstSignal() {
      return firstSignal;
    },
    removeHandlers() {
      for (const [signal, handler] of signalHandlers) {
        process.off(signal, handler);
      }
    },
  };
}

export function rememberChildProcessErrors(child: ChildProcess): void {
  child.once("error", (error) => {
    childProcessErrors.set(child, error);
  });
}

export function assertServerRunning(server: ChildProcess): void {
  assert.ifError(childProcessErrors.get(server));
  assert.ok(
    server.exitCode === null && server.signalCode === null,
    server.signalCode === null
      ? `Production server exited early with code ${server.exitCode}`
      : `Production server exited early after ${server.signalCode}`,
  );
}

export async function stopServer(server: ChildProcess): Promise<void> {
  if (
    childProcessErrors.has(server) ||
    server.pid === undefined ||
    server.exitCode !== null ||
    server.signalCode !== null
  ) {
    return;
  }

  const close = once(server, "close");
  server.kill("SIGTERM");
  let resolveShutdownTimeout: (stopped: boolean) => void = () => {};
  const shutdownTimeout = new Promise<boolean>((resolve) => {
    resolveShutdownTimeout = resolve;
  });
  const shutdownTimer = setTimeout(
    () => resolveShutdownTimeout(false),
    5_000,
  );
  shutdownTimer.unref();

  let stopped = false;
  try {
    stopped = await Promise.race([
      close.then(() => true),
      shutdownTimeout,
    ]);
  } finally {
    clearTimeout(shutdownTimer);
  }
  if (stopped) return;

  server.kill("SIGKILL");
  await close;
}
