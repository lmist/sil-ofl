import {
  builder,
  markTypesRegistered,
  typesAlreadyRegistered,
} from "./builder";
import { clamp } from "@/lib/utils";
import {
  decodeFontCursor,
  decodeRepoCursor,
  encodeFontCursor,
  encodeRepoCursor,
} from "./cursor";
import type { CatalogStats, FontFile, Repo } from "@/types/catalog";

const MAX_FIRST = 100;
const DEFAULT_FIRST = 50;

function registerSchemaTypes(): void {
  if (typesAlreadyRegistered()) return;


/* -------------------------------------------------------------------------- */
/*  Object types                                                              */
/* -------------------------------------------------------------------------- */

const HealthRef = builder.objectRef<{
  ok: boolean;
  service: string;
  ts: string;
}>("Health");

const StatsRef = builder.objectRef<CatalogStats>("Stats");

const FontFileRef = builder.objectRef<FontFile>("FontFile");
const RepoRef = builder.objectRef<Repo>("Repo");

const PageInfoRef = builder.objectRef<{
  hasNextPage: boolean;
  endCursor: string | null;
}>("PageInfo");

const FontEdgeRef = builder.objectRef<{
  cursor: string;
  node: FontFile;
}>("FontEdge");

const FontConnectionRef = builder.objectRef<{
  edges: { cursor: string; node: FontFile }[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  totalCount: number;
}>("FontConnection");

const RepoEdgeRef = builder.objectRef<{
  cursor: string;
  node: Repo;
}>("RepoEdge");

const RepoConnectionRef = builder.objectRef<{
  edges: { cursor: string; node: Repo }[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  totalCount: number;
}>("RepoConnection");

HealthRef.implement({
  fields: (t) => ({
    ok: t.exposeBoolean("ok"),
    service: t.exposeString("service"),
    ts: t.exposeString("ts"),
  }),
});

StatsRef.implement({
  fields: (t) => ({
    repos: t.exposeInt("repos"),
    fontFiles: t.exposeInt("fontFiles"),
    owners: t.exposeInt("owners"),
    reposWithFiles: t.exposeInt("reposWithFiles"),
  }),
});

FontFileRef.implement({
  description:
    "Discoverable font binary with CDN + raw URLs for @font-face (no binary payloads)",
  fields: (t) => ({
    id: t.exposeID("fontFileId"),
    cdnUrl: t.exposeString("cdnUrl", {
      description: "jsDelivr CDN URL — prefer for browser @font-face",
    }),
    rawUrl: t.exposeString("rawUrl", {
      description: "GitHub raw URL (may hit rate limits / CORS quirks)",
    }),
    format: t.exposeString("format"),
    fileName: t.exposeString("fileName"),
    path: t.exposeString("path"),
    familyGuess: t.exposeString("familyGuess", { nullable: true }),
    weightGuess: t.exposeInt("weightGuess", { nullable: true }),
    styleGuess: t.exposeString("styleGuess", { nullable: true }),
    isVariable: t.exposeBoolean("isVariable"),
    isWebfont: t.exposeBoolean("isWebfont"),
    stars: t.exposeInt("stars"),
    reputation: t.exposeInt("reputation"),
    ownerLogin: t.exposeString("ownerLogin"),
    fullName: t.exposeString("fullName"),
    defaultBranch: t.exposeString("defaultBranch"),
    // Extra fields (compatible with REST / v_renderable_fonts) — safe extensions
    fontFileId: t.exposeInt("fontFileId"),
    repoId: t.exposeInt("repoId"),
    repoName: t.exposeString("repoName"),
    repoUrl: t.exposeString("repoUrl"),
    licenseSpdx: t.exposeString("licenseSpdx", { nullable: true }),
    ownerType: t.exposeString("ownerType"),
    ownerUrl: t.exposeString("ownerUrl", { nullable: true }),
  }),
});

RepoRef.implement({
  fields: (t) => ({
    id: t.exposeID("id"),
    fullName: t.exposeString("fullName"),
    name: t.exposeString("name"),
    description: t.exposeString("description", { nullable: true }),
    htmlUrl: t.exposeString("htmlUrl"),
    stars: t.exposeInt("stars"),
    reputation: t.exposeInt("reputation"),
    licenseSpdx: t.exposeString("licenseSpdx", { nullable: true }),
    defaultBranch: t.exposeString("defaultBranch"),
    ownerLogin: t.exposeString("ownerLogin"),
    fontCount: t.exposeInt("fontCount"),
  }),
});

PageInfoRef.implement({
  fields: (t) => ({
    hasNextPage: t.exposeBoolean("hasNextPage"),
    endCursor: t.exposeString("endCursor", { nullable: true }),
  }),
});

FontEdgeRef.implement({
  fields: (t) => ({
    cursor: t.exposeString("cursor"),
    node: t.field({ type: FontFileRef, resolve: (e) => e.node }),
  }),
});

FontConnectionRef.implement({
  fields: (t) => ({
    edges: t.field({
      type: [FontEdgeRef],
      resolve: (c) => c.edges,
    }),
    pageInfo: t.field({
      type: PageInfoRef,
      resolve: (c) => c.pageInfo,
    }),
    totalCount: t.exposeInt("totalCount"),
  }),
});

RepoEdgeRef.implement({
  fields: (t) => ({
    cursor: t.exposeString("cursor"),
    node: t.field({ type: RepoRef, resolve: (e) => e.node }),
  }),
});

RepoConnectionRef.implement({
  fields: (t) => ({
    edges: t.field({
      type: [RepoEdgeRef],
      resolve: (c) => c.edges,
    }),
    pageInfo: t.field({
      type: PageInfoRef,
      resolve: (c) => c.pageInfo,
    }),
    totalCount: t.exposeInt("totalCount"),
  }),
});

/* -------------------------------------------------------------------------- */
/*  Inputs / enums                                                            */
/* -------------------------------------------------------------------------- */

const FontSort = builder.enumType("FontSort", {
  values: {
    REPUTATION_DESC: { value: "REPUTATION_DESC" },
    REPUTATION_ASC: { value: "REPUTATION_ASC" },
    STARS_DESC: { value: "STARS_DESC" },
    STARS_ASC: { value: "STARS_ASC" },
    FAMILY_ASC: { value: "FAMILY_ASC" },
    FAMILY_DESC: { value: "FAMILY_DESC" },
    ID_DESC: { value: "ID_DESC" },
    ID_ASC: { value: "ID_ASC" },
  } as const,
});

const FontFilterInput = builder.inputType("FontFilter", {
  fields: (t) => ({
    q: t.string({
      required: false,
      description:
        "Trigram / ILIKE search on family_guess, file_name, path, owner, full_name",
    }),
    owner: t.string({ required: false }),
    format: t.stringList({
      required: false,
      description: "ttf | otf | woff | woff2",
    }),
    minStars: t.int({ required: false }),
    webfont: t.boolean({ required: false }),
    variable: t.boolean({ required: false }),
  }),
});

const RepoFilterInput = builder.inputType("RepoFilter", {
  fields: (t) => ({
    q: t.string({ required: false }),
    owner: t.string({ required: false }),
    minStars: t.int({ required: false }),
    withFonts: t.boolean({ required: false }),
  }),
});

/* -------------------------------------------------------------------------- */
/*  Row mappers (explicit columns — no SELECT *)                              */
/* -------------------------------------------------------------------------- */

type FontRow = {
  font_file_id: number | string;
  cdn_url: string;
  raw_url: string;
  format: string;
  file_name: string;
  path: string;
  family_guess: string | null;
  weight_guess: number | null;
  style_guess: string | null;
  is_variable: boolean;
  is_webfont: boolean;
  repo_id: number | string;
  full_name: string;
  repo_name: string;
  repo_url: string;
  stars: number;
  reputation: number;
  license_spdx: string | null;
  default_branch: string;
  owner_login: string;
  owner_type: string;
  owner_url: string | null;
};

const FONT_SELECT = `
  f.id AS font_file_id,
  f.cdn_url,
  f.raw_url,
  f.format,
  f.file_name,
  f.path,
  f.family_guess,
  f.weight_guess,
  f.style_guess,
  f.is_variable,
  f.is_webfont,
  r.id AS repo_id,
  r.full_name,
  r.name AS repo_name,
  r.html_url AS repo_url,
  r.stars,
  r.reputation,
  r.license_spdx,
  r.default_branch,
  o.login AS owner_login,
  o.owner_type,
  o.html_url AS owner_url
`;

function mapFont(row: FontRow): FontFile {
  return {
    fontFileId: Number(row.font_file_id),
    cdnUrl: row.cdn_url,
    rawUrl: row.raw_url,
    format: row.format,
    fileName: row.file_name,
    path: row.path,
    familyGuess: row.family_guess,
    weightGuess: row.weight_guess,
    styleGuess: row.style_guess,
    isVariable: Boolean(row.is_variable),
    isWebfont: Boolean(row.is_webfont),
    repoId: Number(row.repo_id),
    fullName: row.full_name,
    repoName: row.repo_name,
    repoUrl: row.repo_url,
    stars: row.stars,
    reputation: row.reputation,
    licenseSpdx: row.license_spdx,
    defaultBranch: row.default_branch,
    ownerLogin: row.owner_login,
    ownerType: row.owner_type,
    ownerUrl: row.owner_url,
  };
}

type RepoRow = {
  id: number | string;
  full_name: string;
  name: string;
  description: string | null;
  html_url: string;
  stars: number;
  reputation: number;
  license_spdx: string | null;
  default_branch: string;
  owner_login: string;
  font_count: number | string;
};

function mapRepo(row: RepoRow): Repo {
  return {
    id: Number(row.id),
    fullName: row.full_name,
    name: row.name,
    description: row.description,
    htmlUrl: row.html_url,
    stars: row.stars,
    reputation: row.reputation,
    licenseSpdx: row.license_spdx,
    defaultBranch: row.default_branch,
    ownerLogin: row.owner_login,
    fontCount: Number(row.font_count),
  };
}

function fontCursorOf(node: FontFile): string {
  return encodeFontCursor({
    v: 1,
    rep: node.reputation,
    stars: node.stars,
    family: node.familyGuess ?? "",
    id: node.fontFileId,
  });
}

function repoCursorOf(node: Repo): string {
  return encodeRepoCursor({
    v: 1,
    rep: node.reputation,
    stars: node.stars,
    name: node.fullName,
    id: node.id,
  });
}

type FontSortValue =
  | "REPUTATION_DESC"
  | "REPUTATION_ASC"
  | "STARS_DESC"
  | "STARS_ASC"
  | "FAMILY_ASC"
  | "FAMILY_DESC"
  | "ID_DESC"
  | "ID_ASC";

function fontOrderBy(sort: FontSortValue): string {
  switch (sort) {
    case "REPUTATION_ASC":
      return "r.reputation ASC, f.id ASC";
    case "STARS_DESC":
      return "r.stars DESC, f.id DESC";
    case "STARS_ASC":
      return "r.stars ASC, f.id ASC";
    case "FAMILY_ASC":
      return "f.family_guess ASC NULLS LAST, f.id ASC";
    case "FAMILY_DESC":
      return "f.family_guess DESC NULLS LAST, f.id DESC";
    case "ID_ASC":
      return "f.id ASC";
    case "ID_DESC":
      return "f.id DESC";
    case "REPUTATION_DESC":
    default:
      return "r.reputation DESC, f.id DESC";
  }
}

/**
 * Keyset predicate for the active sort.
 * Returns SQL with $n placeholders starting at paramStart, plus bind values
 * in order (only the columns used — never leave unused $params).
 */
function fontKeyset(
  sort: FontSortValue,
  cursor: { rep: number; stars: number; family: string; id: number },
  paramStart: number,
): { sql: string; values: unknown[] } {
  const p = (offset: number) => `$${paramStart + offset}`;
  switch (sort) {
    case "REPUTATION_ASC":
      return {
        sql: `(r.reputation, f.id) > (${p(0)}, ${p(1)})`,
        values: [cursor.rep, cursor.id],
      };
    case "STARS_DESC":
      return {
        sql: `(r.stars, f.id) < (${p(0)}, ${p(1)})`,
        values: [cursor.stars, cursor.id],
      };
    case "STARS_ASC":
      return {
        sql: `(r.stars, f.id) > (${p(0)}, ${p(1)})`,
        values: [cursor.stars, cursor.id],
      };
    case "FAMILY_ASC":
      return {
        sql: `(COALESCE(f.family_guess, ''), f.id) > (${p(0)}, ${p(1)})`,
        values: [cursor.family, cursor.id],
      };
    case "FAMILY_DESC":
      return {
        sql: `(COALESCE(f.family_guess, ''), f.id) < (${p(0)}, ${p(1)})`,
        values: [cursor.family, cursor.id],
      };
    case "ID_ASC":
      return {
        sql: `f.id > ${p(0)}`,
        values: [cursor.id],
      };
    case "ID_DESC":
      return {
        sql: `f.id < ${p(0)}`,
        values: [cursor.id],
      };
    case "REPUTATION_DESC":
    default:
      return {
        sql: `(r.reputation, f.id) < (${p(0)}, ${p(1)})`,
        values: [cursor.rep, cursor.id],
      };
  }
}

function repoOrderBy(): string {
  return "r.reputation DESC, r.id DESC";
}

/* -------------------------------------------------------------------------- */
/*  Query fields                                                              */
/* -------------------------------------------------------------------------- */

builder.queryFields((t) => ({
  health: t.field({
    type: HealthRef,
    resolve: () => ({
      ok: true,
      service: "sil-ofl-fonts-graphql",
      ts: new Date().toISOString(),
    }),
  }),

  stats: t.field({
    type: StatsRef,
    resolve: async () => {
      // Server Data Cache (unstable_cache) — warm Neon COUNTs stay under p95 budget.
      const { getCachedCatalogStats } = await import("@/lib/cached-stats");
      return getCachedCatalogStats();
    },
  }),

  fonts: t.field({
    type: FontConnectionRef,
    args: {
      filter: t.arg({ type: FontFilterInput, required: false }),
      sort: t.arg({ type: FontSort, required: false }),
      first: t.arg.int({ required: false, defaultValue: DEFAULT_FIRST }),
      after: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      const first = clamp(args.first ?? DEFAULT_FIRST, 1, MAX_FIRST);
      const sort = (args.sort ?? "REPUTATION_DESC") as FontSortValue;
      const filter = args.filter ?? {};
      const minStars = filter.minStars ?? 0;
      const owner = filter.owner?.trim() || null;
      const q = filter.q?.trim() || null;
      const qPattern = q ? `%${q}%` : null;
      const webfont = filter.webfont ?? null;
      const variable = filter.variable ?? null;
      const formats =
        filter.format && filter.format.length > 0
          ? filter.format.map((f) => f.toLowerCase())
          : null;

      const cursor = args.after ? decodeFontCursor(args.after) : null;
      if (args.after && !cursor) {
        throw new Error("Invalid cursor");
      }

      // Build parameterized query with $n placeholders (no string concat of user values).
      const params: unknown[] = [];
      const push = (v: unknown) => {
        params.push(v);
        return `$${params.length}`;
      };

      const where: string[] = [
        `NOT r.is_archived`,
        `r.is_fontish`,
        `f.format IN ('ttf', 'otf', 'woff', 'woff2')`,
        `r.stars >= ${push(minStars)}`,
      ];

      if (owner) {
        where.push(`o.login = ${push(owner)}`);
      }
      if (formats) {
        where.push(`f.format = ANY(${push(formats)}::text[])`);
      }
      if (webfont === true) {
        where.push(`f.is_webfont = true`);
      } else if (webfont === false) {
        where.push(`f.is_webfont = false`);
      }
      if (variable === true) {
        where.push(`f.is_variable = true`);
      } else if (variable === false) {
        where.push(`f.is_variable = false`);
      }
      if (qPattern) {
        // Uses gin_trgm_ops indexes from 001 + 002 migrations
        const p = push(qPattern);
        where.push(`(
          f.family_guess ILIKE ${p}
          OR f.file_name ILIKE ${p}
          OR f.path ILIKE ${p}
          OR o.login ILIKE ${p}
          OR r.full_name ILIKE ${p}
        )`);
      }

      if (cursor) {
        const keyset = fontKeyset(sort, cursor, params.length + 1);
        for (const v of keyset.values) params.push(v);
        where.push(keyset.sql);
      }

      const orderBy = fontOrderBy(sort);
      const limitParam = push(first + 1); // +1 to detect hasNextPage

      const listSql = `
        SELECT ${FONT_SELECT}
        FROM font_files f
        JOIN repos r ON r.id = f.repo_id
        JOIN owners o ON o.id = r.owner_id
        WHERE ${where.join(" AND ")}
        ORDER BY ${orderBy}
        LIMIT ${limitParam}
      `;

      // totalCount: same filters, no keyset / limit (sparingly — only when connection requested)
      // Reuse filter params without cursor/limit by rebuilding a count query.
      const countParams: unknown[] = [];
      const cpush = (v: unknown) => {
        countParams.push(v);
        return `$${countParams.length}`;
      };
      const countWhere: string[] = [
        `NOT r.is_archived`,
        `r.is_fontish`,
        `f.format IN ('ttf', 'otf', 'woff', 'woff2')`,
        `r.stars >= ${cpush(minStars)}`,
      ];
      if (owner) countWhere.push(`o.login = ${cpush(owner)}`);
      if (formats) countWhere.push(`f.format = ANY(${cpush(formats)}::text[])`);
      if (webfont === true) countWhere.push(`f.is_webfont = true`);
      else if (webfont === false) countWhere.push(`f.is_webfont = false`);
      if (variable === true) countWhere.push(`f.is_variable = true`);
      else if (variable === false) countWhere.push(`f.is_variable = false`);
      if (qPattern) {
        const p = cpush(qPattern);
        countWhere.push(`(
          f.family_guess ILIKE ${p}
          OR f.file_name ILIKE ${p}
          OR f.path ILIKE ${p}
          OR o.login ILIKE ${p}
          OR r.full_name ILIKE ${p}
        )`);
      }

      const countSql = `
        SELECT COUNT(*)::int AS total
        FROM font_files f
        JOIN repos r ON r.id = f.repo_id
        JOIN owners o ON o.id = r.owner_id
        WHERE ${countWhere.join(" AND ")}
      `;

      const [listRaw, countRaw] = await Promise.all([
        ctx.sql.query(listSql, params),
        ctx.sql.query(countSql, countParams),
      ]);
      const listRows = listRaw as FontRow[];
      const countRows = countRaw as { total: number }[];

      const hasNextPage = listRows.length > first;
      const page = hasNextPage ? listRows.slice(0, first) : listRows;
      const nodes = page.map(mapFont);
      const edges = nodes.map((node) => ({
        cursor: fontCursorOf(node),
        node,
      }));
      const endCursor = edges.length > 0 ? edges[edges.length - 1]!.cursor : null;
      const totalCount = Number(countRows[0]?.total ?? 0);

      return {
        edges,
        pageInfo: { hasNextPage, endCursor },
        totalCount,
      };
    },
  }),

  font: t.field({
    type: FontFileRef,
    nullable: true,
    args: {
      id: t.arg.id({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      const id = Number(args.id);
      if (!Number.isFinite(id)) return null;

      const rows = (await ctx.sql`
        SELECT
          f.id AS font_file_id,
          f.cdn_url,
          f.raw_url,
          f.format,
          f.file_name,
          f.path,
          f.family_guess,
          f.weight_guess,
          f.style_guess,
          f.is_variable,
          f.is_webfont,
          r.id AS repo_id,
          r.full_name,
          r.name AS repo_name,
          r.html_url AS repo_url,
          r.stars,
          r.reputation,
          r.license_spdx,
          r.default_branch,
          o.login AS owner_login,
          o.owner_type,
          o.html_url AS owner_url
        FROM font_files f
        JOIN repos r ON r.id = f.repo_id
        JOIN owners o ON o.id = r.owner_id
        WHERE f.id = ${id}
          AND NOT r.is_archived
          AND r.is_fontish
          AND f.format IN ('ttf', 'otf', 'woff', 'woff2')
        LIMIT 1
      `) as FontRow[];

      const row = rows[0];
      return row ? mapFont(row) : null;
    },
  }),

  repos: t.field({
    type: RepoConnectionRef,
    args: {
      filter: t.arg({ type: RepoFilterInput, required: false }),
      first: t.arg.int({ required: false, defaultValue: DEFAULT_FIRST }),
      after: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      const first = clamp(args.first ?? DEFAULT_FIRST, 1, MAX_FIRST);
      const filter = args.filter ?? {};
      const minStars = filter.minStars ?? 0;
      const owner = filter.owner?.trim() || null;
      const q = filter.q?.trim() || null;
      const qPattern = q ? `%${q}%` : null;
      const withFonts = filter.withFonts ?? null;

      const cursor = args.after ? decodeRepoCursor(args.after) : null;
      if (args.after && !cursor) {
        throw new Error("Invalid cursor");
      }

      const params: unknown[] = [];
      const push = (v: unknown) => {
        params.push(v);
        return `$${params.length}`;
      };

      const where: string[] = [
        `r.is_fontish`,
        `NOT r.is_fork`,
        `NOT r.is_archived`,
        `r.stars >= ${push(minStars)}`,
      ];

      if (owner) {
        where.push(`o.login = ${push(owner)}`);
      }
      if (withFonts === true) {
        where.push(`EXISTS (SELECT 1 FROM font_files ff WHERE ff.repo_id = r.id)`);
      } else if (withFonts === false) {
        where.push(
          `NOT EXISTS (SELECT 1 FROM font_files ff WHERE ff.repo_id = r.id)`,
        );
      }
      if (qPattern) {
        const p = push(qPattern);
        where.push(`(
          r.full_name ILIKE ${p}
          OR r.description ILIKE ${p}
          OR o.login ILIKE ${p}
        )`);
      }
      if (cursor) {
        // keyset: (reputation DESC, id DESC)
        const pRep = push(cursor.rep);
        const pId = push(cursor.id);
        where.push(`(r.reputation, r.id) < (${pRep}, ${pId})`);
      }

      const limitParam = push(first + 1);

      const listSql = `
        SELECT
          r.id,
          r.full_name,
          r.name,
          r.description,
          r.html_url,
          r.stars,
          r.reputation,
          r.license_spdx,
          r.default_branch,
          o.login AS owner_login,
          COALESCE(
            (SELECT COUNT(*)::int FROM font_files ff WHERE ff.repo_id = r.id),
            0
          ) AS font_count
        FROM repos r
        JOIN owners o ON o.id = r.owner_id
        WHERE ${where.join(" AND ")}
        ORDER BY ${repoOrderBy()}
        LIMIT ${limitParam}
      `;

      // Count without keyset
      const countParams: unknown[] = [];
      const cpush = (v: unknown) => {
        countParams.push(v);
        return `$${countParams.length}`;
      };
      const countWhere: string[] = [
        `r.is_fontish`,
        `NOT r.is_fork`,
        `NOT r.is_archived`,
        `r.stars >= ${cpush(minStars)}`,
      ];
      if (owner) countWhere.push(`o.login = ${cpush(owner)}`);
      if (withFonts === true) {
        countWhere.push(
          `EXISTS (SELECT 1 FROM font_files ff WHERE ff.repo_id = r.id)`,
        );
      } else if (withFonts === false) {
        countWhere.push(
          `NOT EXISTS (SELECT 1 FROM font_files ff WHERE ff.repo_id = r.id)`,
        );
      }
      if (qPattern) {
        const p = cpush(qPattern);
        countWhere.push(`(
          r.full_name ILIKE ${p}
          OR r.description ILIKE ${p}
          OR o.login ILIKE ${p}
        )`);
      }

      const countSql = `
        SELECT COUNT(*)::int AS total
        FROM repos r
        JOIN owners o ON o.id = r.owner_id
        WHERE ${countWhere.join(" AND ")}
      `;

      const [listRaw, countRaw] = await Promise.all([
        ctx.sql.query(listSql, params),
        ctx.sql.query(countSql, countParams),
      ]);
      const listRows = listRaw as RepoRow[];
      const countRows = countRaw as { total: number }[];

      const hasNextPage = listRows.length > first;
      const page = hasNextPage ? listRows.slice(0, first) : listRows;
      const nodes = page.map(mapRepo);
      const edges = nodes.map((node) => ({
        cursor: repoCursorOf(node),
        node,
      }));
      const endCursor = edges.length > 0 ? edges[edges.length - 1]!.cursor : null;
      const totalCount = Number(countRows[0]?.total ?? 0);

      return {
        edges,
        pageInfo: { hasNextPage, endCursor },
        totalCount,
      };
    },
  }),

  repo: t.field({
    type: RepoRef,
    nullable: true,
    args: {
      owner: t.arg.string({ required: true }),
      name: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      const fullName = `${args.owner}/${args.name}`;
      const rows = (await ctx.sql`
        SELECT
          r.id,
          r.full_name,
          r.name,
          r.description,
          r.html_url,
          r.stars,
          r.reputation,
          r.license_spdx,
          r.default_branch,
          o.login AS owner_login,
          COALESCE(
            (SELECT COUNT(*)::int FROM font_files ff WHERE ff.repo_id = r.id),
            0
          ) AS font_count
        FROM repos r
        JOIN owners o ON o.id = r.owner_id
        WHERE r.full_name = ${fullName}
        LIMIT 1
      `) as RepoRow[];
      const row = rows[0];
      return row ? mapRepo(row) : null;
    },
  }),
}));

  markTypesRegistered();
}

registerSchemaTypes();
