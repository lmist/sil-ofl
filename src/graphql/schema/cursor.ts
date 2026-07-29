/**
 * Opaque keyset cursors for connection pagination.
 * Format: base64url(JSON) — never expose raw offsets for deep pages.
 */

import { isPositiveSafeInteger } from "@/lib/positive-safe-integer";
import { isDatabaseText } from "./database-text";

export {
  isPositiveSafeInteger,
  parsePositiveSafeInteger,
} from "@/lib/positive-safe-integer";

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
  if (!/^[A-Za-z0-9_-]+$/.test(cursor) || cursor.length % 4 === 1) {
    throw new Error("cursor must use unpadded base64url");
  }

  const bytes = Buffer.from(cursor, "base64url");
  if (bytes.toString("base64url") !== cursor) {
    throw new Error("cursor must use canonical base64url");
  }

  const decoded = bytes.toString("utf8");
  if (!Buffer.from(decoded, "utf8").equals(bytes)) {
    throw new Error("cursor must contain valid UTF-8");
  }
  return decoded;
}

function isSignedInt32(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= -2_147_483_648 &&
    value <= 2_147_483_647
  );
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
        (typeof raw.family !== "string" || !isDatabaseText(raw.family)))
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
      !isDatabaseText(raw.name)
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
