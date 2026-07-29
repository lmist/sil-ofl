/**
 * Opaque keyset cursors for connection pagination.
 * Format: base64url(JSON) — never expose raw offsets for deep pages.
 */

export type FontCursorPayload = {
  v: 2;
  /** sort field values used for keyset comparison */
  rep: number;
  stars: number;
  family: string | null;
  id: number;
};

export type RepoCursorPayload = {
  v: 1;
  rep: number;
  stars: number;
  name: string;
  id: number;
};

function b64urlEncode(json: string): string {
  return Buffer.from(json, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function b64urlDecode(cursor: string): string {
  const pad = cursor.length % 4 === 0 ? "" : "=".repeat(4 - (cursor.length % 4));
  const b64 = cursor.replace(/-/g, "+").replace(/_/g, "/") + pad;
  return Buffer.from(b64, "base64").toString("utf8");
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function isSignedInt32(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= -2_147_483_648 &&
    value <= 2_147_483_647
  );
}

function isNulFree(value: string): boolean {
  return !value.includes("\0");
}

export function isPositiveSafeInteger(value: unknown): value is number {
  return isSafeInteger(value) && value > 0;
}

export function parsePositiveSafeInteger(value: unknown): number | null {
  if (isPositiveSafeInteger(value)) return value;
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return null;

  const parsed = Number(value);
  return isPositiveSafeInteger(parsed) ? parsed : null;
}

export function encodeFontCursor(p: FontCursorPayload): string {
  return b64urlEncode(JSON.stringify(p));
}

export function decodeFontCursor(cursor: string): FontCursorPayload | null {
  try {
    const raw = JSON.parse(b64urlDecode(cursor)) as Partial<FontCursorPayload>;
    if (
      raw.v !== 2 ||
      !isPositiveSafeInteger(raw.id) ||
      !isSignedInt32(raw.rep) ||
      !isSignedInt32(raw.stars) ||
      (raw.family !== null &&
        (typeof raw.family !== "string" || !isNulFree(raw.family)))
    ) {
      return null;
    }
    return {
      v: 2,
      rep: raw.rep,
      stars: raw.stars,
      family: raw.family,
      id: raw.id,
    };
  } catch {
    return null;
  }
}

export function encodeRepoCursor(p: RepoCursorPayload): string {
  return b64urlEncode(JSON.stringify(p));
}

export function decodeRepoCursor(cursor: string): RepoCursorPayload | null {
  try {
    const raw = JSON.parse(b64urlDecode(cursor)) as Partial<RepoCursorPayload>;
    if (
      raw.v !== 1 ||
      !isPositiveSafeInteger(raw.id) ||
      !isSignedInt32(raw.rep) ||
      !isSignedInt32(raw.stars) ||
      typeof raw.name !== "string" ||
      !isNulFree(raw.name)
    ) {
      return null;
    }
    return {
      v: 1,
      rep: raw.rep,
      stars: raw.stars,
      name: raw.name,
      id: raw.id,
    };
  } catch {
    return null;
  }
}
