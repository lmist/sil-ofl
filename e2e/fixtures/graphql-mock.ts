import type { Page, Route } from "@playwright/test";
import {
  ALL_MOCK_FONTS,
  MOCK_FONTS_PAGE1,
  MOCK_FONTS_PAGE2,
  MOCK_STATS,
  PAGE1_CURSOR,
  type MockFontNode,
} from "./mock-data";

export type GraphqlMockOptions = {
  /** Artificial delay (ms) for fonts responses — default 0 for tight interaction budgets. */
  fontsDelayMs?: number;
  /** When true, log unmatched operations. */
  debug?: boolean;
};

type GraphqlBody = {
  query?: string;
  operationName?: string;
  variables?: {
    filter?: {
      q?: string | null;
      owner?: string | null;
      format?: string[] | null;
      minStars?: number | null;
      webfont?: boolean | null;
      variable?: boolean | null;
    } | null;
    sort?: string | null;
    first?: number | null;
    after?: string | null;
    id?: string;
  };
};

function edge(node: MockFontNode) {
  return {
    cursor: `c-${node.fontFileId}`,
    node,
  };
}

function matchesQuery(node: MockFontNode, q: string): boolean {
  const needle = q.toLowerCase();
  return (
    (node.familyGuess ?? "").toLowerCase().includes(needle) ||
    node.fileName.toLowerCase().includes(needle) ||
    node.ownerLogin.toLowerCase().includes(needle) ||
    node.fullName.toLowerCase().includes(needle)
  );
}

function filterFonts(
  nodes: MockFontNode[],
  filter: GraphqlBody["variables"] extends infer V
    ? V extends { filter?: infer F }
      ? F
      : never
    : never,
): MockFontNode[] {
  if (!filter) return nodes;
  let out = nodes;
  if (filter.q) {
    out = out.filter((n) => matchesQuery(n, filter.q!));
  }
  if (filter.owner) {
    const o = filter.owner.toLowerCase();
    out = out.filter((n) => n.ownerLogin.toLowerCase().includes(o));
  }
  if (filter.format && filter.format.length > 0) {
    const formats = new Set(filter.format.map((f) => f.toLowerCase()));
    out = out.filter((n) => formats.has(n.format.toLowerCase()));
  }
  if (filter.minStars != null && filter.minStars > 0) {
    out = out.filter((n) => n.stars >= filter.minStars!);
  }
  if (filter.webfont === true) {
    out = out.filter((n) => n.isWebfont);
  }
  if (filter.variable === true) {
    out = out.filter((n) => n.isVariable);
  }
  return out;
}

/**
 * Resolve a fonts connection with simple two-page cursor paging when unfiltered.
 * Filtered lists are single-page for determinism.
 */
function fontsConnection(
  variables: GraphqlBody["variables"] | undefined,
): {
  totalCount: number;
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  edges: { cursor: string; node: MockFontNode }[];
} {
  const filter = variables?.filter ?? null;
  const after = variables?.after ?? null;
  const first = variables?.first ?? 50;

  const hasActiveFilter = Boolean(
    filter &&
      (filter.q ||
        filter.owner ||
        (filter.format && filter.format.length > 0) ||
        (filter.minStars != null && filter.minStars > 0) ||
        filter.webfont === true ||
        filter.variable === true),
  );

  if (hasActiveFilter) {
    const matched = filterFonts(ALL_MOCK_FONTS, filter).slice(0, first ?? 50);
    return {
      totalCount: matched.length,
      pageInfo: { hasNextPage: false, endCursor: null },
      edges: matched.map(edge),
    };
  }

  // Unfiltered: two fixed pages for next/prev tests
  if (after === PAGE1_CURSOR) {
    return {
      totalCount: ALL_MOCK_FONTS.length,
      pageInfo: { hasNextPage: false, endCursor: null },
      edges: MOCK_FONTS_PAGE2.map(edge),
    };
  }

  return {
    totalCount: ALL_MOCK_FONTS.length,
    pageInfo: { hasNextPage: true, endCursor: PAGE1_CURSOR },
    edges: MOCK_FONTS_PAGE1.map(edge),
  };
}

function detectOperation(body: GraphqlBody): string {
  if (body.operationName) return body.operationName;
  const q = body.query ?? "";
  if (/\bquery\s+Health\b/.test(q) || /\bhealth\s*\{/.test(q)) return "Health";
  if (/\bquery\s+CatalogStats\b/.test(q) || /\bstats\s*\{/.test(q))
    return "CatalogStats";
  if (/\bquery\s+Fonts\b/.test(q) || /\bfonts\s*\(/.test(q)) return "Fonts";
  if (/\bquery\s+Font\b/.test(q) || /\bfont\s*\(/.test(q)) return "Font";
  if (/\brepos\s*\(/.test(q)) return "Repos";
  return "Unknown";
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

  let body: GraphqlBody = {};
  try {
    body = request.postDataJSON() as GraphqlBody;
  } catch {
    const url = new URL(request.url());
    const query = url.searchParams.get("query");
    if (query) body = { query };
  }

  const op = detectOperation(body);
  if (options.debug) {
    // eslint-disable-next-line no-console
    console.log("[graphql-mock]", op, body.variables);
  }

  if (op === "Health") {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          health: {
            ok: true,
            service: "sil-ofl-fonts-mock",
            ts: new Date().toISOString(),
          },
        },
      }),
    });
    return;
  }

  if (op === "CatalogStats") {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: { stats: MOCK_STATS } }),
    });
    return;
  }

  if (op === "Fonts") {
    if (options.fontsDelayMs && options.fontsDelayMs > 0) {
      await new Promise((r) => setTimeout(r, options.fontsDelayMs));
    }
    const fonts = fontsConnection(body.variables);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: { fonts } }),
    });
    return;
  }

  if (op === "Font") {
    const id = body.variables?.id;
    const node =
      ALL_MOCK_FONTS.find(
        (n) => n.id === id || String(n.fontFileId) === id,
      ) ?? null;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: { font: node } }),
    });
    return;
  }

  if (op === "Repos") {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          repos: {
            totalCount: 0,
            pageInfo: { hasNextPage: false, endCursor: null },
            edges: [],
          },
        },
      }),
    });
    return;
  }

  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      errors: [{ message: `Unhandled mock operation: ${op}` }],
    }),
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

export { ALL_MOCK_FONTS, MOCK_FONTS_PAGE1, MOCK_STATS, PAGE1_CURSOR };
