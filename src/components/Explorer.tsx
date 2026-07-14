"use client";

import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  MILESTONE_OUTCOMES,
  MILESTONE_STATUSES,
  MilestoneOutcome,
  MilestoneRollup,
  MilestoneStatus,
  PROJECT_STATUSES,
  ProjectRollup,
  SOLUTION_STATUSES,
  SolutionRollup,
  StatusCounts,
  TaskListItem,
  TaskPriority,
  TaskStatus,
  UpdateProjectInput,
  UpdateSolutionInput,
} from "@/lib/types";
import { api } from "@/lib/api";
import {
  MILESTONE_OUTCOME_META,
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
import { EntityMenu } from "./EntityMenu";
import {
  NewMilestoneForm,
  NewProjectForm,
  NewSolutionForm,
  NewTaskForm,
} from "./forms";
import { TaskPanel } from "./TaskPanel";
import { ProjectPanel } from "./ProjectPanel";
import { Pulse } from "./Pulse";
import { AnimatedNumber } from "./AnimatedNumber";
import { Icon } from "./icons";
import { useIsNarrow } from "@/lib/use-is-narrow";
import { useLiveRefresh } from "@/lib/use-live-refresh";
import { useFlip } from "@/lib/use-flip";
import { useFirstVisit } from "@/lib/route-visit";
import { useT } from "@/i18n/provider";
import {
  ColError,
  ColHint,
  ColLoading,
  Column,
  DrillHeader,
  Placeholder,
  useDrillNavigation,
  withArchivedDivider,
} from "./miller";
import { errMessage } from "@/lib/format";

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

// Localized {value, label} options for the kebab-menu status/outcome pickers.
const optionsFrom = <V extends string>(
  values: readonly V[],
  meta: Record<V, { labelKey: string }>,
  t: (key: string) => string,
) => values.map((v) => ({ value: v, label: t(meta[v].labelKey) }));

// FLIP signature for a task list: one segment per task capturing exactly the keys
// that should drive a re-sort / re-layout (id + status + priority).
const flipSignature = (tasks: TaskListItem[]) =>
  tasks.map((t) => `${t.id}:${t.status}:${t.priority}`).join("|");

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
  locked = false,
}: {
  initialSolutions: SolutionRollup[];
  locked?: boolean;
}) {
  const t = useT();
  const reveal = useFirstVisit();
  const [solutions, setSolutions] = useState(initialSolutions);
  const [projects, setProjects] = useState<ProjectRollup[]>([]);
  const [milestones, setMilestones] = useState<MilestoneRollup[]>([]);
  const [tasks, setTasks] = useState<TaskListItem[]>([]);

  const [solId, setSolId] = useState<string | null>(null);
  const [projId, setProjId] = useState<string | null>(null);
  const [msId, setMsId] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  // Project whose dashboard drawer is open (kebab "Open dashboard"); mutually
  // exclusive with the task panel - both live on the same right edge.
  const [dashProjId, setDashProjId] = useState<string | null>(null);

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
  const taskSignal = flipSignature(visibleTasks);
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

  // Per-column load error - so a failed fetch (e.g. a 401 on a require-key host
  // when no dashboard key is set) surfaces as an error instead of being swallowed
  // and rendered as a misleading "empty" column.
  const [solutionsError, setSolutionsError] = useState<string | null>(null);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [milestonesError, setMilestonesError] = useState<string | null>(null);
  const [tasksError, setTasksError] = useState<string | null>(null);

  const narrow = useIsNarrow();

  const loadSolutions = async () => {
    try {
      setSolutions(await api.listSolutions());
      setSolutionsError(null);
    } catch (e) {
      setSolutions([]);
      setSolutionsError(errMessage(e, t("explorer.loadFailed")));
    }
  };
  // Require-key host: the first column is empty from SSR (no key server-side);
  // fetch the solutions on mount with the browser's key (inline so setState only
  // runs in the async callbacks, not synchronously in the effect body).
  useEffect(() => {
    if (!locked) return;
    api
      .listSolutions()
      .then((s) => {
        setSolutions(s);
        setSolutionsError(null);
      })
      .catch((e) => {
        setSolutions([]);
        setSolutionsError(errMessage(e, t("explorer.loadFailed")));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked]);
  const loadProjects = async (sid: string) => {
    setLoadingProjects(true);
    setProjectsError(null);
    try {
      setProjects(await api.listProjects(sid));
    } catch (e) {
      setProjects([]);
      setProjectsError(errMessage(e, t("explorer.loadFailed")));
    } finally {
      setLoadingProjects(false);
    }
  };
  const loadMilestones = async (pid: string) => {
    setLoadingMilestones(true);
    setMilestonesError(null);
    try {
      setMilestones(await api.listMilestones(pid));
    } catch (e) {
      setMilestones([]);
      setMilestonesError(errMessage(e, t("explorer.loadFailed")));
    } finally {
      setLoadingMilestones(false);
    }
  };
  const loadTasks = async (mid: string) => {
    setLoadingTasks(true);
    setTasksError(null);
    try {
      setTasks(await api.listTasks(mid));
    } catch (e) {
      setTasks([]);
      setTasksError(errMessage(e, t("explorer.loadFailed")));
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
    // Clear stale errors from the now-hidden deeper columns.
    setMilestonesError(null);
    setTasksError(null);
    await loadProjects(id);
  }
  async function selectProject(id: string) {
    pushNav();
    setProjId(id);
    setMsId(null);
    setTaskId(null);
    setTasks([]);
    setTasksError(null);
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
    setDashProjId(null);
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

  // List of solutions; the create form is pinned below it (see solutionsCol),
  // mirroring the "add actor" CTA at the bottom of the actors column.
  const solutionsList = solutionsError ? (
    <ColError text={solutionsError} />
  ) : solutions.length === 0 ? (
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
                {s.status === "archived" && (
                  <MetaPill meta={SOLUTION_STATUS_META.archived} />
                )}
              </span>
            }
            actions={
              <EntityMenu
                editTitle={t("entity.editSolution")}
                name={s.name}
                description={s.description ?? ""}
                status={s.status}
                statusOptions={optionsFrom(
                  SOLUTION_STATUSES,
                  SOLUTION_STATUS_META,
                  t,
                )}
                onSave={(patch) =>
                  api.updateSolution(s.id, patch as UpdateSolutionInput)
                }
                onDelete={() => api.deleteSolution(s.id)}
                onChanged={loadSolutions}
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
            }
          />
        ),
      )
    );

  const solutionsCol = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto pb-2">{solutionsList}</div>
      <div className="shrink-0 border-t border-edge bg-canvas p-2">
        {/* onDone keeps the live column in sync without a full router refresh. */}
        <NewSolutionForm onDone={loadSolutions} />
      </div>
    </div>
  );

  const projectsList = loadingProjects ? (
    <ColLoading />
  ) : projectsError ? (
    <ColError text={projectsError} />
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
          actions={
            <EntityMenu
              editTitle={t("entity.editProject")}
              onOpen={() => {
                setTaskId(null);
                setDashProjId(p.id);
              }}
              openLabel={t("entity.openDashboard")}
              name={p.name}
              description={p.description ?? ""}
              status={p.status}
              statusOptions={optionsFrom(
                PROJECT_STATUSES,
                PROJECT_STATUS_META,
                t,
              )}
              onSave={(patch) =>
                api.updateProject(p.id, patch as UpdateProjectInput)
              }
              onDelete={() => api.deleteProject(p.id)}
              onChanged={() => {
                if (solId) loadProjects(solId);
              }}
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
          }
        />
      ),
    )
  );

  // Same shape as solutionsCol: scrollable list + a create form pinned at the
  // bottom (solId is always set when this column is visible).
  const projectsCol = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto pb-2">{projectsList}</div>
      {solId && (
        <div className="shrink-0 border-t border-edge bg-canvas p-2">
          <NewProjectForm
            solutionId={solId}
            onDone={() => loadProjects(solId)}
          />
        </div>
      )}
    </div>
  );

  const milestonesList = loadingMilestones ? (
    <ColLoading />
  ) : milestonesError ? (
    <ColError text={milestonesError} />
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
              {m.statusCounts.blocked > 0 && (
                <BlockedBadge n={m.statusCounts.blocked} />
              )}
              <MetaPill meta={MILESTONE_STATUS_META[m.status]} />
            </span>
          }
          actions={
            <EntityMenu
              editTitle={t("entity.editMilestone")}
              name={m.title}
              description={m.description ?? ""}
              status={m.status}
              statusOptions={optionsFrom(
                MILESTONE_STATUSES,
                MILESTONE_STATUS_META,
                t,
              )}
              outcome={m.outcome}
              outcomeOptions={optionsFrom(
                MILESTONE_OUTCOMES,
                MILESTONE_OUTCOME_META,
                t,
              )}
              onSave={({ name, description, status, outcome }) =>
                api.updateMilestone(m.id, {
                  ...(name === undefined ? {} : { title: name }),
                  ...(description === undefined ? {} : { description }),
                  ...(status === undefined
                    ? {}
                    : { status: status as MilestoneStatus }),
                  ...(outcome === undefined
                    ? {}
                    : { outcome: (outcome ?? null) as MilestoneOutcome | null }),
                })
              }
              onDelete={() => api.deleteMilestone(m.id)}
              onChanged={() => {
                if (projId) loadMilestones(projId);
              }}
              onDeleted={() => {
                if (msId === m.id) {
                  setMsId(null);
                  setTasks([]);
                }
                if (projId) loadMilestones(projId);
              }}
            />
          }
        />
      ),
    )
  );

  // Scrollable list + a create form pinned at the bottom (projId is always set
  // when this column is visible).
  const milestonesCol = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto pb-2">{milestonesList}</div>
      {projId && (
        <div className="shrink-0 border-t border-edge bg-canvas p-2">
          <NewMilestoneForm
            projectId={projId}
            onDone={() => loadMilestones(projId)}
          />
        </div>
      )}
    </div>
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
          ) : tasksError ? (
            <ColError text={tasksError} />
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
      {msId && (
        <div className="shrink-0 border-t border-edge bg-canvas p-2">
          {/* Defaults to the open milestone; the dropdown still lets you file
              the task under any milestone of this project. */}
          <NewTaskForm
            milestones={milestones.map((m) => ({ id: m.id, title: m.title }))}
            defaultMilestoneId={msId}
            onDone={() => loadTasks(msId)}
          />
        </div>
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

  // Live rollup for the dashboard drawer: read from the projects column state,
  // so SSE refetches keep the drawer's numbers fresh.
  const dashProject = projects.find((p) => p.id === dashProjId) ?? null;
  const projectPanel = (
    <ProjectPanel
      project={dashProject}
      solutionName={
        solutions.find((s) => s.id === dashProject?.solutionId)?.name
      }
      onClose={() => setDashProjId(null)}
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
    const counts = [
      solutions.length,
      projects.length,
      milestones.length,
      tasks.length,
    ];
    // Breadcrumb trail kept on the header across levels: solution / project /
    // milestone (as deep as the current level), so the solution stays visible
    // even inside a project or milestone.
    const crumbs = [
      level >= 1 ? selectedSolName : undefined,
      level >= 2 ? selectedProjName : undefined,
      level >= 3 ? selectedMsTitle : undefined,
    ].filter((c): c is string => Boolean(c));
    const body =
      level === 3 ? (
        <div className="flex min-h-0 flex-1 flex-col bg-canvas">
          {tasksPaneInner}
        </div>
      ) : level === 0 ? (
        // solutionsCol manages its own scroll and pins the create form at the bottom.
        <div className="flex min-h-0 flex-1 flex-col bg-canvas">
          {solutionsCol}
        </div>
      ) : (
        // projectsCol / milestonesCol manage their own scroll and pin the create
        // form at the bottom (same shape as solutionsCol).
        <div className="flex min-h-0 flex-1 flex-col bg-canvas">
          {level === 1 ? projectsCol : milestonesCol}
        </div>
      );

    return (
      <>
        <div className="flex h-full min-h-0 flex-col">
          <DrillHeader
            level={level}
            title={titles[level]}
            count={counts[level]}
            crumbs={crumbs}
            onBack={goBack}
          />
          {body}
        </div>
        {taskPanel}
        {projectPanel}
      </>
    );
  }

  // --- desktop view: Miller columns board ---
  return (
    <>
      <div className={`${reveal} flex h-full min-h-0 overflow-x-auto`}>
        <Column
          title={t("explorer.solutions")}
          count={solutions.length}
          collapseId="solutions"
        >
          {solutionsCol}
        </Column>

        {solId && (
          <Column
            title={t("explorer.projects")}
            count={projects.length}
            collapseId="projects"
          >
            {projectsCol}
          </Column>
        )}

        {projId && (
          <Column
            title={t("explorer.milestones")}
            count={milestones.length}
            collapseId="milestones"
          >
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
      {projectPanel}
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
      className={`-mb-px flex items-center self-stretch border-b-2 text-[11px] font-semibold uppercase tracking-[0.5px] transition-colors ${
        value === v
          ? "border-accent text-fg"
          : "border-transparent text-fg-subtle hover:text-fg"
      }`}
    >
      {label}
    </button>
  );
  return (
    <div className="flex h-11 shrink-0 items-center gap-4 border-b border-edge-muted px-3">
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
  const sig = flipSignature(tasks);
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
    <div
      ref={boardRef}
      className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-3"
    >
      {columns.map(({ status, col }) => {
        const meta = STATUS_META[status];
        return (
          <div
            key={status}
            className="flex h-full w-[15.5rem] shrink-0 flex-col rounded-lg border border-edge-muted bg-canvas"
          >
            <div className="flex items-center gap-2 border-b border-edge-muted px-3 py-2.5">
              <Dot className={meta.dot} />
              <span className="text-xs font-semibold text-fg">
                {t(meta.labelKey)}
              </span>
              <CountPill className="ml-auto">{col.length}</CountPill>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
              {col.length === 0 ? (
                <div className="flex flex-1 items-center justify-center py-6">
                  <span className="text-[11px] text-fg-subtle">
                    {t("explorer.emptyKanbanColumn")}
                  </span>
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
                    <span className="line-clamp-2 text-sm leading-snug text-fg">
                      {t.title}
                    </span>
                    {t.description.trim() !== "" && (
                      // Short context under the title: clamped to exactly two lines
                      // (cut mid-word if needed) so every card stays the same shape.
                      <span className="line-clamp-2 text-xs leading-snug text-fg-muted">
                        {t.description}
                      </span>
                    )}
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
  actions,
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
  /** Row actions (kebab menu) - revealed on hover, desktop only. */
  actions?: ReactNode;
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
        {/* Row actions (edit / status / delete): desktop only (reveal on hover).
          Touch has no hover, and these mutations are rare - they stay on desktop. */}
        {!narrow && actions && (
          <span className="absolute right-1 top-1.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
            {actions}
          </span>
        )}
      </div>
    </Pulse>
  );
}
