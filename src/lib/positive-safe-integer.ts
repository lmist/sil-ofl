export function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export function parsePositiveSafeInteger(value: unknown): number | null {
  if (isPositiveSafeInteger(value)) return value;
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return null;

  const parsed = Number(value);
  return isPositiveSafeInteger(parsed) ? parsed : null;
}
