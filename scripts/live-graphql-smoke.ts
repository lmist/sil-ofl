import assert from "node:assert/strict";
import { once } from "node:events";
import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { ACCEPTED_PUBLIC_FONT_LICENSES } from "../src/graphql/schema/public-font-policy";
import { approvedExternalUrl } from "../src/lib/external-url-policy";
import { resolveIsolatedE2ePort } from "./isolated-e2e";
import {
  assertServerRunning,
  forwardTerminationSignals,
  rememberChildProcessErrors,
  stopServer,
} from "./live-child-process";

const LIVE_REQUEST_TIMEOUT_MS = 30_000;

assert.ok(
  process.env.DATABASE_URL,
  "DATABASE_URL is required; populate .env.local before running the live smoke",
);

async function fetchWithDeadline(
  server: ChildProcess,
  input: string | URL,
  init: RequestInit = {},
  timeoutMs = LIVE_REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const serverExitController = new AbortController();
  const abortForServerExit = () => {
    serverExitController.abort(
      new Error("Production server exited during an HTTP request"),
    );
  };
  server.once("exit", abortForServerExit);
  server.once("error", abortForServerExit);

  try {
    assertServerRunning(server);
    const signals = [
      AbortSignal.timeout(timeoutMs),
      serverExitController.signal,
    ];
    if (init.signal) signals.push(init.signal);
    return await fetch(input, {
      ...init,
      signal: AbortSignal.any(signals),
    });
  } finally {
    server.off("exit", abortForServerExit);
    server.off("error", abortForServerExit);
  }
}

async function runBuild(): Promise<void> {
  const build = spawn(process.execPath, ["run", "build"], {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });
  const forwardedSignals = forwardTerminationSignals(build);

  let result:
    | [number | null, NodeJS.Signals | null]
    | null = null;
  let failure: { error: unknown } | null = null;
  try {
    result = (await once(build, "exit")) as [
      number | null,
      NodeJS.Signals | null,
    ];
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
  assert.ok(result);
  const [code, signal] = result;
  assert.equal(signal, null, `Production build stopped by ${signal}`);
  assert.equal(code, 0, "Production build failed");
}

await runBuild();

const port = await resolveIsolatedE2ePort(undefined);
const endpoint = `http://localhost:${port}/api/graphql`;
const accept = "application/graphql-response+json";
const server = spawn(
  process.execPath,
  ["node_modules/next/dist/bin/next", "start"],
  {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port) },
    stdio: "inherit",
  },
);
rememberChildProcessErrors(server);
const forwardedSignals = forwardTerminationSignals(server);

const healthUrl = new URL(endpoint);
healthUrl.searchParams.set(
  "query",
  "query Health { health { ok service ts } }",
);
healthUrl.searchParams.set("operationName", "Health");

let healthResponse: Response | null = null;
let failure: { error: unknown } | null = null;
try {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    assertServerRunning(server);
    try {
      const response = await fetchWithDeadline(
        server,
        healthUrl,
        { headers: { Accept: accept } },
        Math.max(
          1,
          Math.min(LIVE_REQUEST_TIMEOUT_MS, deadline - Date.now()),
        ),
      );
      if (response.status === 200) {
        healthResponse = response;
        break;
      }
      await response.body?.cancel();
    } catch {
      assertServerRunning(server);
      // The server has not bound its port yet.
    }
    await delay(100);
  }

  assertServerRunning(server);
  assert.ok(healthResponse, "Production server did not become ready");
  assert.match(
    healthResponse.headers.get("Cache-Control") ?? "",
    /^public,/,
  );
  assert.match(
    healthResponse.headers.get("Content-Type") ?? "",
    /^application\/graphql-response\+json;/,
  );

  const healthResult = (await healthResponse.json()) as {
    data?: {
      health?: { ok?: boolean; service?: string; ts?: string };
    };
  };
  assert.equal(healthResult.data?.health?.ok, true);
  assert.equal(
    healthResult.data?.health?.service,
    "sil-ofl-fonts-graphql",
  );
  assert.ok(
    Number.isFinite(Date.parse(healthResult.data?.health?.ts ?? "")),
  );

  const catalogResponse = await fetchWithDeadline(server, endpoint, {
    method: "POST",
    headers: {
      Accept: accept,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      operationName: "LiveCatalogSmoke",
      query: `
        query LiveCatalogSmoke {
          stats {
            repos
            fontFiles
            owners
            reposWithFiles
          }
          fonts(first: 3) {
            totalCount
            edges {
              node {
                fontFileId
                familyGuess
                licenseSpdx
                cdnUrl
                rawUrl
              }
            }
          }
        }
      `,
    }),
  });
  assert.equal(catalogResponse.status, 200);
  assert.equal(
    catalogResponse.headers.get("Cache-Control"),
    "private, no-store",
  );
  assert.match(
    catalogResponse.headers.get("Content-Type") ?? "",
    /^application\/graphql-response\+json;/,
  );

  type LiveCatalogResult = {
    data?: {
      stats?: {
        repos?: number;
        fontFiles?: number;
        owners?: number;
        reposWithFiles?: number;
      };
      fonts?: {
        totalCount?: number;
        edges?: Array<{
          node?: {
            fontFileId?: number;
            familyGuess?: string | null;
            licenseSpdx?: string;
            cdnUrl?: string;
            rawUrl?: string;
          };
        }>;
      };
    };
    errors?: Array<{ message?: string }>;
  };

  const catalogResult =
    (await catalogResponse.json()) as LiveCatalogResult;
  assert.equal(catalogResult.errors, undefined);
  const stats = catalogResult.data?.stats;
  const fonts = catalogResult.data?.fonts;
  assert.ok(stats);
  assert.ok(fonts);
  for (const count of [
    stats.repos,
    stats.fontFiles,
    stats.owners,
    stats.reposWithFiles,
  ]) {
    assert.ok(Number.isSafeInteger(count) && count! >= 0);
  }
  assert.equal(fonts.totalCount, stats.fontFiles);
  assert.equal(fonts.edges?.length, 3);

  for (const edge of fonts.edges ?? []) {
    const node = edge.node;
    assert.ok(node);
    assert.ok(
      Number.isSafeInteger(node.fontFileId) && node.fontFileId! > 0,
    );
    assert.ok(
      ACCEPTED_PUBLIC_FONT_LICENSES.includes(
        node.licenseSpdx as (typeof ACCEPTED_PUBLIC_FONT_LICENSES)[number],
      ),
    );
    assert.ok(approvedExternalUrl(node.cdnUrl, "fontCdn"));
    assert.ok(approvedExternalUrl(node.rawUrl, "fontRaw"));
  }

  console.log(
    JSON.stringify({
      health: {
        ok: healthResult.data?.health?.ok,
        service: healthResult.data?.health?.service,
      },
      stats,
      sampledFonts: fonts.edges?.map(({ node }) => ({
        fontFileId: node?.fontFileId,
        familyGuess: node?.familyGuess,
        licenseSpdx: node?.licenseSpdx,
      })),
    }),
  );
} catch (error) {
  failure = { error };
} finally {
  try {
    await stopServer(server);
  } catch (error) {
    failure ??= { error };
  } finally {
    forwardedSignals.removeHandlers();
  }
}

if (forwardedSignals.firstSignal !== null) {
  process.kill(process.pid, forwardedSignals.firstSignal);
  await new Promise<never>(() => {});
}
if (failure) throw failure.error;
