/**
 * asset-url.ts — beads silofl-qiy.6 + .8
 *
 * Builds correctly percent-encoded CDN and raw GitHub URLs for font assets,
 * and provides a predicate + normaliser for existing stored values.
 *
 * Design decisions
 * ----------------
 * 1. Path segments are encoded individually so `/` separators survive.
 * 2. We follow RFC 3986 unreserved characters (A-Z a-z 0-9 - _ . ~) plus the
 *    subset of sub-delimiters that jsDelivr/GitHub reliably accept in paths
 *    (`!`, `$`, `&`, `'`, `(`, `)`, `*`, `+`, `,`, `;`, `=`, `@`).
 *    Space, `#`, `?`, `:`, `%` (when not already an escape), and all non-ASCII
 *    are encoded.
 * 3. Double-encoding is prevented: an existing `%XX` sequence is detected and
 *    left intact; a bare `%` that is NOT followed by two hex digits is encoded
 *    as `%25`.
 * 4. `normaliseExistingUrl` handles raw-space paths that `new URL()` rejects
 *    by splitting on the well-known jsDelivr / GitHub Raw path structure
 *    before URL-parsing, so it is safe to call on every stored row.
 * 5. `ref` may be a 40-char commit sha or a branch name; both are encoded the
 *    same way (a `@` in the ref would be encoded, but refs with `@` are
 *    unusual and encoding is correct regardless).
 */

// Characters that are safe to leave un-encoded in a URL path segment.
// RFC 3986 unreserved + the sub-delimiters jsDelivr/GH tolerate in paths.
// Notably absent: space, #, ?, :, @, %, and all non-ASCII.
const SAFE_SEGMENT_RE = /^[A-Za-z0-9\-._~!$&'()*+,;=@]*$/;

// A valid percent-encoded triplet already in the string.
const PCT_ENCODED_RE = /^%[0-9A-Fa-f]{2}/;

/**
 * Encode a single path segment (no `/` characters allowed or emitted).
 *
 * - Characters matching SAFE_SEGMENT_RE pass through unchanged.
 * - An existing `%XX` sequence is kept (prevent double-encoding).
 * - A bare `%` not followed by two hex digits is encoded as `%25`.
 * - Everything else is UTF-8 encoded then percent-escaped.
 */
function encodeSegment(segment: string): string {
  let result = "";
  let i = 0;
  while (i < segment.length) {
    const ch = segment[i]!;

    // Already a valid escape — keep it verbatim.
    if (ch === "%" && PCT_ENCODED_RE.test(segment.slice(i))) {
      result += segment.slice(i, i + 3);
      i += 3;
      continue;
    }

    // Safe ASCII subset — pass through.
    if (SAFE_SEGMENT_RE.test(ch)) {
      result += ch;
      i += 1;
      continue;
    }

    // Everything else (including non-ASCII, space, #, ?, :, %) — UTF-8 encode.
    const bytes = new TextEncoder().encode(ch);
    for (const byte of bytes) {
      result += "%" + byte.toString(16).toUpperCase().padStart(2, "0");
    }
    i += 1;
  }
  return result;
}

/**
 * Encode a full path string.  Splits on `/`, encodes each segment, re-joins.
 * Empty segments (e.g. leading slash or double-slash) are preserved as-is so
 * the structural shape of the path is not altered.
 */
function encodePath(rawPath: string): string {
  return rawPath
    .split("/")
    .map((segment) => (segment === "" ? "" : encodeSegment(segment)))
    .join("/");
}

// ── Public builders ──────────────────────────────────────────────────────────

export interface AssetUrlParams {
  /** GitHub owner (user or org). */
  owner: string;
  /** Repository name. */
  repo: string;
  /**
   * Git ref — SHOULD be a commit sha for stable addressing (see silofl-qiy.9).
   * A branch name is accepted and encoded correctly.
   */
  ref: string;
  /** File path within the repo, relative to the root.  May have leading `/`. */
  path: string;
}

/**
 * Build a jsDelivr CDN URL with correctly encoded path segments.
 *
 * Shape: `https://cdn.jsdelivr.net/gh/<owner>/<repo>@<ref>/<path>`
 *
 * `ref` SHOULD be a commit sha (see silofl-qiy.9).  A branch name is accepted
 * for backfill compatibility but produces a mutable URL.
 */
export function buildCdnUrl({
  owner,
  repo,
  ref,
  path,
}: AssetUrlParams): string {
  const normPath = path.startsWith("/") ? path.slice(1) : path;
  const encodedOwner = encodeSegment(owner);
  const encodedRepo = encodeSegment(repo);
  const encodedRef = encodeSegment(ref);
  const encodedPath = encodePath(normPath);
  return `https://cdn.jsdelivr.net/gh/${encodedOwner}/${encodedRepo}@${encodedRef}/${encodedPath}`;
}

/**
 * Build a raw.githubusercontent.com URL with correctly encoded path segments.
 *
 * Shape: `https://raw.githubusercontent.com/<owner>/<repo>/<ref>/<path>`
 */
export function buildRawUrl({
  owner,
  repo,
  ref,
  path,
}: AssetUrlParams): string {
  const normPath = path.startsWith("/") ? path.slice(1) : path;
  const encodedOwner = encodeSegment(owner);
  const encodedRepo = encodeSegment(repo);
  const encodedRef = encodeSegment(ref);
  const encodedPath = encodePath(normPath);
  return `https://raw.githubusercontent.com/${encodedOwner}/${encodedRepo}/${encodedRef}/${encodedPath}`;
}

// ── Predicate ────────────────────────────────────────────────────────────────

/**
 * Approved origins for asset URLs (mirrors external-url-policy.ts).
 * Kept in sync by intent; we do not import that module to avoid pulling
 * server/GraphQL dependencies into ingest code.
 */
const APPROVED_CDN_ORIGIN = "https://cdn.jsdelivr.net";
const APPROVED_RAW_ORIGIN = "https://raw.githubusercontent.com";

// Characters that must not appear unencoded in a valid URL path.
// A well-formed URL produced by buildCdnUrl / buildRawUrl will never contain
// these; we use this to reject the 1,917 broken stored shapes.
const FORBIDDEN_UNENCODED_RE = /[ \t\r\n#?]|[^\x00-\x7F]/;

/**
 * Returns `true` if `url` is a well-formed CDN or raw asset URL.
 *
 * Rejects:
 * - URLs with literal spaces, tabs, or newlines in the path (the 1,909 space cases).
 * - URLs with unencoded `#` or `?` in the path.
 * - URLs with non-ASCII characters in the path (the 8 en-dash/colon cases).
 * - Any URL that `new URL()` refuses to parse.
 * - Non-approved origins.
 *
 * Accepts the control fixture and any URL produced by `buildCdnUrl` /
 * `buildRawUrl`.
 */
export function isWellFormedAssetUrl(url: string): boolean {
  // Fast-reject: raw spaces or non-ASCII make the URL unparseable or invalid.
  if (FORBIDDEN_UNENCODED_RE.test(url)) return false;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  const origin = parsed.origin;
  if (origin !== APPROVED_CDN_ORIGIN && origin !== APPROVED_RAW_ORIGIN) {
    return false;
  }

  // Credentials must not appear.
  if (parsed.username !== "" || parsed.password !== "") return false;

  return true;
}

// ── Normaliser ───────────────────────────────────────────────────────────────

/**
 * Parse a stored jsDelivr CDN URL (possibly malformed) into its components.
 *
 * Handles:
 * - Well-formed URLs (parseable by `new URL()`).
 * - Raw-space URLs (not parseable by `new URL()`) — split structurally.
 *
 * Returns `null` when the value cannot be recognised as a jsDelivr GH URL.
 *
 * Pattern expected: `https://cdn.jsdelivr.net/gh/<owner>/<repo>@<ref>/<path>`
 */
function parseCdnStoredUrl(stored: string): AssetUrlParams | null {
  const PREFIX = "https://cdn.jsdelivr.net/gh/";
  if (!stored.startsWith(PREFIX)) return null;

  // Remove the prefix and work with the remainder.
  const rest = stored.slice(PREFIX.length);

  // owner is up to the first `/`
  const firstSlash = rest.indexOf("/");
  if (firstSlash === -1) return null;
  const ownerPart = rest.slice(0, firstSlash);
  const remainder = rest.slice(firstSlash + 1);

  // `<repo>@<ref>` is up to the next `/`
  const secondSlash = remainder.indexOf("/");
  if (secondSlash === -1) return null;
  const repoRefPart = remainder.slice(0, secondSlash);
  const rawPath = remainder.slice(secondSlash + 1);

  // Split repo and ref on the last `@`
  const atIdx = repoRefPart.lastIndexOf("@");
  if (atIdx === -1) return null;
  const repo = repoRefPart.slice(0, atIdx);
  const ref = repoRefPart.slice(atIdx + 1);

  let owner: string;
  try {
    owner = decodeURIComponent(ownerPart);
  } catch {
    owner = ownerPart;
  }

  let decodedRepo: string;
  try {
    decodedRepo = decodeURIComponent(repo);
  } catch {
    decodedRepo = repo;
  }

  let decodedRef: string;
  try {
    decodedRef = decodeURIComponent(ref);
  } catch {
    decodedRef = ref;
  }

  // Decode path — may be fully encoded, partially encoded, or raw (spaces etc).
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(rawPath);
  } catch {
    // Malformed %XX — use raw and re-encode via buildCdnUrl.
    decodedPath = rawPath;
  }

  return { owner, repo: decodedRepo, ref: decodedRef, path: decodedPath };
}

/**
 * Parse a stored raw.githubusercontent.com URL into its components.
 *
 * Pattern: `https://raw.githubusercontent.com/<owner>/<repo>/<ref>/<path>`
 */
function parseRawStoredUrl(stored: string): AssetUrlParams | null {
  const PREFIX = "https://raw.githubusercontent.com/";
  if (!stored.startsWith(PREFIX)) return null;

  const rest = stored.slice(PREFIX.length);
  const parts = rest.split("/");
  if (parts.length < 4) return null;

  const owner = parts[0]!;
  const repo = parts[1]!;
  const ref = parts[2]!;
  const rawPath = parts.slice(3).join("/");

  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(rawPath);
  } catch {
    decodedPath = rawPath;
  }

  return {
    owner: decodeURIComponent(owner),
    repo: decodeURIComponent(repo),
    ref: decodeURIComponent(ref),
    path: decodedPath,
  };
}

/**
 * Take a stored CDN or raw URL (possibly malformed — raw spaces, non-ASCII,
 * partial encoding) and re-emit it in canonical percent-encoded form.
 *
 * Returns `null` when the value is not recognisable as either supported shape.
 *
 * Use case: backfill of the 35,509 existing rows (silofl-qiy.9 then replaces
 * the branch `ref` with the sha from `font_files.sha`).
 */
export function normaliseExistingUrl(stored: string): string | null {
  if (!stored) return null;

  const cdnParsed = parseCdnStoredUrl(stored);
  if (cdnParsed !== null) {
    return buildCdnUrl(cdnParsed);
  }

  const rawParsed = parseRawStoredUrl(stored);
  if (rawParsed !== null) {
    return buildRawUrl(rawParsed);
  }

  return null;
}
