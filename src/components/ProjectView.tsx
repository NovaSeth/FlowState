"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  MilestoneRollup,
  ProjectRollup,
  Solution,
  Task,
  TaskStatus,
} from "@/lib/types";
import {
  MILESTONE_OUTCOME_META,
  MILESTONE_STATUS_META,
  PROJECT_STATUS_META,
  STATUS_META,
  STATUS_ORDER,
} from "@/lib/labels";
import { api } from "@/lib/api";
import {
  Card,
  CountPill,
  Dot,
  Eyebrow,
  MetaPill,
  PriorityBadge,
  ProgressMeter,
  StatusPill,
  TaskCard,
} from "./ui";
import { Icon } from "./icons";
import { NewMilestoneForm, NewTaskForm } from "./forms";
import { DeleteButton } from "./DeleteButton";
import { TaskPanel } from "./TaskPanel";
import { ColHint, Column, Placeholder, withArchivedDivider } from "./miller";
import { useT } from "@/i18n/provider";

// Two ways to look at a single project: the "dashboard" (milestone cards + a
// status board) and "columns" - the Explorer's Miller cascade scoped to this
// project (Milestones -> Tasks -> detail), reusing the same column primitives.
type ProjectViewMode = "dashboard" | "columns";

export function ProjectView({
  project,
  solution,
  milestones,
  tasks,
  initialTaskId,
}: {
  project: ProjectRollup;
  solution: Solution | null;
  milestones: MilestoneRollup[];
  tasks: Task[];
  initialTaskId?: string;
}) {
  const t = useT();
  const [selectedId, setSelectedId] = useState<string | null>(
    initialTaskId ?? null,
  );
  const [filter, setFilter] = useState<string>("all");
  const [view, setView] = useState<ProjectViewMode>("dashboard");
  // Columns view: the selected milestone whose tasks fill the tasks pane.
  const [colMsId, setColMsId] = useState<string | null>(null);

  const selectedTask = tasks.find((t) => t.id === selectedId) ?? null;
  const selectedMilestoneTitle = milestones.find(
    (m) => m.id === selectedTask?.milestoneId,
  )?.title;

  const visibleTasks =
    filter === "all" ? tasks : tasks.filter((t) => t.milestoneId === filter);
  const milestoneOptions = milestones.map((m) => ({ id: m.id, title: m.title }));

  // Columns view falls back to the first (non-archived) milestone so the tasks
  // pane is populated without an extra click.
  const activeMsId =
    colMsId ??
    milestones.find((m) => m.status !== "archived")?.id ??
    milestones[0]?.id ??
    null;
  const activeMsTasks = useMemo(
    () =>
      [...tasks.filter((t) => t.milestoneId === activeMsId)].sort(
        (a, b) =>
          STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status),
      ),
    [tasks, activeMsId],
  );

  // breadcrumb + header, shared by both layouts (carries the view toggle).
  const header = (
    <div>
      <nav className="flex items-center gap-1.5 font-mono text-[11px] text-fg-subtle">
        <Link href="/" className="hover:text-accent">
          {t("nav.overview")}
        </Link>
        <Icon name="chevron" size={11} />
        {solution && (
          <>
            <Link
              href={`/solutions/${solution.id}`}
              className="hover:text-accent"
            >
              {solution.name}
            </Link>
            <Icon name="chevron" size={11} />
          </>
        )}
        <span className="text-fg-muted">{project.name}</span>
      </nav>
      <div className="mt-1.5 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold tracking-tight text-fg">
          {project.name}
        </h1>
        <MetaPill meta={PROJECT_STATUS_META[project.status]} size="sm" />
        <span className="font-mono text-xs text-fg-subtle">
          {project.progress.done}/{project.progress.total}{" "}
          {t("project.tasks").toLowerCase()} - {project.progress.percent}%
        </span>
        <span className="ml-auto">
          <ViewToggle view={view} onChange={setView} />
        </span>
      </div>
      {project.description && (
        <p className="mt-1 max-w-2xl text-sm text-fg-muted">
          {project.description}
        </p>
      )}
    </div>
  );

  const taskPanel = (
    <TaskPanel
      task={selectedTask}
      milestoneTitle={selectedMilestoneTitle}
      onClose={() => setSelectedId(null)}
    />
  );

  // --- columns view: Miller cascade (Milestones -> Tasks) scoped to the project ---
  if (view === "columns") {
    return (
      <>
        <div className="flex h-full min-h-0 flex-col">
          <div className="shrink-0 border-b border-edge px-6 py-4">{header}</div>
          <div className="flex min-h-0 flex-1 overflow-x-auto">
            <Column
              title={t("explorer.milestones")}
              count={milestones.length}
              collapseId="proj.milestones"
            >
              <div className="flex h-full min-h-0 flex-col">
                <div className="min-h-0 flex-1 overflow-y-auto pb-2">
                  {milestones.length === 0 ? (
                    <ColHint text={t("explorer.noMilestones")} />
                  ) : (
                    withArchivedDivider(
                      milestones,
                      (m) => m.status === "archived",
                      (m) => (
                        <ColumnMilestoneRow
                          key={m.id}
                          m={m}
                          active={m.id === activeMsId}
                          onSelect={() => setColMsId(m.id)}
                        />
                      ),
                    )
                  )}
                </div>
                {/* No onDone -> useCreate router.refresh() reloads the server
                    data; the client selection state survives the refresh. */}
                <div className="shrink-0 border-t border-edge bg-canvas p-2">
                  <NewMilestoneForm projectId={project.id} />
                </div>
              </div>
            </Column>

            {activeMsId ? (
              <div className="flex min-w-[360px] flex-1 flex-col border-r border-edge bg-canvas">
                <div className="flex shrink-0 items-center gap-2 border-b border-edge-muted px-3 py-2.5">
                  <Eyebrow>{t("explorer.tasks")}</Eyebrow>
                  <CountPill>{activeMsTasks.length}</CountPill>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto p-3">
                  {activeMsTasks.length === 0 ? (
                    <ColHint text={t("explorer.noTasks")} />
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      {activeMsTasks.map((task) => (
                        <ColumnTaskRow
                          key={task.id}
                          task={task}
                          active={selectedId === task.id}
                          onSelect={() => setSelectedId(task.id)}
                        />
                      ))}
                    </div>
                  )}
                </div>
                <div className="shrink-0 border-t border-edge bg-canvas p-2">
                  <NewTaskForm
                    milestones={milestoneOptions}
                    defaultMilestoneId={activeMsId}
                  />
                </div>
              </div>
            ) : (
              <Placeholder hint={t("explorer.pickMilestone")} />
            )}
          </div>
        </div>
        {taskPanel}
      </>
    );
  }

  // --- dashboard view (default): milestone cards + status board ---
  return (
    <>
      <div className="mx-auto max-w-6xl space-y-6 px-6 py-6">
        {header}

        {/* milestones */}
        <section className="space-y-3">
          <Eyebrow>{t("project.milestones")}</Eyebrow>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {milestones.map((m) => (
              <Card key={m.id} className="group p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <Icon name="milestone" size={15} />
                    <span className="truncate text-sm font-medium text-fg">
                      {m.title}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {m.outcome && (
                      <MetaPill meta={MILESTONE_OUTCOME_META[m.outcome]} />
                    )}
                    <span className="font-mono text-[11px] text-fg-subtle">
                      {m.progress.done}/{m.progress.total}
                    </span>
                  </div>
                </div>
                <div className="mt-3">
                  <ProgressMeter progress={m.progress} counts={m.statusCounts} />
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <button
                    onClick={() => setFilter(m.id)}
                    className="text-[11px] text-fg-subtle transition-colors hover:text-accent"
                  >
                    {t("project.showTasks")}
                  </button>
                  <span className="opacity-0 transition-opacity group-hover:opacity-100">
                    <DeleteButton
                      label=""
                      onDelete={() => api.deleteMilestone(m.id)}
                    />
                  </span>
                </div>
              </Card>
            ))}
          </div>
        </section>

        {/* task board */}
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <FilterChip
                active={filter === "all"}
                onClick={() => setFilter("all")}
              >
                {t("project.all")} ({tasks.length})
              </FilterChip>
              {milestones.map((m) => (
                <FilterChip
                  key={m.id}
                  active={filter === m.id}
                  onClick={() => setFilter(m.id)}
                >
                  {/* Count = number of tasks actually rendered on the board
                      (all statuses, including closed), consistent with 'All'.
                      The milestone progress bar separately excludes closed. */}
                  {m.title} ({tasks.filter((t) => t.milestoneId === m.id).length})
                </FilterChip>
              ))}
            </div>
            <NewTaskForm
              milestones={milestoneOptions}
              defaultMilestoneId={filter !== "all" ? filter : undefined}
            />
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {STATUS_ORDER.map((status) => (
              <BoardColumn
                key={status}
                status={status}
                tasks={visibleTasks.filter((t) => t.status === status)}
                showMilestone={filter === "all"}
                milestones={milestones}
                onSelect={setSelectedId}
              />
            ))}
          </div>
        </section>
      </div>
      {taskPanel}
    </>
  );
}

/** Segmented Dashboard | Columns toggle (lives in the project header). */
function ViewToggle({
  view,
  onChange,
}: {
  view: ProjectViewMode;
  onChange: (v: ProjectViewMode) => void;
}) {
  const t = useT();
  const btn = (v: ProjectViewMode, label: string) => (
    <button
      key={v}
      onClick={() => onChange(v)}
      aria-pressed={view === v}
      className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
        view === v
          ? "bg-canvas text-fg shadow-resting"
          : "text-fg-muted hover:text-fg"
      }`}
    >
      {label}
    </button>
  );
  return (
    <div className="inline-flex items-center gap-0.5 rounded-lg border border-edge bg-canvas-subtle p-0.5">
      {btn("dashboard", t("project.viewDashboard"))}
      {btn("columns", t("project.viewColumns"))}
    </div>
  );
}

/** Milestone row in the columns view (selectable; archived rows are dimmed). */
function ColumnMilestoneRow({
  m,
  active,
  onSelect,
}: {
  m: MilestoneRollup;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={`flex w-full flex-col gap-1.5 px-3 py-2.5 text-left transition ${
        active ? "bg-accent-muted" : "hover:bg-canvas-subtle"
      } ${m.status === "archived" ? "opacity-50 hover:opacity-100" : ""}`}
    >
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm text-fg">
          {m.title}
        </span>
        <MetaPill meta={MILESTONE_STATUS_META[m.status]} size="sm" />
      </div>
      <ProgressMeter progress={m.progress} counts={m.statusCounts} />
    </button>
  );
}

/** Task row in the columns view tasks pane (mirrors the Explorer list row). */
function ColumnTaskRow({
  task,
  active,
  onSelect,
}: {
  task: Task;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={`flex flex-col gap-1.5 rounded-md border px-3 py-2 text-left transition-all ${
        active
          ? "border-accent bg-canvas shadow-hover"
          : "border-edge bg-canvas hover:border-accent hover:shadow-hover"
      }`}
    >
      <div className="flex items-center gap-2.5">
        <StatusPill status={task.status} />
        <span className="min-w-0 flex-1 truncate text-sm text-fg">
          {task.title}
        </span>
        <PriorityBadge priority={task.priority} />
      </div>
    </button>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-2.5 py-1 text-xs transition-colors ${
        active
          ? "bg-accent-muted text-accent"
          : "text-fg-muted hover:bg-canvas-subtle"
      }`}
    >
      {children}
    </button>
  );
}

function BoardColumn({
  status,
  tasks,
  showMilestone,
  milestones,
  onSelect,
}: {
  status: TaskStatus;
  tasks: Task[];
  showMilestone: boolean;
  milestones: MilestoneRollup[];
  onSelect: (id: string) => void;
}) {
  const t = useT();
  const m = STATUS_META[status];
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 px-1">
        <Dot className={m.dot} />
        <span className="text-xs font-semibold text-fg">{t(m.labelKey)}</span>
        <span className="font-mono text-[11px] text-fg-subtle">
          {tasks.length}
        </span>
      </div>
      <div className="flex min-h-[60px] flex-col gap-2 rounded-md bg-canvas-inset/60 p-2">
        {tasks.length === 0 ? (
          <p className="px-1 py-3 text-center text-[11px] text-fg-subtle">-</p>
        ) : (
          tasks.map((t) => {
            const ms = milestones.find((x) => x.id === t.milestoneId);
            return (
              <TaskCard
                key={t.id}
                onClick={() => onSelect(t.id)}
                className="bg-canvas"
              >
                <span className="text-sm leading-snug text-fg">{t.title}</span>
                <span className="flex items-center justify-between gap-2">
                  {showMilestone && ms ? (
                    <span className="truncate font-mono text-[10px] text-fg-subtle">
                      {ms.title}
                    </span>
                  ) : (
                    <span />
                  )}
                  <PriorityBadge priority={t.priority} />
                </span>
              </TaskCard>
            );
          })
        )}
      </div>
    </div>
  );
}
