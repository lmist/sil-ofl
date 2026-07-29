/**
 * Tiny performance mark/measure helper for catalog list renders.
 * No-ops when Performance API is missing; labels are prefixed `catalog:`.
 */

const PREFIX = "catalog:";

export function perfMark(name: string): void {
  if (typeof performance === "undefined" || typeof performance.mark !== "function") {
    return;
  }
  try {
    performance.mark(`${PREFIX}${name}`);
  } catch {
    // ignore duplicate/invalid mark names
  }
}

export function perfMeasure(
  name: string,
  startMark: string,
  endMark?: string,
): number | null {
  if (
    typeof performance === "undefined" ||
    typeof performance.measure !== "function"
  ) {
    return null;
  }
  const full = `${PREFIX}${name}`;
  const start = `${PREFIX}${startMark}`;
  try {
    if (endMark) {
      performance.measure(full, start, `${PREFIX}${endMark}`);
    } else {
      performance.measure(full, start);
    }
    const entries = performance.getEntriesByName(full, "measure");
    const last = entries[entries.length - 1];
    return last?.duration ?? null;
  } catch {
    return null;
  }
}

/** Mark start → fn → mark end → measure. Returns duration ms or null. */
export function perfAround<T>(name: string, fn: () => T): T {
  const start = `${name}:start`;
  const end = `${name}:end`;
  perfMark(start);
  try {
    return fn();
  } finally {
    perfMark(end);
    perfMeasure(name, start, end);
  }
}

/** Clear catalog-prefixed marks/measures (dev hygiene). */
export function perfClear(): void {
  if (typeof performance === "undefined") return;
  try {
    performance.getEntriesByType("mark").forEach((e) => {
      if (e.name.startsWith(PREFIX)) performance.clearMarks(e.name);
    });
    performance.getEntriesByType("measure").forEach((e) => {
      if (e.name.startsWith(PREFIX)) performance.clearMeasures(e.name);
    });
  } catch {
    // ignore
  }
}
