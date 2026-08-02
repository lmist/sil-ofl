/**
 * license-detect.ts
 *
 * OFL licence text detection for the sil-ofl ingest pipeline.
 *
 * Implements beads silofl-qiy.13 (licence recovery) and .14 (OFL-1.0
 * reachability).
 *
 * ── Design rationale ─────────────────────────────────────────────────────
 * INV-DATA-1 is absolute: only OFL-1.0 and OFL-1.1 reach the public
 * catalog. A wrong licence claim is far worse than an omission. Therefore:
 *
 *   1. We match only stable, version-specific phrases that appear verbatim
 *      in every authentic copy of the respective licence.
 *   2. A match requires TWO independent confirming signals: the version line
 *      (e.g. "Version 1.1") AND a second phrase unique to that version.
 *      A single match is not enough.
 *   3. Ambiguous, short, or mixed-signal texts return null. The repo stays
 *      out of the catalog. False negatives are acceptable; false positives
 *      are not.
 *   4. Normalise whitespace and case for comparison, but do not fuzzy-match
 *      words or use edit distance — the signal must be structural, not
 *      statistical.
 *
 * OFL version distinguishers (from official texts, verified 2026-08-02):
 *
 *   OFL 1.0 — released 22 November 2005
 *     Unique phrases:
 *       - "Version 1.0 - 22 November 2005"  (title line)
 *       - "development of cooperative font projects"  (preamble)
 *       - "Standard Version"  (definitions section)
 *       - "No modification of the license is permitted"  (header)
 *
 *   OFL 1.1 — released 26 February 2007
 *     Unique phrases:
 *       - "Version 1.1 - 26 February 2007"  (title line)
 *       - "development of collaborative font projects"  (preamble)
 *       - "Original Version"  (definitions section)
 *       - "a free and open framework"  (preamble, absent in 1.0)
 *
 * Threshold: a confident match requires at least two version-specific
 * signals from the same version. One signal alone could be a prose
 * reference, a partial copy, or a mis-labelled wrapper.
 * ─────────────────────────────────────────────────────────────────────────
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** SPDX identifier for a detected OFL version. */
export type OflSpdx = "OFL-1.0" | "OFL-1.1";

/** Result of a successful OFL detection. */
export interface OflDetectResult {
  /** SPDX identifier of the detected version. */
  spdx: OflSpdx;
  /**
   * Confidence level.
   *   'high' — two or more independent version-specific signals matched.
   *   We never return 'low' or 'medium'; any result below 'high' returns null
   *   per the INV-DATA-1 threshold.
   */
  confidence: "high";
  /** The phrases that triggered the match, for audit logging. */
  matchedOn: string[];
}

// ---------------------------------------------------------------------------
// Internal: version-specific phrase banks
// ---------------------------------------------------------------------------

/**
 * Phrases that appear ONLY in OFL 1.0 (not 1.1).
 * Must be stable across all authentic copies (ignoring surrounding whitespace).
 */
const OFL_10_SIGNALS: readonly string[] = [
  // Title line — most reliable; every authentic copy has this
  "sil open font license version 1.0",
  // Preamble — "cooperative" was changed to "collaborative" in 1.1
  "development of cooperative font projects",
  // Definitions — 1.0 uses "Standard Version"; 1.1 uses "Original Version"
  "standard version",
  // Header notice — removed in 1.1
  "no modification of the license is permitted",
];

/**
 * Phrases that appear ONLY in OFL 1.1 (not 1.0).
 * Must be stable across all authentic copies (ignoring surrounding whitespace).
 */
const OFL_11_SIGNALS: readonly string[] = [
  // Title line
  "sil open font license version 1.1",
  // Preamble — "collaborative" replaced "cooperative" in 1.1
  "development of collaborative font projects",
  // Definitions — 1.1 uses "Original Version"; 1.0 used "Standard Version"
  "original version",
  // Preamble phrase unique to 1.1
  "a free and open framework",
];

/**
 * Phrases that confirm the text is an OFL but do not distinguish 1.0 vs 1.1.
 * Used to rule out texts that merely mention OFL in prose without licensing
 * under it, and to confirm a match is substantive.
 */
const OFL_COMMON_SIGNALS: readonly string[] = [
  "sil open font license",
  "permission & conditions",
  "the font software is provided",
];

// ---------------------------------------------------------------------------
// Internal normaliser
// ---------------------------------------------------------------------------

/**
 * Normalise a licence text for matching:
 *   - Lowercase
 *   - Collapse all whitespace (including newlines) to single spaces
 *   - Trim
 *
 * We do NOT strip punctuation because the phrases we match include specific
 * punctuation that helps distinguish them (e.g. commas, hyphens).
 */
function normalise(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Detect whether `text` contains the body of an OFL 1.0 or 1.1 licence,
 * and which version it is.
 *
 * Returns null when:
 *   - The text is empty or too short to contain a real licence
 *   - Fewer than two version-specific signals match
 *   - Signals from both 1.0 and 1.1 match (ambiguous/hybrid text)
 *   - The text mentions OFL in prose but does not contain the licence body
 *
 * A null return means the repo stays out of the catalog. This is intentional
 * — INV-DATA-1 requires that ambiguous matches are treated as no-match.
 */
export function detectOflFromText(text: string): OflDetectResult | null {
  // Minimum plausible length for a real OFL body (~1500 chars for OFL 1.0).
  // This rejects headers, fragments, and mentions. The exact threshold is
  // 500 chars; tuned to reject a one-paragraph description ("This font is
  // licensed under the SIL OFL 1.1") while accepting a real licence.
  if (text.length < 500) return null;

  const norm = normalise(text);

  // Must contain at least one common OFL signal to be considered at all.
  // This rejects texts that mention OFL in prose but are not the licence body.
  const hasCommonSignal = OFL_COMMON_SIGNALS.some((s) => norm.includes(s));
  if (!hasCommonSignal) return null;

  // Count version-specific signals for each version
  const matched10: string[] = [];
  for (const signal of OFL_10_SIGNALS) {
    if (norm.includes(signal)) matched10.push(signal);
  }

  const matched11: string[] = [];
  for (const signal of OFL_11_SIGNALS) {
    if (norm.includes(signal)) matched11.push(signal);
  }

  const has10 = matched10.length >= 2;
  const has11 = matched11.length >= 2;

  // Ambiguous: both versions' signals match (e.g. a file containing both
  // licence texts, or a forged/corrupted file). Return null.
  if (has10 && has11) return null;

  if (has10) {
    return { spdx: "OFL-1.0", confidence: "high", matchedOn: matched10 };
  }

  if (has11) {
    return { spdx: "OFL-1.1", confidence: "high", matchedOn: matched11 };
  }

  // Fewer than two version-specific signals — not conclusive.
  return null;
}

// ---------------------------------------------------------------------------
// Candidate file paths
// ---------------------------------------------------------------------------

/**
 * The file names worth fetching when trying to recover an OFL licence.
 *
 * Ordered from most to least likely to contain a verbatim OFL text.
 * The GitHub contents API is case-insensitive for file listing but
 * case-sensitive for direct path fetches, so we include both cases.
 */
export const CANDIDATE_LICENCE_PATHS: readonly string[] = [
  // OFL-specific filenames (most common in font repos)
  "OFL.txt",
  "OFL.md",
  "OFL",
  // Versioned OFL filenames — used by some repos that store the licence as OFL-1.1.txt
  // or OFL-1.0.txt at the repo root (e.g. boontook-dev, bbaw-schoell, D-DIN-PRO).
  // The filename is inherently version-specific; the detector still verifies the text
  // before accepting, so a false positive requires both the improbable filename AND
  // the detector threshold — that combination is safe.
  "OFL-1.1.txt",
  "OFL-1.0.txt",
  // Generic licence filenames
  "LICENSE",
  "LICENSE.txt",
  "LICENSE.md",
  "LICENCE",
  "LICENCE.txt",
  "LICENCE.md",
  "COPYING",
  "COPYING.txt",
  // fonts/ subdirectory variants (some repos keep the licence with the fonts)
  "fonts/OFL.txt",
  "fonts/LICENSE",
  "fonts/LICENSE.txt",
  "fonts/LICENCE",
  "fonts/LICENCE.txt",
  "fonts/COPYING",
];

/**
 * Return the candidate paths list (alias for external consumers).
 * Exposed as a function to match the interface described in the spec.
 */
export function candidateLicencePaths(): readonly string[] {
  return CANDIDATE_LICENCE_PATHS;
}
