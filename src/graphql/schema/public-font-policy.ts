/**
 * The public catalog policy from INV-DATA-1 and INV-DATA-2.
 *
 * Keep these clauses free of user input so callers can compose them into
 * parameterized list, detail, count, and aggregate queries.
 */
export const ACCEPTED_PUBLIC_FONT_LICENSES = ["OFL-1.0", "OFL-1.1"] as const;

const ACCEPTED_PUBLIC_FONT_LICENSES_SQL = ACCEPTED_PUBLIC_FONT_LICENSES.map(
  (license) => `'${license}'`,
).join(", ");
const NOT_ARCHIVED_CLAUSE = "NOT r.is_archived";
const FONTISH_REPO_CLAUSE = "r.is_fontish";
const NOT_FORK_CLAUSE = "NOT r.is_fork";
const ACCEPTED_LICENSE_CLAUSE =
  `r.license_spdx IN (${ACCEPTED_PUBLIC_FONT_LICENSES_SQL})`;

export function isAcceptedPublicFontLicense(
  license: string | null | undefined,
): license is (typeof ACCEPTED_PUBLIC_FONT_LICENSES)[number] {
  return ACCEPTED_PUBLIC_FONT_LICENSES.some(
    (accepted) => accepted === license,
  );
}

export const PUBLIC_REPO_VISIBILITY_CLAUSES = [
  NOT_ARCHIVED_CLAUSE,
  FONTISH_REPO_CLAUSE,
  NOT_FORK_CLAUSE,
  ACCEPTED_LICENSE_CLAUSE,
] as const;

export const PUBLIC_RENDERABLE_FONT_CLAUSE =
  "f.format IN ('ttf', 'otf', 'woff', 'woff2')";
export const PUBLIC_RENDERABLE_REPO_FONT_CLAUSE =
  "ff.format IN ('ttf', 'otf', 'woff', 'woff2')";

export const PUBLIC_FONT_VISIBILITY_CLAUSES = [
  NOT_ARCHIVED_CLAUSE,
  FONTISH_REPO_CLAUSE,
  NOT_FORK_CLAUSE,
  PUBLIC_RENDERABLE_FONT_CLAUSE,
  ACCEPTED_LICENSE_CLAUSE,
] as const;

export function publicRepoVisibilityClauses(): string[] {
  return [...PUBLIC_REPO_VISIBILITY_CLAUSES];
}

export function publicFontVisibilityClauses(): string[] {
  return [...PUBLIC_FONT_VISIBILITY_CLAUSES];
}
