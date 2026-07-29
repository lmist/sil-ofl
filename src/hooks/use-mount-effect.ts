import { useEffect } from "react";

/**
 * Escape hatch for true mount-only side effects.
 * ESLint bans bare `useEffect` / `React.useEffect` via no-restricted-syntax.
 * Prefer XState machines or TanStack Query for almost everything else.
 */
export function useMountEffect(effect: () => void | (() => void)): void {
  // eslint-disable-next-line no-restricted-syntax, react-hooks/exhaustive-deps -- approved escape hatch; setup/cleanup must reconnect symmetrically in Strict Mode
  useEffect(() => effect(), []);
}
