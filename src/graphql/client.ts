import { GraphQLClient } from "graphql-request";

/**
 * Client choice: graphql-request + TanStack Query
 * ------------------------------------------------
 * Why not urql or Apollo Client?
 * - XState owns UI/interaction state; we do not want a second client cache/store.
 * - TanStack Query owns server-state (cache, stale time, pagination keys).
 * - graphql-request is a thin typed fetch — no React subscriptions, no links stack.
 * - Easy to call from machines (via actions) or Query hooks without provider soup.
 */

function resolveEndpoint(): string {
  // graphql-request v7 constructs `new URL(endpoint)` — relative paths throw.
  if (typeof window !== "undefined") {
    return `${window.location.origin}/api/graphql`;
  }
  const base =
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000");
  return `${base.replace(/\/$/, "")}/api/graphql`;
}

export function createGraphqlClient(endpoint = resolveEndpoint()) {
  return new GraphQLClient(endpoint, {
    headers: {
      "Content-Type": "application/json",
    },
  });
}

/** Browser singleton for client components / machines. */
let browserClient: GraphQLClient | null = null;

export function getGraphqlClient(): GraphQLClient {
  if (typeof window === "undefined") {
    return createGraphqlClient();
  }
  if (!browserClient) {
    browserClient = createGraphqlClient();
  }
  return browserClient;
}
