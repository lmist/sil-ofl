/** Domain types mirroring Neon schema / GraphQL FontFile + Repo. */

export type FontFormat = "ttf" | "otf" | "woff" | "woff2" | "ttc";

export type FontSort =
  | "REPUTATION_DESC"
  | "REPUTATION_ASC"
  | "STARS_DESC"
  | "STARS_ASC"
  | "FAMILY_ASC"
  | "FAMILY_DESC"
  | "ID_DESC"
  | "ID_ASC";

export interface FontFile {
  fontFileId: number;
  cdnUrl: string;
  rawUrl: string;
  format: string;
  fileName: string;
  path: string;
  familyGuess: string | null;
  weightGuess: number | null;
  styleGuess: string | null;
  isVariable: boolean;
  isWebfont: boolean;
  repoId: number;
  fullName: string;
  repoName: string;
  repoUrl: string;
  stars: number;
  reputation: number;
  licenseSpdx: string | null;
  defaultBranch: string;
  ownerLogin: string;
  ownerType: string;
  ownerUrl: string | null;
}

export interface Repo {
  id: number;
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
}

export interface CatalogStats {
  repos: number;
  fontFiles: number;
  owners: number;
  reposWithFiles: number;
}

export interface FontsFilter {
  q?: string | null;
  owner?: string | null;
  /** Multi-format filter (GraphQL FontFilter.format: [String!]) */
  format?: string[] | string | null;
  minStars?: number | null;
  webfont?: boolean | null;
  variable?: boolean | null;
  first?: number | null;
  after?: string | null;
  sort?: FontSort | null;
}

export interface ReposFilter {
  q?: string | null;
  owner?: string | null;
  minStars?: number | null;
  withFonts?: boolean | null;
  first?: number | null;
  after?: string | null;
}

export interface PageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

export interface FontConnection {
  edges: { cursor: string; node: FontFile }[];
  pageInfo: PageInfo;
  totalCount: number;
}

export interface RepoConnection {
  edges: { cursor: string; node: Repo }[];
  pageInfo: PageInfo;
  totalCount: number;
}
