import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

export type Sql = NeonQueryFunction<false, false>;

let sqlSingleton: Sql | null = null;

/**
 * Neon serverless HTTP client (preferred on Vercel).
 * Requires DATABASE_URL at runtime — never import this into client components.
 */
export function getSql(): Sql {
  if (sqlSingleton) return sqlSingleton;

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is required. Copy .env.example → .env.local and set your Neon connection string.",
    );
  }

  sqlSingleton = neon(url);
  return sqlSingleton;
}
