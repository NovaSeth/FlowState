"use client";

import { useEffect, useRef, useState } from "react";
import { DailyByStatus, TaskStatus } from "@/lib/types";
import { STATUS_META } from "@/lib/labels";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { useT } from "@/i18n/provider";

/**
 * Dependency-free, accessible SVG multi-line chart of task STATUS TRANSITIONS per
 * day. One line per status: for status index s, the line plots a point per day where
 * y = counts[dayIndex][s] = how many tasks entered that status that day (across all
 * solutions; a solution-scoped key sees only its own). X axis runs left-to-right
 * chronologically; Y axis is the number of transitions. Every line uses the status'
 * own semantic theme color (the same hues as the StatusPills, via CSS variables, so
 * it tracks light/dark mode). All lines share one X/Y scale (min 0, common max).
 * Reads straight from the live-refreshed dashboard payload (data.dailyByStatus), so
 * it updates in real time with no extra data source.
 *
 * No JS tooltip library: per-point context is exposed via a native SVG <title>. The
 * chart scales to its container (viewBox + width 100%), the legend sits below the
 * plotting area, and the line draw-in animation is disabled under
 * prefers-reduced-motion.
 */

// Each status' line/legend color, as a theme CSS variable (defined in globals.css),
// matching the StatusPill dot hues so the chart reads consistently across the UI.
const STATUS_LINE_COLOR: Record<TaskStatus, string> = {
  todo: "var(--fg-subtle)",
  in_progress: "var(--accent)",
  blocked: "var(--danger)",
  done: "var(--success)",
  closed: "var(--done)",
};

// viewBox geometry. The viewBox WIDTH tracks the real container width (via a
// ResizeObserver), so SVG units map 1:1 to pixels and text/markers render at
// their true size - a fixed viewBox with preserveAspectRatio="none" stretched
// the axis labels into an unreadable smear on wide windows.
const VB_WIDTH = 720; // initial width before the first measure
const VB_HEIGHT = 200;
const PAD_LEFT = 28; // room for the Y max label
const PAD_RIGHT = 8;
const PAD_TOP = 10;
const PAD_BOTTOM = 22; // room for the date label row
const PLOT_H = VB_HEIGHT - PAD_TOP - PAD_BOTTOM;

/** 'YYYY-MM-DD' -> short 'MM-DD' axis label (avoid clutter on long ranges). */
function shortDay(day: string): string {
  return day.length >= 10 ? day.slice(5) : day;
}

export function DailyChart({ data }: { data: DailyByStatus }) {
  const t = useT();
  const reduced = useReducedMotion();
  // Day under the cursor: drives the vertical guide + the per-status summary
  // tooltip (hovering anywhere in the plot snaps to the nearest day).
  const [hoverDi, setHoverDi] = useState<number | null>(null);

  // Real container width -> viewBox width (1:1 px), so text never distorts.
  const wrapRef = useRef<HTMLDivElement>(null);
  const [vbW, setVbW] = useState(VB_WIDTH);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setVbW(Math.max(320, Math.round(w)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const plotW = vbW - PAD_LEFT - PAD_RIGHT;

  const { days, statuses, counts } = data;
  const hasData =
    days.length > 0 && statuses.length > 0 && counts.some((row) => row.some((n) => n > 0));

  if (!hasData) {
    return (
      <div className="rounded-lg border border-edge bg-canvas-subtle px-4 py-10 text-center">
        <p className="text-sm text-fg-muted">{t("overview.dailyChartEmpty")}</p>
      </div>
    );
  }

  // The single busiest status-day decides the shared Y scale; lines are not
  // stacked, so the axis max is the largest individual count (clamped to >= 1).
  const yMax = Math.max(1, ...counts.flat());

  // Map a day index to its X center, and a count to its Y. With a single day the
  // point sits in the middle; otherwise points spread evenly across the plot.
  const xFor = (di: number) =>
    days.length === 1 ? PAD_LEFT + plotW / 2 : PAD_LEFT + (di / (days.length - 1)) * plotW;
  const yFor = (value: number) => PAD_TOP + PLOT_H - (value / yMax) * PLOT_H;

  // A light gridline halfway up the plot when the scale is tall enough to warrant it.
  const midValue = yMax >= 2 ? Math.round(yMax / 2) : null;

  // Only label a subset of days on the X axis so labels never overlap.
  const labelStep = Math.ceil(days.length / 12);

  // Lines drawn once per status. Each carries its polyline points and markers.
  const lines = statuses.map((status, si) => {
    const stroke = STATUS_LINE_COLOR[status];
    const name = t(STATUS_META[status].labelKey);
    const points = days.map((day, di) => {
      const value = counts[di]?.[si] ?? 0;
      return { day, value, cx: xFor(di), cy: yFor(value) };
    });
    return { id: status, name, stroke, points };
  });

  // Snap the cursor to the nearest day (viewBox units are real pixels now).
  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width === 0) return;
    const vbX = e.clientX - rect.left;
    const di =
      days.length === 1
        ? 0
        : Math.round(((vbX - PAD_LEFT) / plotW) * (days.length - 1));
    setHoverDi(Math.max(0, Math.min(days.length - 1, di)));
  }

  // Flip the tooltip to the other side of the guide near the right edge.
  const hoverFlip = hoverDi !== null && hoverDi > (days.length - 1) / 2;

  return (
    <div className="rounded-lg border border-edge bg-canvas p-4 shadow-resting">
      <div ref={wrapRef} className="relative">
      <svg
        viewBox={`0 0 ${vbW} ${VB_HEIGHT}`}
        width="100%"
        style={{ height: VB_HEIGHT }}
        role="img"
        aria-label={`${t("overview.dailyChartTitle")}: ${statuses.length}, ${days.length}`}
        onMouseMove={onMove}
        onMouseLeave={() => setHoverDi(null)}
      >
        {/* Hover guide: a solid, clearly visible line on the hovered day. */}
        {hoverDi !== null && (
          <line
            x1={xFor(hoverDi)}
            y1={PAD_TOP}
            x2={xFor(hoverDi)}
            y2={PAD_TOP + PLOT_H}
            className="stroke-fg-muted"
            strokeWidth={2}
          />
        )}
        {/* Optional mid gridline. */}
        {midValue !== null && (
          <>
            <line
              x1={PAD_LEFT}
              y1={yFor(midValue)}
              x2={PAD_LEFT + plotW}
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
          x2={PAD_LEFT + plotW}
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

        {/* One line per status, sharing the X/Y scale, plus per-point markers. */}
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

      {/* Day summary tooltip: date + every status' transition count that day. */}
      {hoverDi !== null && (
        <div
          className="pointer-events-none absolute top-4 z-10"
          style={{
            left: xFor(hoverDi),
            transform: hoverFlip ? "translateX(calc(-100% - 10px))" : "translateX(10px)",
          }}
        >
          <div className="min-w-[150px] rounded-md border border-edge bg-canvas px-2.5 py-2 shadow-hover">
            <div className="mb-1 font-mono text-[10px] text-fg-subtle">
              {days[hoverDi]}
            </div>
            {statuses.map((status, si) => (
              <div
                key={status}
                className="flex items-center gap-1.5 py-0.5 text-[11px]"
              >
                <span
                  aria-hidden="true"
                  className="inline-block h-2 w-2 shrink-0 rounded-sm"
                  style={{ backgroundColor: STATUS_LINE_COLOR[status] }}
                />
                <span className="text-fg-muted">
                  {t(STATUS_META[status].labelKey)}
                </span>
                <span className="ml-auto pl-3 font-mono tabular-nums text-fg">
                  {counts[hoverDi]?.[si] ?? 0}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      </div>

      {/* Legend below the plot: wrapping row of swatch + status label. */}
      <ul className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {statuses.map((status) => (
          <li key={status} className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ backgroundColor: STATUS_LINE_COLOR[status] }}
            />
            <span className="text-xs text-fg-muted">{t(STATUS_META[status].labelKey)}</span>
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
