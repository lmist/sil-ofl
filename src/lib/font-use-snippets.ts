import type { FontFile } from "@/types/catalog";
import {
  resolveFontStyle,
  resolveFontWeight,
} from "@/lib/font-face-descriptors";
import { approvedExternalUrl } from "@/lib/external-url-policy";

/** CSS `format()` token for @font-face src. */
export function cssFormatHint(format: string): string {
  switch (format.toLowerCase()) {
    case "woff2":
      return "woff2";
    case "woff":
      return "woff";
    case "otf":
      return "opentype";
    case "ttc":
      return "truetype";
    case "ttf":
    default:
      return "truetype";
  }
}

/** Safe CSS font-family name (quoted). */
export function familyName(font: Pick<FontFile, "familyGuess" | "fileName">): string {
  const guessed = font.familyGuess?.trim();
  if (guessed) return guessed;

  return (
    font.fileName
      .replace(/\.(ttf|otf|woff2?|ttc)$/i, "")
      .replace(/[-_]/g, " ")
      .trim() || "CustomFont"
  );
}

function cssStringContents(value: string): string {
  let escaped = "";

  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    if (character === "\\") {
      escaped += "\\\\";
    } else if (character === "'") {
      escaped += "\\'";
    } else if (character === "\n") {
      escaped += "\\A ";
    } else if (character === "\r") {
      escaped += "\\D ";
    } else if (character === "\f") {
      escaped += "\\C ";
    } else if (character === "<") {
      escaped += "\\3C ";
    } else if (codePoint === 0) {
      escaped += "\\FFFD ";
    } else if (codePoint <= 0x1f || codePoint === 0x7f) {
      escaped += `\\${codePoint.toString(16).toUpperCase()} `;
    } else {
      escaped += character;
    }
  }

  return escaped;
}

function cssCommentText(value: string): string {
  return value.replaceAll("\0", "\uFFFD").replaceAll("*/", "*\\/");
}

function htmlText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function cssFontFamilyValue(name: string): string {
  return `'${cssStringContents(name)}'`;
}

export type FontUseSnippets = {
  family: string;
  familyCss: string;
  weight: number;
  style: string;
  css: string | null;
  html: string | null;
  react: string | null;
  cdnUrl: string | null;
  rawUrl: string | null;
  repoUrl: string | null;
  downloadUrl: string | null;
  policyError: string | null;
};

/**
 * Ready-to-paste snippets so someone can use a font they like
 * without reading the repo tree.
 */
export function buildFontUseSnippets(font: FontFile): FontUseSnippets {
  const family = familyName(font);
  const familyCss = cssFontFamilyValue(family);
  const familyComment = cssCommentText(family);
  const sourceComment = cssCommentText(font.fullName);
  const familyHtml = htmlText(family);
  const weight = resolveFontWeight(font.weightGuess);
  const style = resolveFontStyle(font.styleGuess);
  const fmt = cssFormatHint(font.format);
  const cdnUrl = approvedExternalUrl(font.cdnUrl, "fontCdn");
  const rawUrl = approvedExternalUrl(font.rawUrl, "fontRaw");
  const repoUrl = approvedExternalUrl(font.repoUrl, "repository");
  const url = cdnUrl ?? rawUrl;
  const hasUnapprovedTarget =
    !cdnUrl ||
    !rawUrl ||
    !repoUrl;
  const policyError = hasUnapprovedTarget
    ? "Some font actions are unavailable because this record has unapproved links."
    : null;

  const css = url
    ? [
        `/* ${familyComment} — SIL Open Font License`,
        ` * Source: ${sourceComment}`,
        ` * Prefer jsDelivr CDN for browser @font-face`,
        ` */`,
        `@font-face {`,
        `  font-family: ${familyCss};`,
        `  src: url('${url}') format('${fmt}');`,
        `  font-weight: ${weight};`,
        `  font-style: ${style};`,
        `  font-display: swap;`,
        `}`,
        ``,
        `/* use it */`,
        `.my-text {`,
        `  font-family: ${familyCss}, system-ui, sans-serif;`,
        `  font-weight: ${weight};`,
        `  font-style: ${style};`,
        `}`,
      ].join("\n")
    : null;

  const html = url
    ? [
        `<!doctype html>`,
        `<html lang="en">`,
        `<head>`,
        `  <meta charset="utf-8" />`,
        `  <title>${familyHtml}</title>`,
        `  <style>`,
        `    @font-face {`,
        `      font-family: ${familyCss};`,
        `      src: url('${url}') format('${fmt}');`,
        `      font-weight: ${weight};`,
        `      font-style: ${style};`,
        `      font-display: swap;`,
        `    }`,
        `    body {`,
        `      font-family: ${familyCss}, system-ui, sans-serif;`,
        `      font-weight: ${weight};`,
        `      font-style: ${style};`,
        `      font-size: 2rem;`,
        `    }`,
        `  </style>`,
        `</head>`,
        `<body>`,
        `  <p>The quick brown fox jumps over the lazy dog.</p>`,
        `</body>`,
        `</html>`,
      ].join("\n")
    : null;

  const reactFontFace = url
    ? [
        `@font-face {`,
        `  font-family: ${familyCss};`,
        `  src: url('${url}') format('${fmt}');`,
        `  font-weight: ${weight};`,
        `  font-style: ${style};`,
        `  font-display: swap;`,
        `}`,
      ].join("\n")
    : null;

  const react = reactFontFace
    ? [
        `export function FontExample() {`,
        `  return (`,
        `    <>`,
        `      <style>{${JSON.stringify(reactFontFace)}}</style>`,
        `      <p`,
        `        style={{`,
        `          fontFamily: ${JSON.stringify(`${family}, system-ui, sans-serif`)},`,
        `          fontWeight: ${weight},`,
        `          fontStyle: ${JSON.stringify(style)},`,
        `        }}`,
        `      >`,
        `        The quick brown fox jumps over the lazy dog.`,
        `      </p>`,
        `    </>`,
        `  );`,
        `}`,
      ].join("\n")
    : null;

  return {
    family,
    familyCss,
    weight,
    style,
    css,
    html,
    react,
    cdnUrl,
    rawUrl,
    repoUrl,
    downloadUrl: url,
    policyError,
  };
}
