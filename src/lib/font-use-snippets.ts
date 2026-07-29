import type { FontFile } from "@/types/catalog";
import {
  resolveFontStyle,
  resolveFontWeight,
} from "@/lib/font-face-descriptors";

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
  const raw =
    (font.familyGuess && font.familyGuess.trim()) ||
    font.fileName.replace(/\.(ttf|otf|woff2?|ttc)$/i, "").replace(/[-_]/g, " ");
  return raw.replace(/['"]/g, "").trim() || "CustomFont";
}

export function cssFontFamilyValue(name: string): string {
  // Quote always — handles spaces and special chars safely.
  return `'${name.replace(/'/g, "\\'")}'`;
}

export type FontUseSnippets = {
  family: string;
  familyCss: string;
  weight: number;
  style: string;
  css: string;
  html: string;
  react: string;
  cdnUrl: string;
  rawUrl: string;
  repoUrl: string;
  downloadUrl: string;
};

/**
 * Ready-to-paste snippets so someone can use a font they like
 * without reading the repo tree.
 */
export function buildFontUseSnippets(font: FontFile): FontUseSnippets {
  const family = familyName(font);
  const familyCss = cssFontFamilyValue(family);
  const weight = resolveFontWeight(font.weightGuess);
  const style = resolveFontStyle(font.styleGuess);
  const fmt = cssFormatHint(font.format);
  const url = font.cdnUrl || font.rawUrl;

  const css = [
    `/* ${family} — SIL Open Font License`,
    ` * Source: ${font.fullName}`,
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
  ].join("\n");

  const html = [
    `<!doctype html>`,
    `<html lang="en">`,
    `<head>`,
    `  <meta charset="utf-8" />`,
    `  <title>${family}</title>`,
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
  ].join("\n");

  const reactFontFace = [
    `@font-face {`,
    `  font-family: ${familyCss};`,
    `  src: url('${url}') format('${fmt}');`,
    `  font-weight: ${weight};`,
    `  font-style: ${style};`,
    `  font-display: swap;`,
    `}`,
  ].join("\n");

  const react = [
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
  ].join("\n");

  return {
    family,
    familyCss,
    weight,
    style,
    css,
    html,
    react,
    cdnUrl: font.cdnUrl,
    rawUrl: font.rawUrl,
    repoUrl: font.repoUrl,
    downloadUrl: font.cdnUrl || font.rawUrl,
  };
}
