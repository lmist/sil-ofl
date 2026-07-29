import {
  GraphQLError,
  getOperationAST,
  Kind,
  parse,
  type DocumentNode,
  type OperationDefinitionNode,
  type SelectionSetNode,
  type ValidationRule,
} from "graphql";
import { createYoga, type Plugin } from "graphql-yoga";
import { schema } from "@/graphql/schema";
import { getSql } from "@/lib/db";
import type { GraphQLContext } from "@/graphql/schema/builder";

const isProd = process.env.NODE_ENV === "production";
const NO_STORE = "private, no-store";
const MAX_GRAPHQL_REQUEST_BYTES = 32 * 1024;
const MAX_ALIASES = 20;
const MAX_DEPTH = 16;
const MAX_EXPENSIVE_ROOT_CONNECTIONS = 2;
const MAX_FIELD_SELECTIONS = 250;
const MAX_SELECTION_VISITS = 1_000;
const CORS_METHODS = ["GET", "POST", "OPTIONS"] as const;
const CORS_HEADERS = ["Accept", "Content-Type"] as const;
const CORS_METHOD_SET: ReadonlySet<string> = new Set(CORS_METHODS);
const CORS_HEADER_SET: ReadonlySet<string> = new Set(
  CORS_HEADERS.map((header) => header.toLowerCase()),
);
const CORS_VARY = [
  "Origin",
  "Access-Control-Request-Method",
  "Access-Control-Request-Headers",
] as const;
const CACHEABLE_ROOT_FIELDS = new Set([
  "health",
  "stats",
  "fonts",
  "font",
  "repos",
  "repo",
]);
const LONG_CACHE_ROOT_FIELDS = new Set(["health", "stats"]);
const EXPENSIVE_ROOT_FIELDS = new Set(["fonts", "repos"]);

function httpOrigin(value: string | undefined): string | null {
  if (!value) return null;

  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.origin
      : null;
  } catch {
    return null;
  }
}

function serializedHttpOrigin(value: string): string | null {
  const candidate = value.trim();
  const origin = httpOrigin(candidate);
  return origin === candidate ? origin : null;
}

function addConfiguredOrigin(
  origins: Set<string>,
  value: string | undefined,
): void {
  const origin = httpOrigin(value);
  if (origin) origins.add(origin);
}

function addVercelOrigin(
  origins: Set<string>,
  value: string | undefined,
): void {
  if (!value) return;
  addConfiguredOrigin(
    origins,
    value.includes("://") ? value : `https://${value}`,
  );
}

function isLoopbackOrigin(origin: string): boolean {
  const hostname = new URL(origin).hostname;
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]"
  );
}

function trustedCorsOrigins(request: Request): Set<string> {
  const origins = new Set<string>();

  addConfiguredOrigin(origins, process.env.NEXT_PUBLIC_APP_URL);
  for (const value of (process.env.GRAPHQL_ALLOWED_ORIGINS ?? "").split(",")) {
    const origin = serializedHttpOrigin(value);
    if (origin) origins.add(origin);
  }
  addVercelOrigin(origins, process.env.VERCEL_URL);
  addVercelOrigin(origins, process.env.VERCEL_BRANCH_URL);
  addVercelOrigin(origins, process.env.VERCEL_PROJECT_PRODUCTION_URL);

  const requestOrigin = httpOrigin(request.url);
  if (
    requestOrigin &&
    process.env.NODE_ENV !== "production" &&
    isLoopbackOrigin(requestOrigin)
  ) {
    const url = new URL(requestOrigin);
    const port = url.port ? `:${url.port}` : "";
    origins.add(`${url.protocol}//localhost${port}`);
    origins.add(`${url.protocol}//127.0.0.1${port}`);
    origins.add(`${url.protocol}//[::1]${port}`);
  }

  return origins;
}

function hasAllowedOrigin(request: Request): boolean {
  const origin = request.headers.get("Origin");
  if (origin === null) return true;

  const serializedOrigin = serializedHttpOrigin(origin);
  return (
    serializedOrigin !== null &&
    trustedCorsOrigins(request).has(serializedOrigin)
  );
}

function appendVary(headers: Headers, ...tokens: readonly string[]): void {
  const vary = new Map<string, string>();
  for (const token of headers.get("Vary")?.split(",") ?? []) {
    const trimmed = token.trim();
    if (trimmed) vary.set(trimmed.toLowerCase(), trimmed);
  }
  for (const token of tokens) {
    vary.set(token.toLowerCase(), token);
  }
  headers.set("Vary", [...vary.values()].join(", "));
}

function addCorsHeaders(
  request: Request,
  headers: Headers,
  preflight = false,
): void {
  const origin = request.headers.get("Origin");
  if (origin !== null) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Credentials", "true");
  }

  if (preflight) {
    headers.set("Access-Control-Allow-Methods", CORS_METHODS.join(", "));
    headers.set("Access-Control-Allow-Headers", CORS_HEADERS.join(", "));
    appendVary(headers, ...CORS_VARY);
  } else {
    appendVary(headers, "Origin");
  }
}

function forbiddenCorsResponse(): Response {
  const headers = new Headers({
    "Cache-Control": NO_STORE,
  });
  appendVary(headers, ...CORS_VARY);

  return new Response(null, {
    status: 403,
    headers,
  });
}

function graphqlErrorResponse(
  request: Request,
  status: number,
  message: string,
): Response {
  const headers = new Headers({
    "Cache-Control": NO_STORE,
    "Content-Type": "application/graphql-response+json; charset=utf-8",
  });
  appendVary(headers, "Accept", "Content-Type");
  addCorsHeaders(request, headers);

  return Response.json(
    {
      errors: [{ message }],
    },
    { status, headers },
  );
}

function hasValidSerializedObject(
  searchParams: URLSearchParams,
  parameter: "extensions" | "variables",
): boolean {
  const source = searchParams.get(parameter);
  if (source === null || source === "") return true;

  try {
    const variables: unknown = JSON.parse(source);
    return (
      variables === null ||
      (typeof variables === "object" && !Array.isArray(variables))
    );
  } catch {
    return false;
  }
}

function isFormEncodedRequest(request: Request): boolean {
  return (
    request.headers
      .get("Content-Type")
      ?.split(";")[0]
      ?.trim()
      .toLowerCase() === "application/x-www-form-urlencoded"
  );
}

async function boundedPostRequest(request: Request): Promise<Request | null> {
  const contentLength = request.headers.get("Content-Length");
  if (
    contentLength &&
    /^\d+$/.test(contentLength) &&
    Number(contentLength) > MAX_GRAPHQL_REQUEST_BYTES
  ) {
    return null;
  }
  if (!request.body) return request;

  const reader = request.body.getReader();
  const body = new Uint8Array(MAX_GRAPHQL_REQUEST_BYTES);
  let byteLength = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (byteLength + value.byteLength > MAX_GRAPHQL_REQUEST_BYTES) {
      await reader.cancel();
      return null;
    }
    body.set(value, byteLength);
    byteLength += value.byteLength;
  }

  const headers = new Headers(request.headers);
  headers.delete("Content-Length");
  return new Request(request.url, {
    method: request.method,
    headers,
    body: body.subarray(0, byteLength),
    signal: request.signal,
  });
}

/** Short SWR-friendly caches for safe read-only operations. */
function selectedRootFields(
  document: DocumentNode,
  operationName: string | null,
): Set<string> | null {
  const operation = getOperationAST(document, operationName);
  if (!operation || operation.operation !== "query") return null;

  const fragments = new Map(
    document.definitions
      .filter((definition) => definition.kind === Kind.FRAGMENT_DEFINITION)
      .map((definition) => [definition.name.value, definition]),
  );
  const fields = new Set<string>();
  const visitedFragments = new Set<string>();

  function collect(selectionSet: SelectionSetNode): void {
    for (const selection of selectionSet.selections) {
      if (selection.kind === Kind.FIELD) {
        fields.add(selection.name.value);
      } else if (selection.kind === Kind.INLINE_FRAGMENT) {
        collect(selection.selectionSet);
      } else if (!visitedFragments.has(selection.name.value)) {
        visitedFragments.add(selection.name.value);
        const fragment = fragments.get(selection.name.value);
        if (fragment) collect(fragment.selectionSet);
      }
    }
  }

  collect(operation.selectionSet);
  return fields;
}

type OperationBudget = {
  aliases: number;
  expensiveRootConnections: number;
  fields: number;
  maxDepth: number;
  selections: number;
};

function exceedsOperationBudget(budget: OperationBudget): boolean {
  return (
    budget.aliases > MAX_ALIASES ||
    budget.expensiveRootConnections > MAX_EXPENSIVE_ROOT_CONNECTIONS ||
    budget.fields > MAX_FIELD_SELECTIONS ||
    budget.maxDepth > MAX_DEPTH ||
    budget.selections > MAX_SELECTION_VISITS
  );
}

function measureOperation(
  document: DocumentNode,
  operation: OperationDefinitionNode,
): OperationBudget {
  const fragments = new Map(
    document.definitions
      .filter((definition) => definition.kind === Kind.FRAGMENT_DEFINITION)
      .map((definition) => [definition.name.value, definition]),
  );
  const connectionResponseKeys = new Set<string>();
  let aliases = 0;
  let fields = 0;
  let maxDepth = 0;
  let selections = 0;

  function collect(
    selectionSet: SelectionSetNode,
    depth: number,
    fragmentPath: ReadonlySet<string>,
  ): boolean {
    for (const selection of selectionSet.selections) {
      selections += 1;
      if (
        exceedsOperationBudget({
          aliases,
          expensiveRootConnections: connectionResponseKeys.size,
          fields,
          maxDepth,
          selections,
        })
      ) {
        return true;
      }

      if (selection.kind === Kind.FIELD) {
        fields += 1;
        if (selection.alias) aliases += 1;
        maxDepth = Math.max(maxDepth, depth);
        if (depth === 1 && EXPENSIVE_ROOT_FIELDS.has(selection.name.value)) {
          connectionResponseKeys.add(
            selection.alias?.value ?? selection.name.value,
          );
        }
        if (
          exceedsOperationBudget({
            aliases,
            expensiveRootConnections: connectionResponseKeys.size,
            fields,
            maxDepth,
            selections,
          })
        ) {
          return true;
        }
        if (selection.selectionSet) {
          if (collect(selection.selectionSet, depth + 1, fragmentPath)) {
            return true;
          }
        }
      } else if (selection.kind === Kind.INLINE_FRAGMENT) {
        if (collect(selection.selectionSet, depth, fragmentPath)) {
          return true;
        }
      } else if (!fragmentPath.has(selection.name.value)) {
        const fragment = fragments.get(selection.name.value);
        if (fragment) {
          if (
            collect(
              fragment.selectionSet,
              depth,
              new Set(fragmentPath).add(selection.name.value),
            )
          ) {
            return true;
          }
        }
      }
    }
    return false;
  }

  collect(operation.selectionSet, 1, new Set());
  return {
    aliases,
    expensiveRootConnections: connectionResponseKeys.size,
    fields,
    maxDepth,
    selections,
  };
}

function operationBudgetRule(
  operationName: string | null | undefined,
): ValidationRule {
  return (context) => ({
    Document(document) {
      const operation = getOperationAST(document, operationName);
      if (!operation) return;

      const budget = measureOperation(document, operation);
      if (
        exceedsOperationBudget(budget)
      ) {
        context.reportError(
          new GraphQLError("GraphQL operation exceeds request budget.", {
            nodes: operation,
            extensions: {
              code: "OPERATION_BUDGET_EXCEEDED",
              http: { status: 400 },
            },
          }),
        );
      }
    },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const VARIABLE_COERCION_ERROR =
  /^Variable "\$[_A-Za-z][_0-9A-Za-z]*" got invalid value\b/;

function sanitizeGraphqlErrors(result: unknown): void {
  if (Array.isArray(result)) {
    for (const item of result) sanitizeGraphqlErrors(item);
    return;
  }
  if (!isRecord(result) || !Array.isArray(result.errors)) return;

  for (const error of result.errors) {
    if (!isRecord(error)) continue;
    if (
      typeof error.message === "string" &&
      VARIABLE_COERCION_ERROR.test(error.message)
    ) {
      error.message = "GraphQL variables contain invalid values.";
      error.extensions = {
        ...(isRecord(error.extensions) ? error.extensions : {}),
        code: "BAD_USER_INPUT",
      };
    }
    if (!isRecord(error.extensions)) continue;
    for (const key of Object.keys(error.extensions)) {
      if (key !== "code") {
        delete error.extensions[key];
      }
    }
  }
}

function cacheControlForQuery(
  query: string | null | undefined,
  operationName: string | null,
): string {
  if (!query) return NO_STORE;

  try {
    const fields = selectedRootFields(parse(query), operationName);
    if (
      !fields ||
      fields.size === 0 ||
      [...fields].some((field) => !CACHEABLE_ROOT_FIELDS.has(field))
    ) {
      return NO_STORE;
    }

    return [...fields].every((field) => LONG_CACHE_ROOT_FIELDS.has(field))
      ? "public, s-maxage=60, stale-while-revalidate=300"
      : "public, s-maxage=15, stale-while-revalidate=60";
  } catch {
    return NO_STORE;
  }
}

const requestBudgetPlugin: Plugin<GraphQLContext> = {
  onValidate({ context, addValidationRule }) {
    addValidationRule(operationBudgetRule(context.params.operationName));
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
  cors: false,
  multipart: false,
  parserAndValidationCache: { validationCache: false },
  plugins: [requestBudgetPlugin],
  context: async (): Promise<GraphQLContext> => ({
    getSql,
  }),
  // Unexpected resolver failures never expose database or environment details.
  maskedErrors: { isDev: false },
});

type InspectedResponse = {
  body: BodyInit | null;
  rewritten: boolean;
  successful: boolean;
};

async function inspectGraphqlResponse(
  response: Response,
): Promise<InspectedResponse> {
  const mediaType = response.headers
    .get("Content-Type")
    ?.split(";")[0]
    ?.trim()
    .toLowerCase();
  if (
    mediaType !== "application/json" &&
    mediaType !== "application/graphql-response+json"
  ) {
    return { body: response.body, rewritten: false, successful: false };
  }

  try {
    const result: unknown = await response.clone().json();
    sanitizeGraphqlErrors(result);
    const successful =
      response.ok &&
      isRecord(result) &&
      "data" in result &&
      (!Array.isArray(result.errors) || result.errors.length === 0);
    return {
      body: JSON.stringify(result),
      rewritten: true,
      successful,
    };
  } catch {
    return { body: response.body, rewritten: false, successful: false };
  }
}

function isAnonymousRequest(request: Request): boolean {
  return (
    !request.headers.has("Authorization") &&
    !request.headers.has("Cookie")
  );
}

function responseAllowsSharedCaching(response: Response): boolean {
  const cacheControl = response.headers.get("Cache-Control") ?? "";
  if (/(?:^|,)\s*(?:private|no-cache|no-store)\b/i.test(cacheControl)) {
    return false;
  }
  if (response.headers.has("Set-Cookie")) return false;

  const vary = new Set(
    (response.headers.get("Vary") ?? "")
      .split(",")
      .map((token) => token.trim().toLowerCase()),
  );
  return !vary.has("*") && !vary.has("cookie") && !vary.has("authorization");
}

async function handle(request: Request): Promise<Response> {
  const response = await yoga.fetch(request);
  const inspected = await inspectGraphqlResponse(response);
  const url = new URL(request.url);
  const query = request.method === "GET" ? url.searchParams.get("query") : null;
  const operationName =
    request.method === "GET" ? url.searchParams.get("operationName") : null;
  const headers = new Headers(response.headers);
  const cacheControl =
    request.method === "GET" &&
    isAnonymousRequest(request) &&
    responseAllowsSharedCaching(response) &&
    inspected.successful
      ? cacheControlForQuery(query, operationName)
      : NO_STORE;
  headers.set("Cache-Control", cacheControl);
  if (inspected.rewritten) headers.delete("Content-Length");
  appendVary(headers, "Accept", "Content-Type", "Cookie", "Authorization");
  addCorsHeaders(request, headers);
  // Ensure JSON Content-Type for GraphQL responses (Yoga usually sets this).
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json; charset=utf-8");
  }

  return new Response(inspected.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export async function GET(request: Request): Promise<Response> {
  if (!hasAllowedOrigin(request)) {
    return forbiddenCorsResponse();
  }
  const url = new URL(request.url);
  if (url.search.length > MAX_GRAPHQL_REQUEST_BYTES) {
    return graphqlErrorResponse(request, 413, "GraphQL request is too large.");
  }
  if (!hasValidSerializedObject(url.searchParams, "variables")) {
    return graphqlErrorResponse(
      request,
      400,
      "GraphQL variables must be a JSON object or null.",
    );
  }
  if (!hasValidSerializedObject(url.searchParams, "extensions")) {
    return graphqlErrorResponse(
      request,
      400,
      "GraphQL extensions must be a JSON object or null.",
    );
  }
  // In production GraphiQL is off; GET still serves GraphQL-over-HTTP queries.
  return handle(request);
}

export async function POST(request: Request): Promise<Response> {
  if (!hasAllowedOrigin(request)) {
    return forbiddenCorsResponse();
  }
  const boundedRequest = await boundedPostRequest(request);
  if (!boundedRequest) {
    return graphqlErrorResponse(request, 413, "GraphQL request is too large.");
  }
  if (isFormEncodedRequest(boundedRequest)) {
    const searchParams = new URLSearchParams(await boundedRequest.clone().text());
    if (!hasValidSerializedObject(searchParams, "variables")) {
      return graphqlErrorResponse(
        request,
        400,
        "GraphQL variables must be a JSON object or null.",
      );
    }
    if (!hasValidSerializedObject(searchParams, "extensions")) {
      return graphqlErrorResponse(
        request,
        400,
        "GraphQL extensions must be a JSON object or null.",
      );
    }
  }
  return handle(boundedRequest);
}

export async function OPTIONS(request: Request): Promise<Response> {
  if (!hasAllowedOrigin(request)) {
    return forbiddenCorsResponse();
  }

  const method = request.headers
    .get("Access-Control-Request-Method")
    ?.toUpperCase();
  if (method && !CORS_METHOD_SET.has(method)) {
    return new Response(null, {
      status: 405,
      headers: {
        Allow: CORS_METHODS.join(", "),
        "Cache-Control": NO_STORE,
        Vary: CORS_VARY.join(", "),
      },
    });
  }

  const requestedHeaders = (
    request.headers.get("Access-Control-Request-Headers") ?? ""
  )
    .split(",")
    .map((header) => header.trim().toLowerCase())
    .filter(Boolean);
  if (requestedHeaders.some((header) => !CORS_HEADER_SET.has(header))) {
    return forbiddenCorsResponse();
  }

  const headers = new Headers({
    Allow: CORS_METHODS.join(", "),
    "Cache-Control": NO_STORE,
  });
  addCorsHeaders(request, headers, true);
  appendVary(headers, "Accept", "Content-Type");
  return new Response(null, { status: 204, headers });
}

// Node.js is the default runtime. Route segment configs (runtime / dynamic)
// are incompatible with cacheComponents — Yoga + Neon use request body I/O.
