export type FontSortValue =
  | "REPUTATION_DESC"
  | "REPUTATION_ASC"
  | "STARS_DESC"
  | "STARS_ASC"
  | "FAMILY_ASC"
  | "FAMILY_DESC"
  | "ID_DESC"
  | "ID_ASC";

export type FontCursorKey = {
  rep: number;
  stars: number;
  family: string | null;
  id: number;
};

export function fontOrderBy(sort: FontSortValue): string {
  switch (sort) {
    case "REPUTATION_ASC":
      return "r.reputation ASC, f.id ASC";
    case "STARS_DESC":
      return "r.stars DESC, f.id DESC";
    case "STARS_ASC":
      return "r.stars ASC, f.id ASC";
    case "FAMILY_ASC":
      return "f.family_guess ASC NULLS LAST, f.id ASC";
    case "FAMILY_DESC":
      return "f.family_guess DESC NULLS LAST, f.id DESC";
    case "ID_ASC":
      return "f.id ASC";
    case "ID_DESC":
      return "f.id DESC";
    case "REPUTATION_DESC":
    default:
      return "r.reputation DESC, f.id DESC";
  }
}

/**
 * Keyset predicate for the active sort.
 * Returns SQL with $n placeholders starting at paramStart, plus bind values
 * in order (only the columns used — never leave unused $params).
 */
export function fontKeyset(
  sort: FontSortValue,
  cursor: FontCursorKey,
  paramStart: number,
): { sql: string; values: Array<string | number> } {
  const p = (offset: number) => `$${paramStart + offset}`;
  switch (sort) {
    case "REPUTATION_ASC":
      return {
        sql: `(r.reputation, f.id) > (${p(0)}, ${p(1)})`,
        values: [cursor.rep, cursor.id],
      };
    case "STARS_DESC":
      return {
        sql: `(r.stars, f.id) < (${p(0)}, ${p(1)})`,
        values: [cursor.stars, cursor.id],
      };
    case "STARS_ASC":
      return {
        sql: `(r.stars, f.id) > (${p(0)}, ${p(1)})`,
        values: [cursor.stars, cursor.id],
      };
    case "FAMILY_ASC":
      if (cursor.family === null) {
        return {
          sql: `(f.family_guess IS NULL AND f.id > ${p(0)})`,
          values: [cursor.id],
        };
      }
      return {
        sql: `(f.family_guess > ${p(0)} OR (f.family_guess = ${p(0)} AND f.id > ${p(1)}) OR f.family_guess IS NULL)`,
        values: [cursor.family, cursor.id],
      };
    case "FAMILY_DESC":
      if (cursor.family === null) {
        return {
          sql: `(f.family_guess IS NULL AND f.id < ${p(0)})`,
          values: [cursor.id],
        };
      }
      return {
        sql: `(f.family_guess < ${p(0)} OR (f.family_guess = ${p(0)} AND f.id < ${p(1)}) OR f.family_guess IS NULL)`,
        values: [cursor.family, cursor.id],
      };
    case "ID_ASC":
      return {
        sql: `f.id > ${p(0)}`,
        values: [cursor.id],
      };
    case "ID_DESC":
      return {
        sql: `f.id < ${p(0)}`,
        values: [cursor.id],
      };
    case "REPUTATION_DESC":
    default:
      return {
        sql: `(r.reputation, f.id) < (${p(0)}, ${p(1)})`,
        values: [cursor.rep, cursor.id],
      };
  }
}
