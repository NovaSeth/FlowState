// Shared color helpers. Co-located here (not in format.ts, which is owned elsewhere)
// to give Pulse.tsx and use-flip.ts a single definition of the hex->rgba conversion.

// #rrggbb -> rgba(r,g,b,a). When the input is not a 6-digit hex value, falls back to
// the accent color (rgba(47,129,247,alpha)).
export function toRgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return `rgba(47,129,247,${alpha})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}
