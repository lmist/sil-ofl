import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  rememberChildProcessErrors,
  stopServer,
} from "./live-child-process";

const repeatedSignalFixture = fileURLToPath(
  new URL("./fixtures/live-repeated-signal.ts", import.meta.url),
);

function processIsRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ESRCH"
    ) {
      return false;
    }
    throw error;
  }
}

function processGroupIsRunning(processGroupId: number): boolean {
  return processIsRunning(-processGroupId);
}

function killProcessGroup(
  processGroupId: number,
  signal: NodeJS.Signals,
): void {
  try {
    process.kill(-processGroupId, signal);
  } catch (error) {
    if (
      !(
        error instanceof Error &&
        "code" in error &&
        error.code === "ESRCH"
      )
    ) {
      throw error;
    }
  }
}

async function waitForStopped(
  isRunning: () => boolean,
  description: string,
): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (!isRunning()) return;
    await delay(10);
  }
  assert.fail(`${description} remained alive after cleanup`);
}

describe("live child-process lifecycle", () => {
  test("resolves cleanup after Bun reports an asynchronous spawn error", async () => {
    const child = spawn(
      "/definitely-not-a-real-sil-ofl-live-smoke-executable",
    );
    rememberChildProcessErrors(child);
    const closed = new Promise<{
      code: number | null;
      signal: NodeJS.Signals | null | undefined;
    }>((resolve) => {
      child.once("close", (code, signal) => resolve({ code, signal }));
    });

    await Promise.race([
      stopServer(child),
      delay(500).then(() => {
        throw new Error("Spawn-error cleanup did not resolve");
      }),
    ]);
    const closeResult = await closed;

    assert.equal(child.pid, undefined);
    assert.equal(child.exitCode, null);
    assert.equal(closeResult.code, -2);
    assert.equal(closeResult.signal, undefined);
  });

  test("terminates and closes a running Bun child", async () => {
    const child = spawn(
      process.execPath,
      ["-e", "setInterval(() => undefined, 1_000)"],
      { stdio: "ignore" },
    );
    rememberChildProcessErrors(child);
    await once(child, "spawn");

    await stopServer(child);

    assert.ok(
      child.exitCode !== null || child.signalCode !== null,
      "Expected the child to close after termination",
    );
  });

  test("does not orphan a child that needs the same signal twice", async () => {
    const parent = spawn(process.execPath, [repeatedSignalFixture], {
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    assert.ok(parent.pid);
    const fixtureProcessGroup = parent.pid;
    const parentClosed = new Promise<{
      code: number | null;
      signal: NodeJS.Signals | null;
    }>((resolve, reject) => {
      parent.once("error", reject);
      parent.once("close", (code, signal) => resolve({ code, signal }));
    });
    assert.ok(parent.stdout);
    const lines = createInterface({ input: parent.stdout });
    const iterator = lines[Symbol.asyncIterator]();
    let childPid: number | null = null;

    const nextLine = async (): Promise<string> => {
      const result = await Promise.race([
        iterator.next(),
        delay(2_000).then(() => {
          throw new Error("Timed out waiting for signal fixture output");
        }),
      ]);
      assert.equal(result.done, false);
      return result.value;
    };

    try {
      const child = await nextLine();
      assert.match(child, /^CHILD=\d+$/);
      childPid = Number(child.slice("CHILD=".length));
      assert.ok(Number.isSafeInteger(childPid) && childPid > 0);
      assert.equal(await nextLine(), `READY=${childPid}`);

      assert.equal(parent.kill("SIGTERM"), true);
      assert.equal(await nextLine(), "SIGNAL=1");
      assert.equal(parent.kill("SIGTERM"), true);

      const secondSignal = await Promise.race([
        iterator.next(),
        delay(500).then(() => null),
      ]);
      if (secondSignal === null || secondSignal.done) {
        if (parent.exitCode === null && parent.signalCode === null) {
          assert.equal(parent.kill("SIGKILL"), true);
        }
        await parentClosed;
        assert.equal(
          processIsRunning(childPid),
          false,
          "Repeated SIGTERM left the child orphaned after its parent stopped",
        );
        return;
      }
      assert.equal(secondSignal.value, "SIGNAL=2");

      const result = await Promise.race([
        parentClosed,
        delay(2_000).then(() => {
          throw new Error("Repeated-signal fixture did not terminate");
        }),
      ]);
      assert.deepEqual(result, { code: null, signal: "SIGTERM" });
      assert.equal(
        processIsRunning(childPid),
        false,
        "Repeated SIGTERM orphaned the child process",
      );
    } finally {
      lines.close();
      killProcessGroup(fixtureProcessGroup, "SIGKILL");
      await Promise.race([
        parentClosed.catch(() => ({ code: null, signal: null })),
        delay(2_000).then(() => {
          throw new Error("Fixture parent remained alive after cleanup");
        }),
      ]);
      if (childPid !== null) {
        await waitForStopped(
          () => processIsRunning(childPid!),
          "Fixture child",
        );
      }
      await waitForStopped(
        () => processGroupIsRunning(fixtureProcessGroup),
        "Fixture process group",
      );
    }
  });
});
