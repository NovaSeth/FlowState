"use client";

import Link from "next/link";
import {
  AttentionTask,
  DashboardSolution,
  TaskWithContext,
} from "@/lib/types";
import { timeAgoText } from "@/lib/format";
import { useT } from "@/i18n/provider";
import {
  Card,
  Eyebrow,
  PriorityBadge,
  ProgressMeter,
  StatusPill,
} from "./ui";
import { Icon } from "./icons";
import { AnimatedNumber } from "./AnimatedNumber";
import { Pulse } from "./Pulse";
import { usePersistentCollapse } from "./miller";
import { solutionColor } from "@/lib/solution-color";

export function StatTile({
  label,
  value,
  suffix = "",
  prev,
}: {
  label: string;
  value: number;
  suffix?: string;
  /** Yesterday's closing value: renders the day-over-day trend marker. */
  prev?: number;
}) {
  const trend =
    prev === undefined
      ? null
      : value > prev
        ? "up"
        : value < prev
          ? "down"
          : "flat";
  // Relative day-over-day change; hidden when prev is 0 (no meaningful %).
  // One decimal below 10% so small movements do not read as "0%".
  const deltaPct =
    prev === undefined || prev === 0 ? null : ((value - prev) / prev) * 100;
  const deltaLabel =
    deltaPct === null
      ? null
      : (() => {
          const a = Math.round(Math.abs(deltaPct) * 10) / 10;
          return a < 0.1 ? "<0.1" : a >= 10 ? String(Math.round(a)) : String(a);
        })();
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border border-edge bg-canvas-subtle px-4 py-3">
      <span className="flex items-baseline gap-1.5">
        <AnimatedNumber
          value={value}
          suffix={suffix}
          className="font-mono text-2xl font-semibold tabular-nums text-fg"
        />
        {/* Flat days show nothing - the marker only appears on a real change. */}
        {(trend === "up" || trend === "down") && (
          <span
            title={`${prev}${suffix} -> ${value}${suffix}`}
            className={`font-mono text-xs font-semibold ${
              trend === "up" ? "text-success" : "text-danger"
            }`}
          >
            {trend === "up" ? "▲" : "▼"}
            {deltaLabel !== null && (
              <span className="pl-0.5">{deltaLabel}%</span>
            )}
          </span>
        )}
      </span>
      <span className="text-xs text-fg-muted">{label}</span>
    </div>
  );
}

/** Task row with context (solution / project / milestone). Links to the project,
 *  with a ?task= param that opens the detail panel. */
function TaskRow({ task, note }: { task: TaskWithContext; note?: string }) {
  return (
    <Pulse signal={task.updatedAt} variant="plain">
      <Link
        href={`/projects/${task.context.projectId}?task=${task.id}`}
        className="flex items-start gap-3 rounded-md px-2 py-2 transition-colors hover:bg-canvas-subtle"
      >
        <span className="mt-0.5">
          <StatusPill status={task.status} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-sm text-fg">{task.title}</span>
            <PriorityBadge priority={task.priority} />
          </span>
          <span className="mt-0.5 flex items-center gap-1.5 truncate font-mono text-[11px] text-fg-subtle">
            {task.context.solutionName}
            <Icon name="chevron" size={11} />
            {task.context.projectName}
            <Icon name="chevron" size={11} />
            {task.context.milestoneTitle}
          </span>
          {note && (
            <span className="mt-1 flex items-start gap-1 rounded bg-danger-muted px-1.5 py-1 text-[11px] leading-snug text-danger">
              <Icon name="block" size={11} className="mt-0.5 shrink-0" />
              <span className="line-clamp-2">{note}</span>
            </span>
          )}
        </span>
      </Link>
    </Pulse>
  );
}

export function AttentionFeed({ tasks }: { tasks: AttentionTask[] }) {
  // `tr` (not `t`) so it does not collide with the `t` task loop variable below.
  const tr = useT();
  return (
    <Card className="flex max-h-[26rem] min-w-0 flex-col p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-danger">
          <Icon name="alert" size={16} />
        </span>
        <h2 className="text-sm font-semibold text-fg">{tr("overview.needsAttention")}</h2>
        <span className="font-mono text-xs text-fg-subtle">
          ({tasks.length})
        </span>
      </div>
      <p className="mb-1 text-xs text-fg-muted">
        {tr("overview.needsAttentionHint")}
      </p>
      <div className="-mx-2 mt-1 flex-1 overflow-y-auto">
        {tasks.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-fg-subtle">
            {tr("overview.nothingBlocking")}
          </p>
        ) : (
          tasks.map((t) => <TaskRow key={t.id} task={t} note={t.note} />)
        )}
      </div>
    </Card>
  );
}

export function RecentFeed({ tasks }: { tasks: TaskWithContext[] }) {
  // `tr` (not `t`) so it does not collide with the `t` task loop variable below.
  const tr = useT();
  return (
    <Card className="flex max-h-[26rem] min-w-0 flex-col p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-fg-subtle">
          <Icon name="clock" size={16} />
        </span>
        <h2 className="text-sm font-semibold text-fg">{tr("overview.recentActivity")}</h2>
      </div>
      <div className="-mx-2 mt-1 flex-1 overflow-y-auto">
        {tasks.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-fg-subtle">
            {tr("overview.noActivity")}
          </p>
        ) : (
          tasks.map((t) => (
            <div key={t.id} className="flex items-center gap-2">
              <span className="min-w-0 flex-1">
                <TaskRow task={t} />
              </span>
              <span className="shrink-0 font-mono text-[11px] text-fg-subtle">
                {timeAgoText(t.updatedAt, tr)}
              </span>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}

export function SolutionBlock({ solution }: { solution: DashboardSolution }) {
  // `tr` (not `t`) so it does not collide with the `t` task loop variable below.
  const tr = useT();
  // Per-solution disclosure, persisted so the next visit keeps it (like the
  // Miller column collapse - same localStorage store, namespaced id).
  const { collapsed, toggle } = usePersistentCollapse(
    `overview.sol.${solution.id}`,
  );
  return (
    <Card className="overflow-hidden">
      <div
        className={`flex flex-wrap items-center gap-x-4 gap-y-2 bg-canvas-subtle px-4 py-3 ${
          collapsed ? "" : "border-b border-edge-muted"
        }`}
      >
        <div className="flex min-w-0 items-center gap-2">
          <button
            onClick={toggle}
            aria-expanded={!collapsed}
            title={tr(collapsed ? "common.expand" : "common.collapse")}
            className="-ml-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-fg-subtle transition-colors hover:bg-neutral-muted hover:text-fg"
          >
            <Icon
              name="chevron"
              size={13}
              className={`transition-transform ${collapsed ? "" : "rotate-90"}`}
            />
          </button>
          <span
            className="shrink-0"
            style={{ color: solutionColor(solution.id) }}
          >
            <Icon name="solution" size={16} />
          </span>
          <Link
            href={`/solutions/${solution.id}`}
            className="truncate text-sm font-semibold text-fg hover:text-accent"
          >
            {solution.name}
          </Link>
          <span className="font-mono text-[11px] text-fg-subtle">
            {tr("units.projShort", { n: solution.projectCount })}
          </span>
        </div>
        <div className="ml-auto min-w-[180px] flex-1 sm:max-w-xs">
          <ProgressMeter
            progress={solution.progress}
            counts={solution.statusCounts}
          />
        </div>
      </div>
      {!collapsed && solution.recentTasks && solution.recentTasks.length > 0 && (
        <div className="px-3 py-2">
          <div className="mb-1 flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-[0.5px] text-fg-subtle">
            <Icon name="clock" size={12} />
            {tr("overview.recent")}
          </div>
          <div className="-mx-1 flex flex-col">
            {solution.recentTasks.map((t) => (
              <Link
                key={t.id}
                href={`/projects/${t.context.projectId}?task=${t.id}`}
                className="flex items-center gap-2 rounded-md px-2 py-1 transition-colors hover:bg-canvas-subtle"
              >
                <StatusPill status={t.status} />
                <span className="min-w-0 flex-1 truncate text-[13px] text-fg">
                  {t.title}
                </span>
                <span className="shrink-0 font-mono text-[10px] text-fg-subtle">
                  {timeAgoText(t.updatedAt, tr)}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

export { Eyebrow };
