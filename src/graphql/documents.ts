import { gql } from "graphql-request";

/** Typed document helpers for the Next app (graphql-request + TanStack Query). */

export const HEALTH_QUERY = gql`
  query Health {
    health {
      ok
      service
      ts
    }
  }
`;

export const STATS_QUERY = gql`
  query CatalogStats {
    stats {
      repos
      fontFiles
      owners
      reposWithFiles
    }
  }
`;

export const FONTS_QUERY = gql`
  query Fonts(
    $filter: FontFilter
    $sort: FontSort
    $first: Int = 50
    $after: String
  ) {
    fonts(filter: $filter, sort: $sort, first: $first, after: $after) {
      totalCount
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        cursor
        node {
          id
          cdnUrl
          rawUrl
          format
          fileName
          path
          familyGuess
          weightGuess
          styleGuess
          isVariable
          isWebfont
          stars
          reputation
          ownerLogin
          fullName
          defaultBranch
          fontFileId
          repoId
          repoName
          repoUrl
          licenseSpdx
          ownerType
          ownerUrl
        }
      }
    }
  }
`;

export const FONT_QUERY = gql`
  query Font($id: ID!) {
    font(id: $id) {
      id
      cdnUrl
      rawUrl
      format
      fileName
      path
      familyGuess
      weightGuess
      styleGuess
      isVariable
      isWebfont
      stars
      reputation
      ownerLogin
      fullName
      defaultBranch
      fontFileId
      repoId
      repoName
      repoUrl
      licenseSpdx
      ownerType
      ownerUrl
    }
  }
`;

export const REPOS_QUERY = gql`
  query Repos($filter: RepoFilter, $first: Int = 50, $after: String) {
    repos(filter: $filter, first: $first, after: $after) {
      totalCount
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        cursor
        node {
          id
          fullName
          name
          description
          htmlUrl
          stars
          reputation
          licenseSpdx
          defaultBranch
          ownerLogin
          fontCount
        }
      }
    }
  }
`;

export const REPO_QUERY = gql`
  query Repo($owner: String!, $name: String!) {
    repo(owner: $owner, name: $name) {
      id
      fullName
      name
      description
      htmlUrl
      stars
      reputation
      licenseSpdx
      defaultBranch
      ownerLogin
      fontCount
    }
  }
`;

/* -------------------------------------------------------------------------- */
/*  Result / variable types for request helpers                               */
/* -------------------------------------------------------------------------- */

export type HealthQueryResult = {
  health: { ok: boolean; service: string; ts: string };
};

export type StatsQueryResult = {
  stats: {
    repos: number;
    fontFiles: number;
    owners: number;
    reposWithFiles: number;
  };
};

export type FontNode = {
  id: string;
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
  stars: number;
  reputation: number;
  ownerLogin: string;
  fullName: string;
  defaultBranch: string;
  fontFileId: number;
  repoId: number;
  repoName: string;
  repoUrl: string;
  licenseSpdx: string;
  ownerType: string;
  ownerUrl: string | null;
};

export type FontsQueryResult = {
  fonts: {
    totalCount: number;
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    edges: { cursor: string; node: FontNode }[];
  };
};

export type FontFilterVars = {
  q?: string | null;
  owner?: string | null;
  format?: string[] | null;
  minStars?: number | null;
  webfont?: boolean | null;
  variable?: boolean | null;
};

export type FontSortVar =
  | "REPUTATION_DESC"
  | "REPUTATION_ASC"
  | "STARS_DESC"
  | "STARS_ASC"
  | "FAMILY_ASC"
  | "FAMILY_DESC"
  | "ID_DESC"
  | "ID_ASC";

export type FontsQueryVariables = {
  filter?: FontFilterVars | null;
  sort?: FontSortVar | null;
  first?: number | null;
  after?: string | null;
};

export type FontQueryResult = {
  font: FontNode | null;
};

export type RepoNode = {
  id: string;
  fullName: string;
  name: string;
  description: string | null;
  htmlUrl: string;
  stars: number;
  reputation: number;
  licenseSpdx: string;
  defaultBranch: string;
  ownerLogin: string;
  fontCount: number;
};

export type ReposQueryResult = {
  repos: {
    totalCount: number;
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    edges: { cursor: string; node: RepoNode }[];
  };
};

export type RepoFilterVars = {
  q?: string | null;
  owner?: string | null;
  minStars?: number | null;
  withFonts?: boolean | null;
};

export type ReposQueryVariables = {
  filter?: RepoFilterVars | null;
  first?: number | null;
  after?: string | null;
};

export type RepoQueryResult = {
  repo: RepoNode | null;
};
