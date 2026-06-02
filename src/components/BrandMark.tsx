/**
 * Flow State wordmark glyph - pixel-faithful to the macOS menu-bar icon
 * (FlowIcon.swift): a 20x16 field with a 1.5-period sine "current" stroke and a
 * status dot at the bottom-right. The wave inherits the surrounding text color
 * (currentColor); the dot uses the success token (the menu-bar "running" green).
 *
 * `size` is the rendered height; width keeps the 20:16 (5:4) aspect so it lines
 * up 1:1 with the macOS mark.
 */
export function BrandMark({
  size = 18,
  className,
  dotColor = "var(--color-success)",
}: {
  size?: number;
  className?: string;
  /** Status dot color (defaults to the "running" green). Shell maps it to the
   *  live connection state: live=green, connecting=accent, down=red. */
  dotColor?: string;
}) {
  return (
    <svg
      height={size}
      width={(size * 20) / 16}
      viewBox="0 0 20 16"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M1.50 7.68 L1.89 6.80 L2.27 5.95 L2.66 5.19 L3.05 4.54 L3.43 4.03 L3.82 3.69 L4.20 3.53 L4.59 3.56 L4.98 3.78 L5.36 4.18 L5.75 4.74 L6.14 5.43 L6.52 6.23 L6.91 7.09 L7.30 7.98 L7.68 8.85 L8.07 9.67 L8.45 10.40 L8.84 11.01 L9.23 11.46 L9.61 11.74 L10.00 11.84 L10.39 11.74 L10.77 11.46 L11.16 11.01 L11.55 10.40 L11.93 9.67 L12.32 8.85 L12.70 7.98 L13.09 7.09 L13.48 6.23 L13.86 5.43 L14.25 4.74 L14.64 4.18 L15.02 3.78 L15.41 3.56 L15.80 3.53 L16.18 3.69 L16.57 4.03 L16.95 4.54 L17.34 5.19 L17.73 5.95 L18.11 6.80 L18.50 7.68"
        stroke="currentColor"
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx="17"
        cy="13"
        r="3"
        fill={dotColor}
        style={{ transition: "fill 0.3s ease" }}
      />
    </svg>
  );
}
