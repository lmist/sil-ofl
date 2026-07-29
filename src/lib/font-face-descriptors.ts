export type ResolvedFontStyle = "normal" | "italic" | "oblique";

export function resolveFontWeight(
  weight: number | null | undefined,
): number {
  return typeof weight === "number" && Number.isFinite(weight) && weight > 0
    ? weight
    : 400;
}

export function resolveFontStyle(
  style: string | null | undefined,
): ResolvedFontStyle {
  return style === "italic" || style === "oblique" ? style : "normal";
}
