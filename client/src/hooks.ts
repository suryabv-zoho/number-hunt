import { useEffect, useState } from 'react';

/**
 * Re-renders on an interval so live clocks tick without prop drilling.
 * Pass `enabled: false` when nothing is counting — an idle ticker re-renders a whole
 * subtree several times a second for no visible change, which is exactly the sort of
 * thing a weak device can't spare.
 */
export function useNow(intervalMs = 500, enabled = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, enabled]);
  return enabled ? now : Date.now();
}

/**
 * True once `at` has passed, using a single timer that fires exactly then — no polling.
 * For a one-shot deadline like a click lockout this replaces a ticker entirely.
 */
export function usePassed(at: number): boolean {
  const [, bump] = useState(0);
  useEffect(() => {
    const left = at - Date.now();
    if (left <= 0) return;
    const id = setTimeout(() => bump((n) => n + 1), left + 30);
    return () => clearTimeout(id);
  }, [at]);
  return Date.now() >= at;
}

export function formatClock(ms: number | null): string {
  if (ms === null || ms === undefined) return '--:--';
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
