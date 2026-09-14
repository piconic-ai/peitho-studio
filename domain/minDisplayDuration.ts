/** How long (ms) a "busy" display should keep showing once the real work
 * behind it has finished, so the total visible duration never drops below
 * `minDurationMs` — the standard "avoid a flash of loading state" floor
 * (a fast operation that resolves in a handful of milliseconds otherwise
 * reads as a dead click rather than as feedback; see
 * `todo/welcome-open-feels-frozen.md`). Clamped to `[0, minDurationMs]`:
 * never negative, and never more than the floor itself even if `now`
 * precedes `busyStartedAt` (e.g. a clock adjustment mid-flight). */
export function remainingMinDisplayMs(busyStartedAt: number, now: number, minDurationMs: number): number {
  const elapsed = Math.max(0, now - busyStartedAt)
  return Math.max(0, minDurationMs - elapsed)
}
