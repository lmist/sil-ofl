/**
 * Opaque keyset cursors for connection pagination.
 * Format: base64url(JSON) — never expose raw offsets for deep pages.
 */

export type FontCursorPayload = {
  v: 1;
  /** sort field values used for keyset comparison */
  rep: number;
  stars: number;
  family: string;
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

export function encodeFontCursor(p: FontCursorPayload): string {
  return b64urlEncode(JSON.stringify(p));
}

export function decodeFontCursor(cursor: string): FontCursorPayload | null {
  try {
    const raw = JSON.parse(b64urlDecode(cursor)) as Partial<FontCursorPayload>;
    if (raw.v !== 1 || typeof raw.id !== "number") return null;
    return {
      v: 1,
      rep: Number(raw.rep ?? 0),
      stars: Number(raw.stars ?? 0),
      family: String(raw.family ?? ""),
      id: Number(raw.id),
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
    if (raw.v !== 1 || typeof raw.id !== "number") return null;
    return {
      v: 1,
      rep: Number(raw.rep ?? 0),
      stars: Number(raw.stars ?? 0),
      name: String(raw.name ?? ""),
      id: Number(raw.id),
    };
  } catch {
    return null;
  }
}
