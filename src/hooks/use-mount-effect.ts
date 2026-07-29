import { useEffect, useRef } from "react";

/**
 * Escape hatch for true mount-only side effects.
 * ESLint bans bare `useEffect` / `React.useEffect` via no-restricted-syntax.
 * Prefer XState machines or TanStack Query for almost everything else.
 */
export function useMountEffect(effect: () => void | (() => void)): void {
  const ran = useRef(false);

  // eslint-disable-next-line no-restricted-syntax -- intentional mount-only escape hatch
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    return effect();
    // Mount-only: empty deps by design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
