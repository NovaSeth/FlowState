/* Domain contract - entities, enums, and API input/output shapes.
 * Enums are lowercase strings (readable in payloads and agent logs). */

export type TaskStatus =
  | "todo"
  | "in_progress"
  | "blocked"
  | "done"
  | "closed";
export type TaskPriority = "none" | "low" | "medium" | "high" | "urgent";
/** Blocker type (meaningful when status='blocked'): a dependency on another task,
 *  an external blocker (human/hardware), or waiting for an owner's decision. */
export type BlockerType = "dependency" | "external" | "decision";
/** Kind of artifact - a work product linked to a task. */
export type ArtifactKind = "commit" | "pr" | "file" | "url";
/** A milestone's deliverable outcome, independent of task %. */
export type MilestoneOutcome = "shipped" | "infeasible" | "descoped";
export type ProjectStatus = "active" | "paused" | "done" | "archived";
/** A milestone has the same lifecycle as a project. */
export type MilestoneStatus = ProjectStatus;
/** Solution: only active or archived (closed). */
export type SolutionStatus = "active" | "archived";

export const TASK_STATUSES: readonly TaskStatus[] = [
  "todo",
  "in_progress",
  "blocked",
  "done",
  "closed",
];
export const TASK_PRIORITIES: readonly TaskPriority[] = [
  "none",
  "low",
  "medium",
  "high",
  "urgent",
];
export const BLOCKER_TYPES: readonly BlockerType[] = [
  "dependency",
  "external",
  "decision",
];
export const ARTIFACT_KINDS: readonly ArtifactKind[] = [
  "commit",
  "pr",
  "file",
  "url",
];
export const MILESTONE_OUTCOMES: readonly MilestoneOutcome[] = [
  "shipped",
  "infeasible",
  "descoped",
];
export const PROJECT_STATUSES: readonly ProjectStatus[] = [
  "active",
  "paused",
  "done",
  "archived",
];
export const MILESTONE_STATUSES: readonly MilestoneStatus[] = PROJECT_STATUSES;
export const SOLUTION_STATUSES: readonly SolutionStatus[] = [
  "active",
  "archived",
];

/** Only "done" counts as completed in the progress rollup. "closed" drops out of
 *  the denominator (a task out of scope - see progressFromCounts). */
export const DONE_STATUS: TaskStatus = "done";

// --- Entities (shape of DB rows, camelCase = column names) ---

export interface Solution {
  id: string;
  name: string;
  description: string;
  color: string;
  status: SolutionStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  id: string;
  solutionId: string;
  name: string;
  description: string;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Milestone {
  id: string;
  projectId: string;
  title: string;
  description: string;
  status: MilestoneStatus;
  position: number;
  /** Deliverable outcome, independent of task %. null = unspecified. */
  outcome: MilestoneOutcome | null;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  milestoneId: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  position: number;
  clientRequestId: string | null;
  /** Actor that "holds" the task (auto-claim on a mutation with a key). */
  ownerActorId: string | null;
  /** Parent task (subtasks). null = top-level task. */
  parentTaskId: string | null;
  /** "Done but unverified" (e.g. code waiting for an on-device test).
   *  Orthogonal to status - does NOT affect progress %. */
  verified: boolean;
  /** Blocker type - meaningful when status='blocked'. null when unblocked/unspecified. */
  blockerType: BlockerType | null;
  /** Labels/tags (e.g. external-blocker, needs-physical, code-only). */
  labels: string[];
  /** Timestamp of entering the 'done' status (ISO). null when the task isn't done.
   *  Source of the "TODAY" counter in the scoreboard (instead of a per-browser tally). */
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Task artifact - a work product (commit, PR, file, URL). */
export interface TaskArtifact {
  id: string;
  taskId: string;
  kind: ArtifactKind;
  value: string;
  label: string;
  createdAt: string;
}

/**
 * A list-row task enriched with lightweight structure stats (in batch), so the
 * List/Kanban views can show structure without drilling into detail:
 * the subtask count, how many of them are done, and the number of open (unresolved) blockers.
 */
export interface TaskListItem extends Task {
  childCount: number;
  childDoneCount: number;
  openBlockerCount: number;
}

/** Lightweight task reference - for dependencies and the subtask list. */
export interface TaskRef {
  id: string;
  title: string;
  status: TaskStatus;
}

/** Task detail: dependencies, subtasks, and the subtask progress rollup. */
export interface TaskDetail extends Task {
  /** Tasks that must be done before this one can start (structured blockedBy). */
  blockedBy: TaskRef[];
  /** Soft cross-links (relatedTo) - related without blocking semantics. */
  relatedTo: TaskRef[];
  /** Direct subtasks. */
  children: TaskRef[];
  childCount: number;
  childStatusCounts: StatusCounts;
  childProgress: Progress;
  /** Artifacts (commit/PR/file/URL). */
  artifacts: TaskArtifact[];
}

// --- Identity and auth (Stream C) ---

export type ActorKind = "human" | "agent";
export type KeyScope = "read" | "write";

export const ACTOR_KINDS: readonly ActorKind[] = ["human", "agent"];
export const KEY_SCOPES: readonly KeyScope[] = ["read", "write"];

export interface Actor {
  id: string;
  kind: ActorKind;
  name: string;
  /** The key that minted this actor (delegation); null for manually created ones. */
  createdByKeyId: string | null;
  archivedAt: string | null;
  createdAt: string;
}

/** API key without the secret - as returned by the API (secret only on create). */
export interface ApiKey {
  id: string;
  actorId: string;
  solutionId: string | null;
  name: string;
  prefix: string;
  scope: KeyScope;
  expiresAt: string | null;
  createdByKeyId: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

/** A key together with its full token - returned ONLY in the response to creation. */
export interface ApiKeyWithSecret extends ApiKey {
  token: string;
}

export interface Activity {
  id: string;
  actorId: string | null;
  entityType: string;
  entityId: string;
  action: string;
  summary: string;
  solutionId: string | null;
  at: string;
}

export interface CreateActorInput {
  kind?: ActorKind;
  name: string;
}

export interface CreateApiKeyInput {
  actorId?: string;
  /** When given instead of actorId, we create a new 'agent' actor with this name. */
  actorName?: string;
  solutionId?: string;
  name?: string;
  scope?: KeyScope;
  /** ISO expiry timestamp or a number of seconds from now (ttlSeconds). */
  expiresAt?: string;
  ttlSeconds?: number;
}

export interface Comment {
  id: string;
  taskId: string;
  author: string;
  body: string;
  createdAt: string;
}

// --- Rollup / progress ---

export type StatusCounts = Record<TaskStatus, number>;

export interface Progress {
  total: number;
  done: number;
  /** integer 0-100 */
  percent: number;
}

export interface MilestoneRollup extends Milestone {
  progress: Progress;
  statusCounts: StatusCounts;
}

export interface ProjectRollup extends Project {
  progress: Progress;
  statusCounts: StatusCounts;
  milestoneCount: number;
}

export interface SolutionRollup extends Solution {
  progress: Progress;
  statusCounts: StatusCounts;
  projectCount: number;
}

/** A task's origin context - for feeds on the overview screen. */
export interface TaskContext {
  solutionId: string;
  solutionName: string;
  projectId: string;
  projectName: string;
  milestoneId: string;
  milestoneTitle: string;
}

export interface TaskWithContext extends Task {
  context: TaskContext;
}

/** A task in the "Needs attention" feed. For blocked ones, `note` carries the
 *  latest comment (usually the reason for the block), so the key triage signal is
 *  visible inline instead of hidden in the comments. */
export interface AttentionTask extends TaskWithContext {
  note?: string;
}

export interface DashboardSolution extends SolutionRollup {
  projects: ProjectRollup[];
  /** The solution's 5 most recently changed tasks (any status) - "what happened here". */
  recentTasks: TaskWithContext[];
}

/**
 * Daily completed-task counts broken down by solution - the source of the live
 * stacked bar chart on the overview. Shaped for direct rendering: one column per
 * day, one stacked segment per solution.
 *   counts[dayIndex][solutionIndex] = tasks completed that day in that solution.
 * `days` are 'YYYY-MM-DD' in chronological order; `solutions` carry the name and
 * (possibly empty) color from the dashboard's solutions list. Capped to the most
 * recent days that have completions, so the payload stays bounded.
 */
export interface DailyBySolution {
  days: string[];
  solutions: { id: string; name: string; color: string }[];
  counts: number[][];
}

export interface DashboardPayload {
  totals: {
    solutions: number;
    projects: number;
    milestones: number;
    tasks: number;
  };
  statusCounts: StatusCounts;
  progress: Progress;
  /** Cumulative completion counters (for gamification - detecting new completions
   *  between refreshes). "done" = task status=done; milestone/project/solution =
   *  status done/archived OR 100% (there are tasks and all are non-open). */
  completed: {
    tasksDone: number;
    milestonesDone: number;
    projectsDone: number;
    solutionsDone: number;
  };
  /** Ids of entities currently completed (low cardinality) - the client diffs the
   *  sets to know which specific milestone/project/solution closed (source of the
   *  "+1" animation). Tasks have high cardinality - their ids go through changesSince. */
  completedIds: {
    milestones: string[];
    projects: string[];
    solutions: string[];
  };
  /** Authoritative "TODAY" counter (HUD scoreboard) - computed server-side per local
   *  day, shared across sessions/agents (not per-browser). A task counts when
   *  status='done' and completedAt is today; a milestone/project when currently
   *  completed (same rule as completed/completedIds) and its completion time =
   *  MAX(tasks' completedAt) is today. */
  completedToday: {
    tasks: number;
    milestones: number;
    projects: number;
  };
  solutions: DashboardSolution[];
  /** blocked or urgent tasks - "what needs attention" */
  attention: AttentionTask[];
  /** recently changed tasks - "what's going on" */
  recent: TaskWithContext[];
  /** Tasks completed per day, broken down by solution (for the live daily chart). */
  dailyBySolution: DailyBySolution;
}

/**
 * Raw changes since a given moment - for an agent's polling sync.
 *
 * `since` is an ISO timestamp; `serverTime` is the server time the client takes as
 * `since` for the next call. Solution/Project/Milestone/Task are filtered by
 * `updatedAt > since`; comments (append-only) by `createdAt > since`.
 *
 * Limitation: deletions are not reported (no tombstones in the MVP). The agent will
 * hit a 404 when trying to call against a deleted entity - that's defensive enough.
 */
export interface ChangesSincePayload {
  since: string;
  serverTime: string;
  solutions: Solution[];
  projects: Project[];
  milestones: Milestone[];
  tasks: Task[];
  comments: Comment[];
}

// --- Inputs (DTO) ---

export interface CreateSolutionInput {
  name: string;
  description?: string;
  color?: string;
  status?: SolutionStatus;
}
export type UpdateSolutionInput = Partial<CreateSolutionInput>;

export interface CreateProjectInput {
  solutionId: string;
  name: string;
  description?: string;
  status?: ProjectStatus;
}
export type UpdateProjectInput = Partial<Omit<CreateProjectInput, "solutionId">>;

export interface CreateMilestoneInput {
  projectId: string;
  title: string;
  description?: string;
  status?: MilestoneStatus;
  position?: number;
  /** Deliverable outcome (shipped|infeasible|descoped). null/"" = clear. */
  outcome?: MilestoneOutcome | "" | null;
}
export type UpdateMilestoneInput = Partial<
  Omit<CreateMilestoneInput, "projectId">
>;

/** Bulk milestone update - like UpdateMilestoneInput, but with the id inside. */
export type MilestoneBulkUpdate = UpdateMilestoneInput & { id: string };

export interface CreateTaskInput {
  milestoneId: string;
  title: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  position?: number;
  /** idempotency key - a retry returns the existing task instead of a duplicate */
  clientRequestId?: string;
  /** Parent task (subtask). */
  parentTaskId?: string;
  /** Ids of blocking tasks (must be done). Replaces the whole set. */
  blockedBy?: string[];
  /** Ids of related tasks (soft, relatedTo). Replaces the whole set. */
  relatedTo?: string[];
  /** Labels. Replaces the whole set. */
  labels?: string[];
  /** "Done, unverified" - a flag orthogonal to status. */
  verified?: boolean;
  /** Blocker type when status='blocked'. */
  blockerType?: BlockerType | "" | null;
  /** Artifacts (commit/PR/file/URL). Replaces the whole set. */
  artifacts?: ArtifactInput[];
}

/** A single artifact on input (create/replace). */
export interface ArtifactInput {
  kind?: ArtifactKind;
  value: string;
  label?: string;
}

export type UpdateTaskInput = Partial<
  Omit<CreateTaskInput, "milestoneId" | "clientRequestId">
> & {
  milestoneId?: string;
  /** Reason when setting status "blocked" - saved as a comment. */
  reason?: string;
  /** Author of the reason comment (empty by default). */
  reasonAuthor?: string;
  /** Explicit owner assignment (empty/null = unset). */
  ownerActorId?: string | null;
  /** Reparenting (empty/null = detach). */
  parentTaskId?: string | null;
};

/** Bulk task update - like UpdateTaskInput, but with the id inside. */
export type TaskBulkUpdate = UpdateTaskInput & { id: string };

export interface CreateCommentInput {
  body: string;
  author?: string;
}
