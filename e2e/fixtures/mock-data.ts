/**
 * Deterministic catalog fixtures for GraphQL route mocks.
 * CDN URLs point at a public Inter woff2 so specimen face load can succeed.
 */

export const MOCK_INTER_CDN =
  "https://cdn.jsdelivr.net/gh/rsms/inter@master/docs/font-files/Inter-Regular.woff2";
export const MOCK_INTER_RAW =
  "https://raw.githubusercontent.com/rsms/inter/master/docs/font-files/Inter-Regular.woff2";

export type MockFontNode = {
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
  licenseSpdx: string | null;
  ownerType: string;
  ownerUrl: string | null;
};

function font(
  partial: Pick<
    MockFontNode,
    "fontFileId" | "familyGuess" | "format" | "ownerLogin" | "fileName"
  > &
    Partial<MockFontNode>,
): MockFontNode {
  const id = String(partial.fontFileId);
  return {
    id,
    cdnUrl: MOCK_INTER_CDN,
    rawUrl: MOCK_INTER_RAW,
    format: partial.format,
    fileName: partial.fileName,
    path: `fonts/${partial.fileName}`,
    familyGuess: partial.familyGuess,
    weightGuess: partial.weightGuess ?? 400,
    styleGuess: partial.styleGuess ?? "normal",
    isVariable: partial.isVariable ?? false,
    isWebfont: partial.isWebfont ?? partial.format === "woff2",
    stars: partial.stars ?? 100,
    reputation: partial.reputation ?? 50,
    ownerLogin: partial.ownerLogin,
    fullName: `${partial.ownerLogin}/${partial.repoName ?? "fonts"}`,
    defaultBranch: "main",
    fontFileId: partial.fontFileId,
    repoId: partial.repoId ?? partial.fontFileId,
    repoName: partial.repoName ?? "fonts",
    repoUrl: `https://github.com/${partial.ownerLogin}/${partial.repoName ?? "fonts"}`,
    licenseSpdx: "OFL-1.1",
    ownerType: "User",
    ownerUrl: `https://github.com/${partial.ownerLogin}`,
  };
}

/** Two pages × 3 rows so next/prev pagination is deterministic. */
export const MOCK_FONTS_PAGE1: MockFontNode[] = [
  font({
    fontFileId: 101,
    familyGuess: "Inter",
    format: "woff2",
    ownerLogin: "rsms",
    fileName: "Inter-Regular.woff2",
    stars: 5000,
    reputation: 99,
  }),
  font({
    fontFileId: 102,
    familyGuess: "Source Sans 3",
    format: "otf",
    ownerLogin: "adobe-fonts",
    fileName: "SourceSans3-BoldItalic.otf",
    weightGuess: 700,
    styleGuess: "italic",
    stars: 2000,
    reputation: 90,
  }),
  font({
    fontFileId: 103,
    familyGuess: "Fira Code",
    format: "woff2",
    ownerLogin: "tonsky",
    fileName: "FiraCode-Regular.woff2",
    stars: 1500,
    reputation: 85,
    isVariable: true,
  }),
];

export const MOCK_FONTS_PAGE2: MockFontNode[] = [
  font({
    fontFileId: 201,
    familyGuess: "JetBrains Mono",
    format: "ttf",
    ownerLogin: "JetBrains",
    fileName: "JetBrainsMono-Regular.ttf",
    stars: 800,
    reputation: 80,
  }),
  font({
    fontFileId: 202,
    familyGuess: "Noto Sans",
    format: "ttf",
    ownerLogin: "notofonts",
    fileName: "NotoSans-Regular.ttf",
    stars: 600,
    reputation: 75,
  }),
  font({
    fontFileId: 203,
    familyGuess: "Recursive",
    format: "woff2",
    ownerLogin: "arrowtype",
    fileName: "Recursive-Regular.woff2",
    stars: 400,
    reputation: 70,
    isVariable: true,
  }),
];

/** Sort-contract row kept out of default pages so UI fixture outcomes stay stable. */
export const MOCK_NULL_FAMILY_FONT: MockFontNode = font({
  fontFileId: 301,
  familyGuess: null,
  format: "ttf",
  ownerLogin: "unidentified",
  fileName: "Unknown-Regular.ttf",
  repoName: "unknown-fonts",
  stars: 300,
  reputation: 65,
});

export const ALL_MOCK_FONTS = [...MOCK_FONTS_PAGE1, ...MOCK_FONTS_PAGE2];

export const MOCK_STATS = {
  repos: 120,
  fontFiles: ALL_MOCK_FONTS.length,
  owners: 42,
  reposWithFiles: 110,
};

export const PAGE1_CURSOR = "cursor-page-1-end";
export const PAGE2_CURSOR = "cursor-page-2-end";
