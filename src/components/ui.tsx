"use client";

import { ReactNode } from "react";
import { PRIORITY_META, STATUS_META, STATUS_ORDER } from "@/lib/labels";
import { Progress, StatusCounts, TaskPriority, TaskStatus } from "@/lib/types";
import { Icon } from "./icons";
import { AnimatedNumber } from "./AnimatedNumber";
import { useT } from "@/i18n/provider";

/* Presentational primitives. Always rendered inside the client tree (under Shell +
   LocaleProvider), so they can use useT() - the text is correct in SSR even without
   hydration, because the locale is seeded from a cookie on the server. */

/* Shared form-control class strings. Kept as exported constants (not components)
   so callers can compose them - e.g. append "resize-y" to a textarea - while the
   styling stays identical across every form. */
export const inputCls =
  "w-full rounded-md border border-edge bg-canvas-subtle px-2.5 py-1.5 text-sm text-fg outline-none transition-colors focus:border-accent";
export const btnPrimary =
  "rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50";
export const btnGhost =
  "rounded-md px-3 py-1.5 text-sm text-fg-muted transition-colors hover:bg-canvas-subtle";

/**
 * Status/outcome pill for the container metas (solution/project/milestone status,
 * milestone outcome). Renders the meta's pill color + its translated label.
 * `size` picks between the two pill scales in use: "xs" (text-[10px], the list
 * rows) and "sm" (text-[11px], the page headers).
 */
export function MetaPill({
  meta,
  size = "xs",
}: {
  meta: { labelKey: string; pill: string };
  size?: "xs" | "sm";
}) {
  const t = useT();
  const scale = size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-1.5 py-0.5 text-[10px]";
  return (
    <span className={`rounded-full ${scale} font-medium ${meta.pill}`}>
      {t(meta.labelKey)}
    </span>
  );
}

/**
 * Small neutral count badge (e.g. "12" next to a column title). The caller may
 * pass extra positioning classes (ml-auto, shrink-0) via className.
 */
export function CountPill({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`rounded-full bg-neutral-muted px-1.5 py-0.5 font-mono text-[10px] text-fg-muted ${className}`}
    >
      {children}
    </span>
  );
}

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-md border border-edge bg-canvas shadow-resting ${className}`}
    >
      {children}
    </div>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <div className="text-[11px] font-semibold uppercase tracking-[0.5px] text-fg-subtle">
      {children}
    </div>
  );
}

export function Dot({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${className}`}
    />
  );
}

export function StatusPill({ status }: { status: TaskStatus }) {
  const t = useT();
  const m = STATUS_META[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${m.pill}`}
    >
      <Dot className={m.dot} />
      {t(m.labelKey)}
    </span>
  );
}

export function PriorityBadge({
  priority,
  showNone = false,
}: {
  priority: TaskPriority;
  showNone?: boolean;
}) {
  const t = useT();
  if (priority === "none" && !showNone) return null;
  const m = PRIORITY_META[priority];
  return (
    <span className={`font-mono text-[11px] font-medium ${m.cls}`}>
      {t(m.labelKey)}
    </span>
  );
}

/**
 * Lightweight markers of a task's structure on the list/Kanban: open blockers,
 * subtask progress (done/total) and labels. Renders only when there is something
 * to show - otherwise returns null to avoid cluttering the rows.
 */
export function TaskMeta({
  labels = [],
  childCount = 0,
  childDoneCount = 0,
  openBlockerCount = 0,
}: {
  labels?: string[];
  childCount?: number;
  childDoneCount?: number;
  openBlockerCount?: number;
}) {
  const t = useT();
  if (childCount === 0 && openBlockerCount === 0 && labels.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-wrap items-center gap-1">
      {openBlockerCount > 0 && (
        <span
          className="inline-flex items-center gap-1 rounded-full bg-danger-muted px-1.5 py-0.5 text-[10px] font-medium text-danger"
          title={t("meta.blockedByCount", { n: openBlockerCount })}
        >
          <Icon name="block" size={11} />
          {openBlockerCount}
        </span>
      )}
      {childCount > 0 && (
        <span
          className="inline-flex items-center gap-1 rounded-full bg-neutral-muted px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-fg-muted"
          title={t("meta.subtasksProgress", { done: childDoneCount, total: childCount })}
        >
          <Icon name="check" size={11} />
          {childDoneCount}/{childCount}
        </span>
      )}
      {labels.map((l) => (
        <span
          key={l}
          className="rounded-full border border-edge bg-canvas-subtle px-1.5 py-0.5 text-[10px] text-fg-muted"
        >
          {l}
        </span>
      ))}
    </div>
  );
}

/** Stacked status distribution bar. Shows the structure of the work, not just %. */
export function StatusBar({
  counts,
  className = "",
}: {
  counts: StatusCounts;
  className?: string;
}) {
  const t = useT();
  const total =
    counts.todo + counts.in_progress + counts.blocked + counts.done;
  return (
    <div
      className={`flex h-2 w-full overflow-hidden rounded-full bg-neutral-muted ${className}`}
      title={STATUS_ORDER.map((s) => `${t(STATUS_META[s].labelKey)}: ${counts[s]}`).join(
        ", ",
      )}
    >
      {total > 0 &&
        // 'closed' is outside the progress denominator (as in progressFromCounts),
        // so we do NOT render its segment - otherwise the bar would exceed 100%.
        STATUS_ORDER.filter((s) => s !== "closed").map((s) =>
          counts[s] > 0 ? (
            <div
              key={s}
              className={STATUS_META[s].bar}
              style={{ width: `${(counts[s] / total) * 100}%` }}
            />
          ) : null,
        )}
    </div>
  );
}

/** Numeric percent + bar. */
export function ProgressMeter({
  progress,
  counts,
}: {
  progress: Progress;
  counts: StatusCounts;
}) {
  return (
    <div className="flex items-center gap-3">
      <StatusBar counts={counts} className="flex-1" />
      <AnimatedNumber
        value={progress.percent}
        suffix="%"
        className="w-12 shrink-0 text-right font-mono text-xs tabular-nums text-fg-muted"
      />
    </div>
  );
}

export function StatusLegend({ counts }: { counts: StatusCounts }) {
  const t = useT();
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {STATUS_ORDER.map((s) => (
        <div key={s} className="flex items-center gap-1.5">
          <Dot className={STATUS_META[s].dot} />
          <span className="text-xs text-fg-muted">{t(STATUS_META[s].labelKey)}</span>
          <span className="font-mono text-xs tabular-nums text-fg">
            {counts[s]}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Shared "task card" (button shell) for both boards - the Kanban in the Explorer
 * and the status board in ProjectView. The content (title, meta, priority) is
 * passed by the caller as children; the background via className. Unified
 * border/hover/active so both views look the same.
 */
export function TaskCard({
  active = false,
  onClick,
  className = "",
  cid,
  flipStatus,
  children,
}: {
  active?: boolean;
  onClick?: () => void;
  className?: string;
  /** Entity id (data-cid) - anchor for the "+1" animation in Celebrations. */
  cid?: string;
  /** Task status - drives the FLIP flash color (each status has its own color). */
  flipStatus?: string;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      data-cid={cid}
      data-flip-key={cid}
      data-flip-status={flipStatus}
      className={`flex w-full flex-col gap-2 rounded-md border px-3 py-2.5 text-left shadow-resting transition-all ${
        active
          ? "border-accent shadow-hover"
          : "border-edge hover:-translate-y-px hover:border-accent hover:shadow-hover"
      } ${className}`}
    >
      {children}
    </button>
  );
}

export function EmptyState({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-edge px-6 py-10 text-center">
      <p className="text-sm font-medium text-fg">{title}</p>
      {hint && <p className="max-w-sm text-xs text-fg-muted">{hint}</p>}
      {children}
    </div>
  );
}
