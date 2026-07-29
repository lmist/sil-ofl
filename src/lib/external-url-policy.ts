export type ApprovedExternalTarget =
  | "fontCdn"
  | "fontRaw"
  | "repository";

const APPROVED_ORIGINS: Record<ApprovedExternalTarget, string> = {
  fontCdn: "https://cdn.jsdelivr.net",
  fontRaw: "https://raw.githubusercontent.com",
  repository: "https://github.com",
};

export function approvedExternalUrl(
  value: string | null | undefined,
  target: ApprovedExternalTarget,
): string | null {
  if (!value) return null;

  try {
    const url = new URL(value);
    if (
      url.origin !== APPROVED_ORIGINS[target] ||
      url.username !== "" ||
      url.password !== ""
    ) {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}
