import {
  BlockerType,
  MilestoneOutcome,
  MilestoneStatus,
  ProjectStatus,
  SolutionStatus,
  TaskPriority,
  TaskStatus,
} from "./types";

/* Tailwind classes (literal, so v4 picks them up during scanning) + i18n label KEYS.
   Human-readable labels are NOT stored here as text - they are resolved at render
   time via t(labelKey), so the UI works multilingually (en by default, pl translation). */

export const STATUS_META: Record<
  TaskStatus,
  { labelKey: string; pill: string; dot: string; bar: string }
> = {
  todo: {
    labelKey: "status.todo",
    pill: "bg-neutral-muted text-fg-muted",
    dot: "bg-fg-subtle",
    bar: "bg-fg-subtle",
  },
  in_progress: {
    labelKey: "status.in_progress",
    pill: "bg-accent-muted text-accent",
    dot: "bg-accent",
    bar: "bg-accent",
  },
  blocked: {
    labelKey: "status.blocked",
    pill: "bg-danger-muted text-danger",
    dot: "bg-danger",
    bar: "bg-danger",
  },
  done: {
    labelKey: "status.done",
    pill: "bg-success-muted text-success",
    dot: "bg-success",
    bar: "bg-success",
  },
  closed: {
    labelKey: "status.closed",
    pill: "bg-done-muted text-done",
    dot: "bg-done",
    bar: "bg-done",
  },
};

export const PRIORITY_META: Record<
  TaskPriority,
  { labelKey: string; cls: string }
> = {
  none: { labelKey: "priority.none", cls: "text-fg-subtle" },
  low: { labelKey: "priority.low", cls: "text-fg-muted" },
  medium: { labelKey: "priority.medium", cls: "text-accent" },
  high: { labelKey: "priority.high", cls: "text-attention" },
  urgent: { labelKey: "priority.urgent", cls: "text-danger" },
};

export const PROJECT_STATUS_META: Record<
  ProjectStatus,
  { labelKey: string; pill: string }
> = {
  active: { labelKey: "projectStatus.active", pill: "bg-accent-muted text-accent" },
  paused: { labelKey: "projectStatus.paused", pill: "bg-attention-muted text-attention" },
  done: { labelKey: "projectStatus.done", pill: "bg-success-muted text-success" },
  archived: { labelKey: "projectStatus.archived", pill: "bg-neutral-muted text-fg-muted" },
};

/** A milestone has the same lifecycle (and labels) as a project. */
export const MILESTONE_STATUS_META: Record<
  MilestoneStatus,
  { labelKey: string; pill: string }
> = PROJECT_STATUS_META;

export const SOLUTION_STATUS_META: Record<
  SolutionStatus,
  { labelKey: string; pill: string }
> = {
  active: { labelKey: "solutionStatus.active", pill: "bg-accent-muted text-accent" },
  archived: { labelKey: "solutionStatus.archived", pill: "bg-neutral-muted text-fg-muted" },
};

export const STATUS_ORDER: TaskStatus[] = [
  "todo",
  "in_progress",
  "blocked",
  "done",
  "closed",
];

/** i18n keys for the blocker type (meaningful when status=blocked). */
export const BLOCKER_TYPE_LABEL: Record<BlockerType, string> = {
  dependency: "blockerType.dependency",
  external: "blockerType.external",
  decision: "blockerType.decision",
};

/** i18n keys + pill classes for a milestone's deliverable outcome. */
export const MILESTONE_OUTCOME_META: Record<
  MilestoneOutcome,
  { labelKey: string; pill: string }
> = {
  shipped: { labelKey: "milestoneOutcome.shipped", pill: "bg-success-muted text-success" },
  infeasible: { labelKey: "milestoneOutcome.infeasible", pill: "bg-danger-muted text-danger" },
  descoped: { labelKey: "milestoneOutcome.descoped", pill: "bg-neutral-muted text-fg-muted" },
};
