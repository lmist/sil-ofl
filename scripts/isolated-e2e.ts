import { createServer } from "node:net";

export function conductorCompanionPort(
  value: string | undefined,
): number | null {
  if (value == null || value.trim() === "") return null;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port >= 65_535) {
    throw new Error("Expected a valid CONDUCTOR_PORT from 1 through 65534");
  }
  return port + 1;
}

export async function resolveIsolatedE2ePort(
  conductorPort: string | undefined,
): Promise<number> {
  const companionPort = conductorCompanionPort(conductorPort);
  if (companionPort != null) return companionPort;

  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  if (address == null || typeof address === "string") {
    throw new Error("Could not allocate an isolated E2E port");
  }
  return address.port;
}
