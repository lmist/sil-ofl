/**
 * PostgreSQL text cannot contain NUL, and the Neon transport cannot encode
 * ill-formed UTF-16. Validate both before opening a database connection.
 */
export function isDatabaseText(value: string): boolean {
  if (value.includes("\0")) return false;

  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);

    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const nextCodeUnit = value.charCodeAt(index + 1);
      if (nextCodeUnit < 0xdc00 || nextCodeUnit > 0xdfff) return false;
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return false;
    }
  }

  return true;
}
