import { createYoga, type Plugin } from "graphql-yoga";
import type { NextRequest } from "next/server";
import { schema } from "@/graphql/schema";
import { getSql } from "@/lib/db";
import type { GraphQLContext } from "@/graphql/schema/builder";

const isProd = process.env.NODE_ENV === "production";

/** Short SWR-friendly caches for safe read-only operations. */
function cacheControlForQuery(query: string | null | undefined): string {
  if (!query) return "private, no-store";
  // Prefer named operations / field selection over full-document scan
  if (/\bhealth\b/.test(query) && !/\bfonts\b/.test(query) && !/\brepos\b/.test(query)) {
    return "public, s-maxage=60, stale-while-revalidate=300";
  }
  if (/\bstats\b/.test(query) && !/\bfonts\b/.test(query) && !/\brepos\b/.test(query)) {
    return "public, s-maxage=60, stale-while-revalidate=300";
  }
  // Font/repo lists are cacheable briefly; single-id lookups still fine to SWR
  if (/\bfonts\b|\brepos\b|\bfont\b|\brepo\b/.test(query)) {
    return "public, s-maxage=15, stale-while-revalidate=60";
  }
  return "private, no-store";
}

const cachePlugin: Plugin = {
  onResultProcess({ result, serverContext, setResult }) {
    // Attach cache hint for the route wrapper via weak map on context if needed.
    void result;
    void serverContext;
    void setResult;
  },
};

const yoga = createYoga<
  { request: Request },
  GraphQLContext
>({
  schema,
  graphqlEndpoint: "/api/graphql",
  // GraphiQL only in non-production (GET playground)
  graphiql: !isProd,
  fetchAPI: { Response, Request },
  plugins: [cachePlugin],
  context: async (): Promise<GraphQLContext> => ({
    sql: getSql(),
  }),
  // Soft complexity: reject oversized first via resolvers; also cap depth-ish via masked errors
  maskedErrors: isProd,
});

async function readQueryText(request: NextRequest, bodyText: string | null): Promise<string | null> {
  const url = new URL(request.url);
  const q = url.searchParams.get("query");
  if (q) return q;
  if (!bodyText) return null;
  try {
    const json = JSON.parse(bodyText) as { query?: string };
    return json.query ?? null;
  } catch {
    return null;
  }
}

async function handle(request: NextRequest): Promise<Response> {
  // Buffer body so we can both forward it to Yoga and inspect for cache headers.
  let bodyText: string | null = null;
  if (request.method !== "GET" && request.method !== "HEAD") {
    bodyText = await request.text();
  }

  const init: RequestInit = {
    method: request.method,
    headers: request.headers,
  };
  if (bodyText !== null) {
    init.body = bodyText;
  }

  const yogaRequest = new Request(request.url, init);
  const response = await yoga.fetch(yogaRequest);

  const query = await readQueryText(request, bodyText);
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", cacheControlForQuery(query));
  // Help CDN vary on body for POST is limited; GET query-string is ideal for edge cache.
  headers.set("Vary", "Accept, Content-Type");
  // Ensure JSON Content-Type for GraphQL responses (Yoga usually sets this).
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json; charset=utf-8");
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export async function GET(request: NextRequest): Promise<Response> {
  // In production GraphiQL is off; GET still serves GraphQL-over-HTTP queries.
  return handle(request);
}

export async function POST(request: NextRequest): Promise<Response> {
  return handle(request);
}

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return handle(request);
}

// Node.js is the default runtime. Route segment configs (runtime / dynamic)
// are incompatible with cacheComponents — Yoga + Neon use request body I/O.
