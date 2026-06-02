"use client";

import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  MilestoneRollup,
  ProjectRollup,
  SolutionRollup,
  StatusCounts,
  TaskListItem,
  TaskPriority,
  TaskStatus,
} from "@/lib/types";
import { api } from "@/lib/api";
import {
  MILESTONE_STATUS_META,
  PROJECT_STATUS_META,
  SOLUTION_STATUS_META,
  STATUS_META,
  STATUS_ORDER,
} from "@/lib/labels";
import {
  CountPill,
  Dot,
  MetaPill,
  PriorityBadge,
  StatusBar,
  StatusPill,
  TaskCard,
  TaskMeta,
} from "./ui";
import { DeleteButton } from "./DeleteButton";
import { TaskPanel } from "./TaskPanel";
import { Pulse } from "./Pulse";
import { AnimatedNumber } from "./AnimatedNumber";
import { Icon } from "./icons";
import { useIsNarrow } from "@/lib/use-is-narrow";
import { useLiveRefresh } from "@/lib/use-live-refresh";
import { useFlip } from "@/lib/use-flip";
import { useT } from "@/i18n/provider";
import {
  ColHint,
  ColLoading,
  Column,
  DrillHeader,
  Placeholder,
  useDrillNavigation,
  withArchivedDivider,
} from "./miller";

type TaskView = "list" | "kanban";

/* List order: status first (in_progress -> blocked -> todo -> done),
   then priority within a status from highest (urgent) to lowest (none). */
const STATUS_RANK: Record<TaskStatus, number> = {
  in_progress: 0,
  blocked: 1,
  todo: 2,
  done: 3,
  closed: 4,
};
const PRIORITY_RANK: Record<TaskPriority, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
  none: 4,
};
const byPriority = (a: TaskListItem, b: TaskListItem) =>
  PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
const byStatusThenPriority = (a: TaskListItem, b: TaskListItem) =>
  STATUS_RANK[a.status] - STATUS_RANK[b.status] || byPriority(a, b);

/**
 * Cascading explorer (Miller columns): Solutions -> Projects -> Milestones ->
 * Tasks -> detail panel. Each level is fetched on demand via the REST API.
 *
 * Wide screen: all levels side by side, the board scrolls horizontally.
 * Narrow screen (phone): one level at full width plus a Back button and a
 * breadcrumb (drill-down like iOS Settings) - 288px columns do not fit side by
 * side on ~390px, so deeper levels would render off-screen.
 */
export function Explorer({
  initialSolutions,
}: {
  initialSolutions: SolutionRollup[];
}) {
  const t = useT();
  const [solutions, setSolutions] = useState(initialSolutions);
  const [projects, setProjects] = useState<ProjectRollup[]>([]);
  const [milestones, setMilestones] = useState<MilestoneRollup[]>([]);
  const [tasks, setTasks] = useState<TaskListItem[]>([]);

  const [solId, setSolId] = useState<string | null>(null);
  const [projId, setProjId] = useState<string | null>(null);
  const [msId, setMsId] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);

  const [taskView, setTaskView] = useState<TaskView>("list");
  const [showClosed, setShowClosed] = useState(false);
  // closed = out of scope: hidden by default from the list and Kanban (it drops
  // out of the progress % anyway). The "Closed" toggle brings it back into view.
  const visibleTasks = showClosed
    ? tasks
    : tasks.filter((t) => t.status !== "closed");
  const closedCount = tasks.length - visibleTasks.length;

  // FLIP for the task list: animate the resort when status/priority/composition changes.
  const listRef = useRef<HTMLDivElement>(null);
  const taskSignal = visibleTasks
    .map((t) => `${t.id}:${t.status}:${t.priority}`)
    .join("|");
  useFlip(listRef, taskSignal, "slide", msId ?? "");

  // Sort the list view once per real change (composition / status / priority),
  // not on every render or SSE tick - taskSignal captures exactly those keys.
  const sortedVisibleTasks = useMemo(
    () => [...visibleTasks].sort(byStatusThenPriority),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [taskSignal],
  );

  // Per-column loading - to distinguish "fetching" from "loaded and empty"
  // (otherwise a false "None ... Create via API" would flash).
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [loadingMilestones, setLoadingMilestones] = useState(false);
  const [loadingTasks, setLoadingTasks] = useState(false);

  const narrow = useIsNarrow();

  const loadSolutions = async () => setSolutions(await api.listSolutions());
  const loadProjects = async (sid: string) => {
    setLoadingProjects(true);
    try {
      setProjects(await api.listProjects(sid));
    } finally {
      setLoadingProjects(false);
    }
  };
  const loadMilestones = async (pid: string) => {
    setLoadingMilestones(true);
    try {
      setMilestones(await api.listMilestones(pid));
    } finally {
      setLoadingMilestones(false);
    }
  };
  const loadTasks = async (mid: string) => {
    setLoadingTasks(true);
    try {
      setTasks(await api.listTasks(mid));
    } finally {
      setLoadingTasks(false);
    }
  };

  async function selectSolution(id: string) {
    pushNav();
    setSolId(id);
    setProjId(null);
    setMsId(null);
    setTaskId(null);
    setMilestones([]);
    setTasks([]);
    await loadProjects(id);
  }
  async function selectProject(id: string) {
    pushNav();
    setProjId(id);
    setMsId(null);
    setTaskId(null);
    setTasks([]);
    await loadMilestones(id);
  }
  async function selectMilestone(id: string) {
    pushNav();
    setMsId(id);
    setTaskId(null);
    await loadTasks(id);
  }
  function openTask(id: string) {
    pushNav();
    setTaskId(id);
  }

  // Step back one level: first closes the task, then milestone -> project
  // -> solution. Reads the current selection from a ref (popstate has no fresh state).
  function stepBack() {
    const s = sel.current;
    if (s.taskId) {
      setTaskId(null);
    } else if (s.msId) {
      setMsId(null);
      setTaskId(null);
      setTasks([]);
    } else if (s.projId) {
      setProjId(null);
      setMilestones([]);
    } else if (s.solId) {
      setSolId(null);
      setProjects([]);
    }
  }

  // Closing the task panel: go through history on mobile (consistent with
  // swipe-back), directly on desktop. (The level Back button uses goBack below.)
  function closeTask() {
    if (narrow) window.history.back();
    else setTaskId(null);
  }

  // Live: when anyone (a Claude Code agent or the UI) changes data via the API,
  // the server sends SSE and we refetch the fresh state of the visible columns.
  const sel = useRef({ solId, projId, msId, taskId });
  useEffect(() => {
    sel.current = { solId, projId, msId, taskId };
  }, [solId, projId, msId, taskId]);

  // Mobile drill-down: pushNav before drilling in, goBack for the Back button,
  // and a popstate listener so the swipe-back gesture steps back one level.
  const { pushNav, goBack } = useDrillNavigation({ narrow, stepBack });

  // Live: when anyone (an agent or the UI) changes data, SSE triggers a refetch
  // of the visible columns (shared hook - the same mechanism as Overview).
  useLiveRefresh(() => {
    const s = sel.current;
    api.listSolutions().then(setSolutions);
    if (s.solId) api.listProjects(s.solId).then(setProjects);
    if (s.projId) api.listMilestones(s.projId).then(setMilestones);
    if (s.msId) api.listTasks(s.msId).then(setTasks);
  });

  const selectedTask = tasks.find((t) => t.id === taskId) ?? null;
  const selectedMsTitle = milestones.find((m) => m.id === msId)?.title;
  const selectedSolName = solutions.find((s) => s.id === solId)?.name;
  const selectedProjName = projects.find((p) => p.id === projId)?.name;

  // --- content of each level (shared between the desktop board and the mobile drill) ---

  const solutionsCol =
    solutions.length === 0 ? (
      <ColHint text={t("explorer.noSolutions")} />
    ) : (
      withArchivedDivider(
        solutions,
        (s) => s.status === "archived",
        (s) => (
        <DrillRow
          key={s.id}
          narrow={narrow}
          dimmed={s.status === "archived"}
          active={s.id === solId}
          cid={s.id}
          onSelect={() => selectSolution(s.id)}
          title={s.name}
          counts={s.statusCounts}
          percent={s.progress.percent}
          sub={
            <span className="flex items-center gap-1.5">
              {t("units.projShort", { n: s.projectCount })}
              {s.status === "archived" && <MetaPill meta={SOLUTION_STATUS_META.archived} />}
            </span>
          }
          onDelete={() => api.deleteSolution(s.id)}
          onDeleted={() => {
            if (solId === s.id) {
              setSolId(null);
              setProjId(null);
              setMsId(null);
              setProjects([]);
            }
            loadSolutions();
          }}
        />
      ))
    );

  const projectsCol = loadingProjects ? (
    <ColLoading />
  ) : projects.length === 0 ? (
    <ColHint text={t("explorer.noProjects")} />
  ) : (
      withArchivedDivider(
        projects,
        (p) => p.status === "archived",
        (p) => (
        <DrillRow
          key={p.id}
          narrow={narrow}
          dimmed={p.status === "archived"}
          active={p.id === projId}
          cid={p.id}
          onSelect={() => selectProject(p.id)}
          title={p.name}
          counts={p.statusCounts}
          percent={p.progress.percent}
          sub={
            <span className="flex items-center gap-1.5">
              <span className="font-mono tabular-nums">
                {t("units.milestoneShort", { n: p.milestoneCount })}
              </span>
              <MetaPill meta={PROJECT_STATUS_META[p.status]} />
            </span>
          }
          onDelete={() => api.deleteProject(p.id)}
          onDeleted={() => {
            if (projId === p.id) {
              setProjId(null);
              setMsId(null);
              setMilestones([]);
              setTasks([]);
            }
            if (solId) loadProjects(solId);
          }}
        />
      ))
    );

  const milestonesCol = loadingMilestones ? (
    <ColLoading />
  ) : milestones.length === 0 ? (
    <ColHint text={t("explorer.noMilestones")} />
  ) : (
      withArchivedDivider(
        milestones,
        (m) => m.status === "archived",
        (m) => (
        <DrillRow
          key={m.id}
          narrow={narrow}
          dimmed={m.status === "archived"}
          active={m.id === msId}
          cid={m.id}
          onSelect={() => selectMilestone(m.id)}
          title={m.title}
          counts={m.statusCounts}
          percent={m.progress.percent}
          sub={
            <span className="flex items-center gap-1.5">
              <span className="font-mono tabular-nums">
                {t("units.taskShort", { n: m.progress.total })}
              </span>
              {m.statusCounts.blocked > 0 && <BlockedBadge n={m.statusCounts.blocked} />}
              <MetaPill meta={MILESTONE_STATUS_META[m.status]} />
            </span>
          }
          onDelete={() => api.deleteMilestone(m.id)}
          onDeleted={() => {
            if (msId === m.id) {
              setMsId(null);
              setTasks([]);
            }
            if (projId) loadMilestones(projId);
          }}
        />
      ))
    );

  const tasksPaneInner = (
    <>
      <ViewTabs
        value={taskView}
        onChange={setTaskView}
        count={visibleTasks.length}
        showClosed={showClosed}
        onToggleClosed={() => setShowClosed((v) => !v)}
        closedCount={closedCount}
      />
      {taskView === "list" ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {loadingTasks ? (
            <ColLoading />
          ) : visibleTasks.length === 0 ? (
            <ColHint text={t("explorer.noTasks")} />
          ) : (
            <div ref={listRef} className="flex flex-col gap-1.5">
              {sortedVisibleTasks.map((t) => (
                <button
                  key={t.id}
                  data-cid={t.id}
                  data-flip-key={t.id}
                  data-flip-status={t.status}
                  onClick={() => openTask(t.id)}
                  className={`flex flex-col gap-1.5 rounded-md border px-3 py-2 text-left transition-all ${
                    taskId === t.id
                      ? "border-accent bg-canvas shadow-hover"
                      : "border-edge bg-canvas hover:border-accent hover:shadow-hover"
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <StatusPill status={t.status} />
                    <span className="min-w-0 flex-1 truncate text-sm text-fg">
                      {t.title}
                    </span>
                    <PriorityBadge priority={t.priority} />
                  </div>
                  <TaskMeta
                    labels={t.labels}
                    childCount={t.childCount}
                    childDoneCount={t.childDoneCount}
                    openBlockerCount={t.openBlockerCount}
                  />
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <KanbanBoard
          tasks={visibleTasks}
          activeId={taskId}
          onSelect={openTask}
          resetKey={msId ?? ""}
        />
      )}
    </>
  );

  const taskPanel = (
    <TaskPanel
      task={selectedTask}
      milestoneTitle={selectedMsTitle}
      onClose={closeTask}
      onChanged={() => {
        if (msId) loadTasks(msId);
      }}
    />
  );

  // --- mobile view: one level at full width ---
  if (narrow) {
    const level = msId ? 3 : projId ? 2 : solId ? 1 : 0;
    const titles = [
      t("explorer.solutions"),
      t("explorer.projects"),
      t("explorer.milestones"),
      t("explorer.tasks"),
    ];
    const subs = [undefined, selectedSolName, selectedProjName, selectedMsTitle];
    const counts = [
      solutions.length,
      projects.length,
      milestones.length,
      tasks.length,
    ];
    const body =
      level === 3 ? (
        <div className="flex min-h-0 flex-1 flex-col bg-canvas">
          {tasksPaneInner}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto bg-canvas pb-2">
          {level === 0
            ? solutionsCol
            : level === 1
              ? projectsCol
              : milestonesCol}
        </div>
      );

    return (
      <>
        <div className="flex h-full min-h-0 flex-col">
          <DrillHeader
            level={level}
            title={titles[level]}
            count={counts[level]}
            sub={subs[level]}
            onBack={goBack}
          />
          {body}
        </div>
        {taskPanel}
      </>
    );
  }

  // --- desktop view: Miller columns board ---
  return (
    <>
      <div className="flex h-full min-h-0 overflow-x-auto">
        <Column title={t("explorer.solutions")} count={solutions.length} scroll>
          {solutionsCol}
        </Column>

        {solId && (
          <Column title={t("explorer.projects")} count={projects.length} scroll>
            {projectsCol}
          </Column>
        )}

        {projId && (
          <Column title={t("explorer.milestones")} count={milestones.length} scroll>
            {milestonesCol}
          </Column>
        )}

        {msId ? (
          <div className="flex min-w-[360px] flex-1 flex-col border-r border-edge bg-canvas">
            {tasksPaneInner}
          </div>
        ) : (
          <Placeholder
            hint={
              !solId
                ? t("explorer.pickSolution")
                : !projId
                  ? t("explorer.pickProject")
                  : t("explorer.pickMilestone")
            }
          />
        )}
      </div>
      {taskPanel}
    </>
  );
}

// --- sub-components ---

/**
 * Task panel header with List/Kanban tabs. The bar is consistent with the column
 * headers (border-b, same height), and the selection is marked by an accent
 * underline (Primer UnderlineNav pattern) - the active tab has a bottom edge in
 * the accent color overlapping the bar's bottom line (-mb-px).
 */
function ViewTabs({
  value,
  onChange,
  count,
  showClosed,
  onToggleClosed,
  closedCount,
}: {
  value: TaskView;
  onChange: (v: TaskView) => void;
  count: number;
  showClosed: boolean;
  onToggleClosed: () => void;
  closedCount: number;
}) {
  const t = useT();
  const tab = (v: TaskView, label: string) => (
    <button
      key={v}
      onClick={() => onChange(v)}
      aria-current={value === v ? "page" : undefined}
      className={`-mb-px border-b-2 py-2.5 text-[11px] font-semibold uppercase tracking-[0.5px] transition-colors ${
        value === v
          ? "border-accent text-fg"
          : "border-transparent text-fg-subtle hover:text-fg"
      }`}
    >
      {label}
    </button>
  );
  return (
    <div className="flex shrink-0 items-center gap-4 border-b border-edge-muted px-3">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.5px] text-fg-subtle">
          {t("explorer.tasks")}
        </span>
        <CountPill>{count}</CountPill>
      </div>
      {tab("list", t("explorer.list"))}
      {tab("kanban", t("explorer.kanban"))}
      {closedCount > 0 && (
        <button
          onClick={onToggleClosed}
          aria-pressed={showClosed}
          title={t("explorer.toggleClosed")}
          className={`ml-auto rounded-md px-2 py-1 text-[10px] font-medium transition-colors ${
            showClosed
              ? "bg-neutral-muted text-fg"
              : "text-fg-subtle hover:text-fg"
          }`}
        >
          {t("explorer.closed")} {closedCount}
        </button>
      )}
    </div>
  );
}

/** Kanban: status columns with task cards. Clicking a card opens the panel. */
function KanbanBoard({
  tasks,
  activeId,
  onSelect,
  resetKey,
}: {
  tasks: TaskListItem[];
  activeId: string | null;
  onSelect: (id: string) => void;
  resetKey: string;
}) {
  const t = useT();
  // FLIP at the level of the WHOLE board - a card slides between columns when its
  // status changes (instead of disappearing and reappearing instantly in another column).
  const boardRef = useRef<HTMLDivElement>(null);
  const sig = tasks.map((k) => `${k.id}:${k.status}:${k.priority}`).join("|");
  useFlip(boardRef, sig, "kanban", resetKey);

  // Partition tasks into status columns (each sorted) once per real change, not on
  // every render or SSE tick. The column sort is by updatedAt desc (a card whose
  // status just changed has the freshest updatedAt -> lands at the TOP of its new
  // column; no state/refs), tie -> priority - so the memo key includes updatedAt.
  const colSig = tasks
    .map((k) => `${k.id}:${k.status}:${k.priority}:${k.updatedAt}`)
    .join("|");
  const columns = useMemo(() => {
    const byRecentThenPriority = (a: TaskListItem, b: TaskListItem) =>
      (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0) ||
      byPriority(a, b);
    // The 'closed' column only when there are closed tasks (when hidden -> no column).
    return STATUS_ORDER.filter(
      (s) => s !== "closed" || tasks.some((k) => k.status === "closed"),
    ).map((status) => ({
      status,
      col: tasks.filter((k) => k.status === status).sort(byRecentThenPriority),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colSig]);
  return (
    <div ref={boardRef} className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-3">
      {columns.map(({ status, col }) => {
        const meta = STATUS_META[status];
        return (
          <div
            key={status}
            className="flex h-full w-[15.5rem] shrink-0 flex-col rounded-lg border border-edge-muted bg-canvas"
          >
            <div className="flex items-center gap-2 border-b border-edge-muted px-3 py-2.5">
              <Dot className={meta.dot} />
              <span className="text-xs font-semibold text-fg">{t(meta.labelKey)}</span>
              <CountPill className="ml-auto">{col.length}</CountPill>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
              {col.length === 0 ? (
                <div className="flex flex-1 items-center justify-center py-6">
                  <span className="text-[11px] text-fg-subtle">{t("explorer.emptyKanbanColumn")}</span>
                </div>
              ) : (
                col.map((t) => (
                  <TaskCard
                    key={t.id}
                    cid={t.id}
                    flipStatus={t.status}
                    active={activeId === t.id}
                    onClick={() => onSelect(t.id)}
                    className="bg-canvas-subtle"
                  >
                    <span className="line-clamp-3 text-sm leading-snug text-fg">
                      {t.title}
                    </span>
                    <TaskMeta
                      labels={t.labels}
                      childCount={t.childCount}
                      childDoneCount={t.childDoneCount}
                      openBlockerCount={t.openBlockerCount}
                    />
                    {t.priority !== "none" && (
                      <span className="flex justify-end">
                        <PriorityBadge priority={t.priority} />
                      </span>
                    )}
                  </TaskCard>
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Pill with the count of blocked tasks (red). Shows in the milestone row on the
 *  left, between the task count and the status tag. */
function BlockedBadge({ n }: { n: number }) {
  const t = useT();
  return (
    <span
      className="inline-flex items-center gap-0.5 rounded-full bg-danger-muted px-1.5 py-0.5 text-[10px] font-medium text-danger"
      title={t("explorer.blockedCount", { n })}
    >
      <Icon name="block" size={10} />
      {n}
    </span>
  );
}

function DrillRow({
  narrow,
  active,
  dimmed,
  cid,
  onSelect,
  title,
  counts,
  percent,
  sub,
  onDelete,
  onDeleted,
}: {
  narrow?: boolean;
  active: boolean;
  /** Entity id (data-cid) - anchor point for the "+1" animation on completion. */
  cid?: string;
  /** Dimmed (e.g. archived) - 50% opacity, full on hover. */
  dimmed?: boolean;
  onSelect: () => void;
  title: string;
  counts: StatusCounts;
  percent: number;
  sub: ReactNode;
  onDelete: () => Promise<unknown>;
  onDeleted: () => void;
}) {
  return (
    <Pulse signal={percent} variant="percent">
    <div
      data-cid={cid}
      className={`group relative ${dimmed ? "opacity-50 transition-opacity hover:opacity-100" : ""}`}
    >
      <button
        onClick={onSelect}
        className={`flex w-full flex-col gap-1.5 px-3 text-left transition-colors ${
          narrow ? "py-3.5 active:bg-canvas-subtle" : "py-2.5"
        } ${
          active ? "bg-accent-muted" : narrow ? "" : "hover:bg-canvas-subtle"
        }`}
      >
        <div className={`flex items-center gap-2 ${narrow ? "" : "pr-5"}`}>
          <span
            className={`min-w-0 flex-1 truncate text-fg ${narrow ? "text-[15px]" : "text-sm"}`}
          >
            {title}
          </span>
          {narrow && (
            <Icon
              name="chevron"
              size={18}
              className="-mr-1 shrink-0 text-fg-subtle"
            />
          )}
        </div>
        <StatusBar counts={counts} />
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 truncate text-[11px] text-fg-subtle">
            {sub}
          </span>
          <AnimatedNumber
            value={percent}
            suffix="%"
            className="shrink-0 font-mono text-[11px] tabular-nums text-fg-muted"
          />
        </div>
      </button>
      {/* Deletion: desktop only (reveal on hover). Touch has no hover, and
          deleting from the list is destructive and rare - it stays on desktop. */}
      {!narrow && (
        <span className="absolute right-1 top-1.5 opacity-0 transition-opacity group-hover:opacity-100">
          <DeleteButton
            label=""
            className="bg-canvas"
            onDelete={onDelete}
            onDone={onDeleted}
          />
        </span>
      )}
    </div>
    </Pulse>
  );
}
