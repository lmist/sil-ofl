import type { Page, Request as PlaywrightRequest, Route } from "@playwright/test";
import {
  decodeFontCursor,
  encodeFontCursor,
} from "../../src/graphql/schema/cursor";
import {
  ALL_MOCK_FONTS,
  MOCK_FONTS_PAGE1,
  MOCK_STATS,
  type MockFontNode,
} from "./mock-data";

export type ResolveGraphqlMockOptions = {
  /** Alternate font rows for focused contract fixtures. */
  fontNodes?: readonly MockFontNode[];
  /** Deliberate test-only page cap; production-shaped resolution honors `first`. */
  pageSizeOverride?: number;
};

export type GraphqlMockOptions = ResolveGraphqlMockOptions & {
  /** Artificial delay (ms) for fonts responses — default 0 for tight interaction budgets. */
  fontsDelayMs?: number;
  /** When true, log mocked operations and their variables. */
  debug?: boolean;
};

type FontFilter = {
  q?: string | null;
  owner?: string | null;
  format?: string[] | null;
  minStars?: number | null;
  webfont?: boolean | null;
  variable?: boolean | null;
};

export type GraphqlBody = {
  query?: string;
  operationName?: string;
  variables?: {
    filter?: FontFilter | null;
    sort?: string | null;
    first?: number | null;
    after?: string | null;
    id?: string;
    owner?: string;
    name?: string;
  };
};

export type MockGraphqlPayload<T> = { data: T };

type MockGraphqlResponse =
  | MockGraphqlPayload<Record<string, unknown>>
  | { errors: { message: string }[] };

type FontConnection = {
  totalCount: number;
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  edges: { cursor: string; node: MockFontNode }[];
};

function edge(node: MockFontNode) {
  return {
    cursor: encodeFontCursor({
      v: 1,
      rep: node.reputation,
      stars: node.stars,
      family: node.familyGuess ?? "",
      id: node.fontFileId,
    }),
    node,
  };
}

function matchesQuery(node: MockFontNode, q: string): boolean {
  const needle = q.trim().toLowerCase();
  return (
    (node.familyGuess ?? "").toLowerCase().includes(needle) ||
    node.fileName.toLowerCase().includes(needle) ||
    node.path.toLowerCase().includes(needle) ||
    node.ownerLogin.toLowerCase().includes(needle) ||
    node.fullName.toLowerCase().includes(needle)
  );
}

function filterFonts(
  nodes: readonly MockFontNode[],
  filter: FontFilter | null,
): readonly MockFontNode[] {
  if (!filter) return nodes;
  let out = nodes;
  const q = filter.q?.trim();
  const owner = filter.owner?.trim();
  if (q) {
    out = out.filter((node) => matchesQuery(node, q));
  }
  if (owner) {
    out = out.filter((node) => node.ownerLogin === owner);
  }
  if (filter.format && filter.format.length > 0) {
    const formats = new Set(filter.format.map((format) => format.toLowerCase()));
    out = out.filter((node) => formats.has(node.format.toLowerCase()));
  }
  if (filter.minStars != null && filter.minStars > 0) {
    out = out.filter((node) => node.stars >= filter.minStars!);
  }
  if (filter.webfont != null) {
    out = out.filter((node) => node.isWebfont === filter.webfont);
  }
  if (filter.variable != null) {
    out = out.filter((node) => node.isVariable === filter.variable);
  }
  return out;
}

function compareNumber(a: number, b: number): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareFamilies(
  a: MockFontNode,
  b: MockFontNode,
  direction: "asc" | "desc",
): number {
  if (a.familyGuess == null && b.familyGuess == null) {
    return direction === "asc"
      ? compareNumber(a.fontFileId, b.fontFileId)
      : compareNumber(b.fontFileId, a.fontFileId);
  }
  if (a.familyGuess == null) return 1;
  if (b.familyGuess == null) return -1;
  return direction === "asc"
    ? compareString(a.familyGuess, b.familyGuess) ||
        compareNumber(a.fontFileId, b.fontFileId)
    : compareString(b.familyGuess, a.familyGuess) ||
        compareNumber(b.fontFileId, a.fontFileId);
}

function compareFonts(
  a: MockFontNode,
  b: MockFontNode,
  sort: string,
): number {
  switch (sort) {
    case "REPUTATION_ASC":
      return (
        compareNumber(a.reputation, b.reputation) ||
        compareNumber(a.fontFileId, b.fontFileId)
      );
    case "STARS_DESC":
      return (
        compareNumber(b.stars, a.stars) ||
        compareNumber(b.fontFileId, a.fontFileId)
      );
    case "STARS_ASC":
      return (
        compareNumber(a.stars, b.stars) ||
        compareNumber(a.fontFileId, b.fontFileId)
      );
    case "FAMILY_ASC":
      return compareFamilies(a, b, "asc");
    case "FAMILY_DESC":
      return compareFamilies(a, b, "desc");
    case "ID_ASC":
      return compareNumber(a.fontFileId, b.fontFileId);
    case "ID_DESC":
      return compareNumber(b.fontFileId, a.fontFileId);
    case "REPUTATION_DESC":
    default:
      return (
        compareNumber(b.reputation, a.reputation) ||
        compareNumber(b.fontFileId, a.fontFileId)
      );
  }
}

function pageSize(
  first: number | null | undefined,
  override: number | undefined,
): number {
  const requested =
    typeof first === "number" && Number.isFinite(first) ? Math.trunc(first) : 50;
  const bounded = Math.min(Math.max(requested, 1), 100);
  if (override == null || !Number.isFinite(override)) return bounded;
  return Math.min(bounded, Math.min(Math.max(Math.trunc(override), 1), 100));
}

function fontsConnection(
  variables: GraphqlBody["variables"] | undefined,
  options: ResolveGraphqlMockOptions,
): FontConnection | null {
  const fontNodes = options.fontNodes ?? ALL_MOCK_FONTS;
  const filter = variables?.filter ?? null;
  const after = variables?.after ?? null;
  const sort = variables?.sort ?? "REPUTATION_DESC";
  const matched = [...filterFonts(fontNodes, filter)].sort((a, b) =>
    compareFonts(a, b, sort),
  );
  const first = pageSize(variables?.first, options.pageSizeOverride);
  const cursor = after ? decodeFontCursor(after) : null;
  const cursorIndex = cursor
    ? matched.findIndex((node) => node.fontFileId === cursor.id)
    : -1;
  if (after && (!cursor || cursorIndex < 0)) {
    return null;
  }
  const remaining = matched.slice(cursorIndex + 1);
  const page = remaining.slice(0, first);
  const edges = page.map(edge);
  const endCursor = edges.at(-1)?.cursor ?? null;

  return {
    totalCount: matched.length,
    pageInfo: {
      hasNextPage: remaining.length > page.length,
      endCursor,
    },
    edges,
  };
}

export const PAGE1_CURSOR = edge(MOCK_FONTS_PAGE1.at(-1)!).cursor;

type MockRepoNode = {
  id: string;
  fullName: string;
  name: string;
  description: string | null;
  htmlUrl: string;
  stars: number;
  reputation: number;
  licenseSpdx: string | null;
  defaultBranch: string;
  ownerLogin: string;
  fontCount: number;
};

function mockRepos(fontNodes: readonly MockFontNode[]): MockRepoNode[] {
  const byId = new Map<number, MockRepoNode>();
  for (const font of fontNodes) {
    const existing = byId.get(font.repoId);
    if (existing) {
      existing.fontCount += 1;
      continue;
    }
    byId.set(font.repoId, {
      id: String(font.repoId),
      fullName: font.fullName,
      name: font.repoName,
      description: null,
      htmlUrl: font.repoUrl,
      stars: font.stars,
      reputation: font.reputation,
      licenseSpdx: font.licenseSpdx,
      defaultBranch: font.defaultBranch,
      ownerLogin: font.ownerLogin,
      fontCount: 1,
    });
  }
  return Array.from(byId.values());
}

function repoDetail(
  variables: GraphqlBody["variables"] | undefined,
  fontNodes: readonly MockFontNode[],
): MockRepoNode | null {
  const fullName = `${variables?.owner ?? ""}/${variables?.name ?? ""}`;
  return (
    mockRepos(fontNodes).find((repo) => repo.fullName === fullName) ?? null
  );
}

function detectOperation(body: GraphqlBody): string {
  if (body.operationName) return body.operationName;
  const q = body.query ?? "";
  if (/\bquery\s+Health\b/.test(q) || /\bhealth\s*\{/.test(q)) return "Health";
  if (/\bquery\s+CatalogStats\b/.test(q) || /\bstats\s*\{/.test(q))
    return "CatalogStats";
  if (/\bquery\s+Fonts\b/.test(q) || /\bfonts\s*\(/.test(q)) return "Fonts";
  if (/\bquery\s+Font\b/.test(q) || /\bfont\s*\(/.test(q)) return "Font";
  if (/\bquery\s+Repos\b/.test(q) || /\brepos\s*\(/.test(q)) return "Repos";
  if (/\bquery\s+Repo\b/.test(q) || /\brepo\s*\(/.test(q)) return "Repo";
  return "Unknown";
}

export function resolveGraphqlMock(
  body: GraphqlBody,
  options: ResolveGraphqlMockOptions = {},
): MockGraphqlResponse {
  const fontNodes = options.fontNodes ?? ALL_MOCK_FONTS;
  const op = detectOperation(body);
  if (op === "Health") {
    return {
      data: {
        health: {
          ok: true,
          service: "sil-ofl-fonts-mock",
          ts: new Date().toISOString(),
        },
      },
    };
  }

  if (op === "CatalogStats") {
    return { data: { stats: MOCK_STATS } };
  }

  if (op === "Fonts") {
    const fonts = fontsConnection(body.variables, options);
    return fonts
      ? { data: { fonts } }
      : { errors: [{ message: "Invalid cursor" }] };
  }

  if (op === "Font") {
    const id = body.variables?.id;
    const node =
      fontNodes.find(
        (font) => font.id === id || String(font.fontFileId) === id,
      ) ?? null;
    return { data: { font: node } };
  }

  if (op === "Repo") {
    return { data: { repo: repoDetail(body.variables, fontNodes) } };
  }

  if (op === "Repos") {
    return {
      data: {
        repos: {
          totalCount: 0,
          pageInfo: { hasNextPage: false, endCursor: null },
          edges: [],
        },
      },
    };
  }

  return {
    errors: [{ message: `Unhandled mock operation: ${op}` }],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseUrlVariables(
  value: string | null,
): GraphqlBody["variables"] | undefined {
  if (!value) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed)
      ? (parsed as GraphqlBody["variables"])
      : undefined;
  } catch {
    return undefined;
  }
}

function parseGraphqlRequest(request: PlaywrightRequest): GraphqlBody {
  let postData: unknown;
  try {
    postData = request.postDataJSON();
  } catch {
    postData = undefined;
  }

  const body = isRecord(postData) ? (postData as GraphqlBody) : {};
  const url = new URL(request.url());
  return {
    query: body.query ?? url.searchParams.get("query") ?? undefined,
    operationName:
      body.operationName ?? url.searchParams.get("operationName") ?? undefined,
    variables:
      body.variables ?? parseUrlVariables(url.searchParams.get("variables")),
  };
}

async function fulfillGraphql(
  route: Route,
  options: GraphqlMockOptions,
): Promise<void> {
  const request = route.request();
  if (request.method() === "OPTIONS") {
    await route.fulfill({ status: 204, body: "" });
    return;
  }

  const body = parseGraphqlRequest(request);

  const op = detectOperation(body);
  if (options.debug) {
    console.log("[graphql-mock]", op, body.variables);
  }

  if (op === "Fonts") {
    if (options.fontsDelayMs && options.fontsDelayMs > 0) {
      await new Promise((r) => setTimeout(r, options.fontsDelayMs));
    }
  }

  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(resolveGraphqlMock(body, options)),
  });
}

/**
 * Install Playwright route handlers for `/api/graphql`.
 * Enables deterministic CI when DATABASE_URL is absent.
 */
export async function installGraphqlMock(
  page: Page,
  options: GraphqlMockOptions = {},
): Promise<void> {
  await page.route("**/api/graphql**", (route) =>
    fulfillGraphql(route, options),
  );
}

export { ALL_MOCK_FONTS, MOCK_FONTS_PAGE1, MOCK_STATS };
