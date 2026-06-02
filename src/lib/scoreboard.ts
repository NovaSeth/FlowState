/**
 * Helper types/functions for scoreboard gamification. The "TODAY" counts now come
 * AUTHORITATIVELY from the server (dashboard.completedToday) - see Scoreboard.tsx;
 * we no longer keep a tally in localStorage. What remains here is the pure id-set
 * diff logic (newIds), used by Celebrations to detect newly completed entities.
 */

export type ScoreKind = "task" | "milestone" | "project";

/** Returns ids present in `next` that were not in `prev` (newly completed). */
export function newIds(prev: ReadonlySet<string>, next: readonly string[]): string[] {
  return next.filter((id) => !prev.has(id));
}
