/* Deterministic per-solution accent color. The manual color picker was removed
 * (every solution ended up the same default blue), so the icon hue is derived
 * from the solution id instead: same id -> same color, different solutions
 * spread across a small distinct palette. The native macOS app implements the
 * exact same hash + palette (DS.solutionColor) - keep them in lockstep. */

const PALETTE = [
  "#3b82f6", // blue
  "#22c55e", // green
  "#f59e0b", // amber
  "#a855f7", // purple
  "#ef4444", // red
  "#14b8a6", // teal
  "#ec4899", // pink
  "#84cc16", // lime
];

export function solutionColor(id: string): string {
  let sum = 0;
  for (const ch of id) sum += ch.codePointAt(0) ?? 0;
  return PALETTE[sum % PALETTE.length];
}
