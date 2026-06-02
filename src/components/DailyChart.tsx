"use client";

import { DailyBySolution } from "@/lib/types";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { useT } from "@/i18n/provider";

/**
 * Dependency-free, accessible SVG multi-line chart of tasks completed per day,
 * broken down by solution. One line per solution: for solution index s, the line
 * plots a point per day where y = counts[dayIndex][s]. X axis runs left-to-right
 * chronologically; Y axis is the number of completed/closed tasks. Every line uses
 * the solution's own color (or a deterministic fallback palette keyed by index when
 * the color is empty). All lines share one X/Y scale (min 0, common rounded max).
 * Reads straight from the live-refreshed dashboard payload (data.dailyBySolution),
 * so it updates in real time with no extra data source.
 *
 * No JS tooltip library: per-point context is exposed via a native SVG <title>. The
 * chart scales to its container (viewBox + width 100%), the legend sits below the
 * plotting area, and the line draw-in animation is disabled under
 * prefers-reduced-motion.
 */

// Deterministic fallback palette (Primer-ish hues) for solutions without a color.
// Cycled by index so the same solution keeps the same fallback color between renders.
const FALLBACK_PALETTE = [
  "#2f81f7",
  "#3fb950",
  "#db61a2",
  "#e3b341",
  "#a371f7",
  "#f0883e",
  "#39c5cf",
  "#f85149",
];

function colorFor(color: string, index: number): string {
  return color && color.trim() ? color : FALLBACK_PALETTE[index % FALLBACK_PALETTE.length];
}

// viewBox geometry (logical units; the SVG scales to the container width).
const VB_WIDTH = 720;
const VB_HEIGHT = 200;
const PAD_LEFT = 28; // room for the Y max label
const PAD_RIGHT = 8;
const PAD_TOP = 10;
const PAD_BOTTOM = 22; // room for the date label row
const PLOT_W = VB_WIDTH - PAD_LEFT - PAD_RIGHT;
const PLOT_H = VB_HEIGHT - PAD_TOP - PAD_BOTTOM;

/** 'YYYY-MM-DD' -> short 'MM-DD' axis label (avoid clutter on long ranges). */
function shortDay(day: string): string {
  return day.length >= 10 ? day.slice(5) : day;
}

export function DailyChart({ data }: { data: DailyBySolution }) {
  const t = useT();
  const reduced = useReducedMotion();

  const { days, solutions, counts } = data;
  const hasData =
    days.length > 0 && solutions.length > 0 && counts.some((row) => row.some((n) => n > 0));

  if (!hasData) {
    return (
      <div className="rounded-lg border border-edge bg-canvas-subtle px-4 py-10 text-center">
        <p className="text-sm text-fg-muted">{t("overview.dailyChartEmpty")}</p>
      </div>
    );
  }

  // The single busiest solution-day decides the shared Y scale; lines are not
  // stacked, so the axis max is the largest individual count (rounded up, >= 1).
  let maxCount = 1;
  for (const row of counts) {
    for (const n of row) {
      if (n > maxCount) maxCount = n;
    }
  }
  const yMax = maxCount;

  // Map a day index to its X center, and a count to its Y. With a single day the
  // point sits in the middle; otherwise points spread evenly across the plot.
  const xFor = (di: number) =>
    days.length === 1 ? PAD_LEFT + PLOT_W / 2 : PAD_LEFT + (di / (days.length - 1)) * PLOT_W;
  const yFor = (value: number) => PAD_TOP + PLOT_H - (value / yMax) * PLOT_H;

  // A light gridline halfway up the plot when the scale is tall enough to warrant it.
  const midValue = yMax >= 2 ? Math.round(yMax / 2) : null;

  // Only label a subset of days on the X axis so labels never overlap.
  const labelStep = Math.ceil(days.length / 12);

  // Lines drawn once per solution. Each carries its polyline points and markers.
  const lines = solutions.map((s, si) => {
    const stroke = colorFor(s.color, si);
    const points = days.map((day, di) => ({
      day,
      value: counts[di]?.[si] ?? 0,
      cx: xFor(di),
      cy: yFor(counts[di]?.[si] ?? 0),
    }));
    return { id: s.id, name: s.name, stroke, points };
  });

  return (
    <div className="rounded-lg border border-edge bg-canvas p-4 shadow-resting">
      <svg
        viewBox={`0 0 ${VB_WIDTH} ${VB_HEIGHT}`}
        preserveAspectRatio="none"
        width="100%"
        className="h-44 w-full"
        role="img"
        aria-label={`${t("overview.dailyChartTitle")}: ${solutions.length}, ${days.length}`}
      >
        {/* Optional mid gridline. */}
        {midValue !== null && (
          <>
            <line
              x1={PAD_LEFT}
              y1={yFor(midValue)}
              x2={PAD_LEFT + PLOT_W}
              y2={yFor(midValue)}
              className="stroke-edge-muted"
              strokeWidth={1}
              strokeDasharray="2 3"
            />
            <text
              x={PAD_LEFT - 4}
              y={yFor(midValue) + 3}
              textAnchor="end"
              className="fill-fg-subtle font-mono text-[9px] tabular-nums"
            >
              {midValue}
            </text>
          </>
        )}

        {/* Y baseline + max/zero labels. */}
        <line
          x1={PAD_LEFT}
          y1={PAD_TOP + PLOT_H}
          x2={PAD_LEFT + PLOT_W}
          y2={PAD_TOP + PLOT_H}
          className="stroke-edge"
          strokeWidth={1}
        />
        <text
          x={PAD_LEFT - 4}
          y={PAD_TOP + 8}
          textAnchor="end"
          className="fill-fg-subtle font-mono text-[9px] tabular-nums"
        >
          {yMax}
        </text>
        <text
          x={PAD_LEFT - 4}
          y={PAD_TOP + PLOT_H}
          textAnchor="end"
          className="fill-fg-subtle font-mono text-[9px] tabular-nums"
        >
          0
        </text>

        {/* X axis day labels (thinned to avoid overlap). */}
        {days.map((day, di) => {
          const showLabel = di % labelStep === 0 || di === days.length - 1;
          if (!showLabel) return null;
          return (
            <text
              key={day}
              x={xFor(di)}
              y={VB_HEIGHT - 8}
              textAnchor="middle"
              className="fill-fg-subtle font-mono text-[8px] tabular-nums"
            >
              {shortDay(day)}
            </text>
          );
        })}

        {/* One line per solution, sharing the X/Y scale, plus per-point markers. */}
        {lines.map((line) => (
          <g key={line.id}>
            <polyline
              points={line.points.map((p) => `${p.cx},${p.cy}`).join(" ")}
              fill="none"
              stroke={line.stroke}
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              className={reduced ? undefined : "fs-daily-line"}
            />
            {line.points.map((p) => (
              <circle key={p.day} cx={p.cx} cy={p.cy} r={2.2} fill={line.stroke}>
                <title>{`${line.name} - ${p.day}: ${t("overview.dailyChartUnit", { n: p.value })}`}</title>
              </circle>
            ))}
          </g>
        ))}
      </svg>

      {/* Legend below the plot: wrapping row of swatch + solution name. */}
      <ul className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {solutions.map((s, i) => (
          <li key={s.id} className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ backgroundColor: colorFor(s.color, i) }}
            />
            <span className="text-xs text-fg-muted">{s.name}</span>
          </li>
        ))}
      </ul>

      {/* Draw-in: sweep each line from start to end once. Skipped entirely under
          prefers-reduced-motion (the class is only attached when motion is allowed). */}
      <style>{`
        .fs-daily-line {
          stroke-dasharray: 1000;
          stroke-dashoffset: 1000;
          animation: fs-daily-draw 600ms cubic-bezier(0.22, 1, 0.36, 1) both;
        }
        @keyframes fs-daily-draw {
          to { stroke-dashoffset: 0; }
        }
      `}</style>
    </div>
  );
}
