export type ResolvedFontStyle = "normal" | "italic" | "oblique";

type FontFamilySource = {
  familyGuess?: string | null;
  fileName?: string | null;
};

export function resolveFontFamily(font: FontFamilySource): string {
  const guessed = font.familyGuess?.trim();
  if (guessed) return guessed;

  return (
    font.fileName
      ?.replace(/\.(ttf|otf|woff2?|ttc)$/i, "")
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

export function cssFontFamilyValue(name: string): string {
  return `'${cssStringContents(name)}'`;
}

export function resolveFontWeight(
  weight: number | null | undefined,
): number {
  return typeof weight === "number" &&
    Number.isInteger(weight) &&
    weight >= 1 &&
    weight <= 1000
    ? weight
    : 400;
}

export function resolveFontStyle(
  style: string | null | undefined,
): ResolvedFontStyle {
  return style === "italic" || style === "oblique" ? style : "normal";
}
