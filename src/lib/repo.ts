import type { DatabaseSync } from "node:sqlite";
import { genId, ID_PREFIX } from "./ids";
import { AppError, notFound, unprocessable } from "./errors";
import {
  emptyStatusCounts,
  progressFromCounts,
  statusCountsFromRows,
} from "./progress";
import { enumValue, optionalNumber, optionalString, requireString } from "./validate";
import { currentActorId, currentContext } from "./context";
import { generateKey, secretMatches, splitToken } from "./auth";
import {
  Actor,
  ActorKind,
  ACTOR_KINDS,
  Activity,
  ArtifactInput,
  ARTIFACT_KINDS,
  AttentionTask,
  BLOCKER_TYPES,
  MILESTONE_OUTCOMES,
  MilestoneBulkUpdate,
  TaskArtifact,
  TaskBulkUpdate,
  ApiKey,
  ApiKeyWithSecret,
  CreateActorInput,
  CreateApiKeyInput,
  KeyScope,
  KEY_SCOPES,
  Solution,
  SolutionRollup,
  ChangesSincePayload,
  Comment,
  CreateSolutionInput,
  CreateCommentInput,
  CreateMilestoneInput,
  CreateProjectInput,
  CreateTaskInput,
  DailyByStatus,
  DashboardSolution,
  DashboardPayload,
  Milestone,
  MilestoneRollup,
  Progress,
  Project,
  ProjectRollup,
  PROJECT_STATUSES,
  MILESTONE_STATUSES,
  SOLUTION_STATUSES,
  StatusCounts,
  Task,
  TaskDetail,
  TaskListItem,
  TaskRef,
  TaskStatus,
  TaskWithContext,
  TASK_PRIORITIES,
  TASK_STATUSES,
  UpdateSolutionInput,
  UpdateMilestoneInput,
  UpdateProjectInput,
  UpdateTaskInput,
} from "./types";

const now = () => new Date().toISOString();

/** Safety guards: limit the batch size (single-process SQLite would block on a
 *  huge array) and the length of an artifact value. */
const MAX_BULK = 1000;
const MAX_ARTIFACT_VALUE = 2048;

/** Bound for GET /api/tasks: hard cap and default page size when the caller does
 *  not pass ?limit, so a single list call cannot dump the whole DB. */
const MAX_TASK_LIMIT = 1000;
const DEFAULT_TASK_LIMIT = 500;

/** Per-bucket cap for changesSince so a client sending epoch cannot pull the whole
 *  DB unbounded in one call. */
const MAX_CHANGES_PER_BUCKET = 1000;

/** Clamp a possibly-undefined limit into [1, max], falling back to `def`. */
function clampLimit(limit: number | undefined, def: number, max: number): number {
  return Math.min(Math.max(Number.isFinite(limit) ? (limit as number) : def, 1), max);
}

/** Throws 422 when the batch array exceeds the limit. */
function checkBulk(arr: unknown[], what: string): void {
  if (arr.length > MAX_BULK) {
    throw unprocessable(`Batch too large "${what}": ${arr.length} > limit ${MAX_BULK}`);
  }
}

/** An invalid / empty `since` is treated as the epoch - a stateless client gets
 * a full snapshot on the first call. Date accepts a wide range of formats
 * (ISO, RFC 2822, ...), so we normalize to canonical ISO before SQL. */
function normalizeSince(raw: string): string {
  if (!raw) return new Date(0).toISOString();
  const d = new Date(raw);
  if (isNaN(d.getTime())) return new Date(0).toISOString();
  return d.toISOString();
}

// node:sqlite returns rows with a null prototype. React does not allow passing
// such objects from a Server to a Client Component - we flatten them to plain objects.
function plain<T>(row: unknown): T {
  return { ...(row as object) } as T;
}

// Task columns + context (solution/project/milestone) for overview feeds.
const TASK_CTX_SELECT = `
  t.id, t.milestoneId, t.title, t.description, t.status, t.priority,
  t.position, t.clientRequestId, t.ownerActorId, t.parentTaskId,
  t.verified, t.blockerType, t.createdAt, t.updatedAt,
  ms.title AS ctxMilestoneTitle,
  pr.id AS ctxProjectId, pr.name AS ctxProjectName,
  cl.id AS ctxSolutionId, cl.name AS ctxSolutionName
  FROM tasks t
  JOIN milestones ms ON t.milestoneId = ms.id
  JOIN projects pr ON ms.projectId = pr.id
  JOIN solutions cl ON pr.solutionId = cl.id`;

type CtxRow = Task & {
  ctxMilestoneTitle: string;
  ctxProjectId: string;
  ctxProjectName: string;
  ctxSolutionId: string;
  ctxSolutionName: string;
};

function toTaskWithContext(row: CtxRow): TaskWithContext {
  const {
    ctxMilestoneTitle,
    ctxProjectId,
    ctxProjectName,
    ctxSolutionId,
    ctxSolutionName,
    ...task
  } = row;
  return {
    ...(task as Task),
    context: {
      solutionId: ctxSolutionId,
      solutionName: ctxSolutionName,
      projectId: ctxProjectId,
      projectName: ctxProjectName,
      milestoneId: task.milestoneId,
      milestoneTitle: ctxMilestoneTitle,
    },
  };
}

/** The "open" task statuses (still counted in the denominator of progress). A
 *  milestone/project/solution is "fully done" only when it has >=1 done task and
 *  zero open tasks. Kept as a SQL literal list so it can be interpolated into
 *  `status IN (...)` clauses verbatim. */
const OPEN_STATUSES = `'todo','in_progress','blocked'`;

/** Correlated-subquery scope fragments tying a `tasks t` subquery to the outer
 *  milestone (m) / project (p) / solution (s) row. Used by fullyDone() and the
 *  completion rollups. Each ends in a WHERE so the caller appends `AND ...`. */
const MILESTONE_SCOPE = `WHERE t.milestoneId = m.id`;
const PROJECT_SCOPE = `JOIN milestones m ON t.milestoneId = m.id WHERE m.projectId = p.id`;
const SOLUTION_SCOPE = `JOIN milestones m ON t.milestoneId = m.id JOIN projects p ON m.projectId = p.id WHERE p.solutionId = s.id`;

/** SQL predicate: the entity scoped by `scope` is "fully done" - it has at least
 *  one done task and no open tasks. `scope` is one of the *_SCOPE fragments above
 *  (ending in WHERE), so we append `AND ...`. Shared by completionCounts,
 *  completedIds and completedToday so they stay in lockstep. */
const fullyDone = (scope: string) =>
  `((SELECT COUNT(*) FROM tasks t ${scope} AND t.status='done') > 0
        AND (SELECT COUNT(*) FROM tasks t ${scope} AND t.status IN (${OPEN_STATUSES})) = 0)`;

/** Public api_keys columns (everything EXCEPT secretHash). Reads that surface a
 *  key to a caller select this explicit list so the secret hash is never pulled
 *  into memory by accident; only resolveApiKey selects secretHash deliberately. */
const API_KEY_PUBLIC_COLS = `id, actorId, solutionId, name, prefix, scope, expiresAt, createdByKeyId, lastUsedAt, revokedAt, createdAt`;

/** Data access layer. Holds all the CRUD logic + progress rollups. */
export class Repo {
  constructor(private readonly db: DatabaseSync) {}

  // --- transactions ---

  /** Nesting depth (node:sqlite throws on a nested BEGIN). */
  private txDepth = 0;

  /**
   * Runs fn in a single transaction (BEGIN IMMEDIATE / COMMIT / ROLLBACK) so a
   * multi-statement mutation is all-or-nothing. Re-entrant: a nested call runs
   * inside the already-open transaction (no new BEGIN), so methods that wrap
   * transaction (createTask) can be safely called inside others (createTasks).
   * node:sqlite is synchronous and single-process - fn MUST NOT await, otherwise
   * another write could slip into the middle of the transaction.
   */
  transaction<T>(fn: () => T): T {
    if (this.txDepth > 0) return fn();
    this.db.exec("BEGIN IMMEDIATE");
    this.txDepth = 1;
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (e) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        // no open transaction to roll back - ignore
      }
      throw e;
    } finally {
      this.txDepth = 0;
    }
  }

  // --- helpers ---

  private scalar(sql: string, params: (string | number)[] = []): number {
    const row = this.db.prepare(sql).get(...params) as { n: number } | undefined;
    return row ? Number(row.n) : 0;
  }

  private countBy(sql: string, params: (string | number)[] = []) {
    const rows = this.db.prepare(sql).all(...params) as {
      key: string;
      n: number;
    }[];
    const map = new Map<string, number>();
    for (const r of rows) map.set(r.key, Number(r.n));
    return map;
  }

  private groupedCounts(sql: string, params: (string | number)[] = []) {
    const rows = this.db.prepare(sql).all(...params) as {
      key: string;
      status: string;
      n: number;
    }[];
    const map = new Map<string, StatusCounts>();
    for (const r of rows) {
      let c = map.get(r.key);
      if (!c) {
        c = emptyStatusCounts();
        map.set(r.key, c);
      }
      if ((TASK_STATUSES as readonly string[]).includes(r.status)) {
        c[r.status as keyof StatusCounts] = Number(r.n);
      }
    }
    return map;
  }

  private statusCountsWhere(joinWhere: string, params: (string | number)[]) {
    const rows = this.db
      .prepare(
        `SELECT t.status AS status, COUNT(*) AS n FROM tasks t ${joinWhere} GROUP BY t.status`,
      )
      .all(...params) as { status: string; n: number }[];
    return statusCountsFromRows(rows);
  }

  // --- API-key solution scope enforcement ---

  /**
   * Solution-scope guard for a key minted with a solutionId (keySolutionId).
   * Triggers ONLY when the request runs under a solution-scoped key: admin keys,
   * unscoped keys and anonymous open-mode callers leave keySolutionId undefined and
   * pass through untouched. A scoped key may only touch entities belonging to its
   * own solution; anything else is 403. `solutionId === undefined` (the owning
   * solution could not be resolved, e.g. a missing entity) is treated as
   * out-of-scope so we never leak across solutions.
   */
  private assertScope(solutionId: string | null | undefined): void {
    const scoped = currentContext().keySolutionId;
    if (!scoped) return; // not a solution-scoped key (or admin/anonymous) - no restriction
    if (solutionId !== scoped) {
      throw new AppError(403, "API key is scoped to a different solution");
    }
  }

  /** The solution that the current request's scoped key is bound to, if any.
   *  Used by read/enumeration paths to force the solutionId filter. */
  private scopedSolutionId(): string | undefined {
    return currentContext().keySolutionId;
  }

  /** Owning solution of a milestone (via project). undefined when the path is gone. */
  private solutionIdForMilestone(milestoneId: string): string | undefined {
    const row = this.db
      .prepare(
        `SELECT pr.solutionId AS sid FROM milestones ms
         JOIN projects pr ON ms.projectId = pr.id
         WHERE ms.id = ?`,
      )
      .get(milestoneId) as { sid: string } | undefined;
    return row?.sid;
  }

  /** Owning solution of a project. undefined when the project is gone. */
  private solutionIdForProject(projectId: string): string | undefined {
    const row = this.db
      .prepare(`SELECT solutionId AS sid FROM projects WHERE id = ?`)
      .get(projectId) as { sid: string } | undefined;
    return row?.sid;
  }

  /** Owning solution of a comment's task. undefined when the path is gone. */
  private solutionIdForComment(commentId: string): string | undefined {
    const row = this.db
      .prepare(
        `SELECT pr.solutionId AS sid FROM comments c
         JOIN tasks t ON c.taskId = t.id
         JOIN milestones ms ON t.milestoneId = ms.id
         JOIN projects pr ON ms.projectId = pr.id
         WHERE c.id = ?`,
      )
      .get(commentId) as { sid: string } | undefined;
    return row?.sid;
  }

  // --- solutions (RootProject) ---

  listSolutions(): SolutionRollup[] {
    // Scoped key: enumerate ONLY the key's own solution.
    const scoped = this.scopedSolutionId();
    const solutions = (
      scoped
        ? this.db
            .prepare(`SELECT * FROM solutions WHERE id = ? ORDER BY name COLLATE NOCASE ASC`)
            .all(scoped)
        : this.db
            .prepare(`SELECT * FROM solutions ORDER BY name COLLATE NOCASE ASC`)
            .all()
    ) as unknown as Solution[];
    const counts = this.groupedCounts(
      `SELECT p.solutionId AS key, t.status AS status, COUNT(*) AS n
       FROM tasks t
       JOIN milestones m ON t.milestoneId = m.id
       JOIN projects p ON m.projectId = p.id
       GROUP BY p.solutionId, t.status`,
    );
    const projectCounts = this.countBy(
      `SELECT solutionId AS key, COUNT(*) AS n FROM projects GROUP BY solutionId`,
    );
    return solutions.map((c) => {
      const sc = counts.get(c.id) ?? emptyStatusCounts();
      return {
        ...c,
        statusCounts: sc,
        progress: progressFromCounts(sc),
        projectCount: projectCounts.get(c.id) ?? 0,
      };
    });
  }

  getSolution(id: string): Solution | null {
    const row = this.db.prepare(`SELECT * FROM solutions WHERE id = ?`).get(id);
    return row ? plain<Solution>(row) : null;
  }

  getSolutionRollup(id: string): SolutionRollup | null {
    const solution = this.getSolution(id);
    if (!solution) return null;
    this.assertScope(solution.id);
    const sc = this.statusCountsWhere(
      `JOIN milestones m ON t.milestoneId = m.id
       JOIN projects p ON m.projectId = p.id WHERE p.solutionId = ?`,
      [id],
    );
    return {
      ...solution,
      statusCounts: sc,
      progress: progressFromCounts(sc),
      projectCount: this.scalar(
        `SELECT COUNT(*) AS n FROM projects WHERE solutionId = ?`,
        [id],
      ),
    };
  }

  createSolution(input: CreateSolutionInput): Solution {
    // A solution-scoped key cannot create other solutions (there is no solution it
    // could scope-match yet). assertScope(undefined) is out-of-scope -> 403.
    this.assertScope(undefined);
    const name = requireString(input.name, "name");
    const description = optionalString(input.description, "description") ?? "";
    const color = optionalString(input.color, "color") ?? "";
    const status =
      input.status !== undefined
        ? enumValue(input.status, SOLUTION_STATUSES, "status")
        : "active";
    const id = genId(ID_PREFIX.solution);
    const ts = now();
    this.db
      .prepare(
        `INSERT INTO solutions (id, name, description, color, status, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, name, description, color, status, ts, ts);
    return this.getSolution(id)!;
  }

  updateSolution(id: string, input: UpdateSolutionInput): Solution {
    const existing = this.getSolution(id);
    if (!existing) throw notFound("solution");
    // A scoped key may mutate ONLY its own solution.
    this.assertScope(existing.id);
    const name =
      input.name !== undefined ? requireString(input.name, "name") : existing.name;
    const description =
      input.description !== undefined
        ? (optionalString(input.description, "description") ?? "")
        : existing.description;
    const color =
      input.color !== undefined
        ? (optionalString(input.color, "color") ?? "")
        : existing.color;
    const status =
      input.status !== undefined
        ? enumValue(input.status, SOLUTION_STATUSES, "status")
        : existing.status;
    this.db
      .prepare(
        `UPDATE solutions SET name = ?, description = ?, color = ?, status = ?, updatedAt = ? WHERE id = ?`,
      )
      .run(name, description, color, status, now(), id);
    return this.getSolution(id)!;
  }

  deleteSolution(id: string): void {
    // A scoped key may delete ONLY its own solution; out-of-scope (or missing) -> 403.
    if (this.scopedSolutionId()) this.assertScope(this.getSolution(id)?.id);
    const res = this.db.prepare(`DELETE FROM solutions WHERE id = ?`).run(id);
    if (res.changes === 0) throw notFound("solution");
  }

  // --- projects ---

  listProjects(solutionId?: string): ProjectRollup[] {
    // Scoped key: force the solution filter so projects of another solution are not
    // enumerable. assertScope makes a mismatching explicit solutionId a hard 403,
    // which is friendlier than silently returning the wrong set.
    const scoped = this.scopedSolutionId();
    if (scoped) {
      if (solutionId !== undefined) this.assertScope(solutionId);
      solutionId = scoped;
    }
    // Active projects on top, completed/archived at the bottom; newest first within a status group.
    const projectOrder =
      `ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 WHEN 'done' THEN 2 WHEN 'archived' THEN 3 ELSE 4 END ASC, createdAt DESC`;
    const projects = (
      solutionId
        ? this.db
            .prepare(`SELECT * FROM projects WHERE solutionId = ? ${projectOrder}`)
            .all(solutionId)
        : this.db.prepare(`SELECT * FROM projects ${projectOrder}`).all()
    ) as unknown as Project[];
    const counts = this.groupedCounts(
      `SELECT m.projectId AS key, t.status AS status, COUNT(*) AS n
       FROM tasks t JOIN milestones m ON t.milestoneId = m.id
       GROUP BY m.projectId, t.status`,
    );
    const msCounts = this.countBy(
      `SELECT projectId AS key, COUNT(*) AS n FROM milestones GROUP BY projectId`,
    );
    return projects.map((p) => {
      const sc = counts.get(p.id) ?? emptyStatusCounts();
      return {
        ...p,
        statusCounts: sc,
        progress: progressFromCounts(sc),
        milestoneCount: msCounts.get(p.id) ?? 0,
      };
    });
  }

  getProject(id: string): Project | null {
    const row = this.db.prepare(`SELECT * FROM projects WHERE id = ?`).get(id);
    return row ? plain<Project>(row) : null;
  }

  getProjectRollup(id: string): ProjectRollup | null {
    const project = this.getProject(id);
    if (!project) return null;
    this.assertScope(project.solutionId);
    const sc = this.statusCountsWhere(
      `JOIN milestones m ON t.milestoneId = m.id WHERE m.projectId = ?`,
      [id],
    );
    return {
      ...project,
      statusCounts: sc,
      progress: progressFromCounts(sc),
      milestoneCount: this.scalar(
        `SELECT COUNT(*) AS n FROM milestones WHERE projectId = ?`,
        [id],
      ),
    };
  }

  createProject(input: CreateProjectInput): Project {
    const solutionId = requireString(input.solutionId, "solutionId");
    // Scoped key: the new project must live in the key's solution.
    this.assertScope(solutionId);
    if (!this.getSolution(solutionId)) throw notFound("solution");
    const name = requireString(input.name, "name");
    const description = optionalString(input.description, "description") ?? "";
    const status =
      input.status !== undefined
        ? enumValue(input.status, PROJECT_STATUSES, "status")
        : "active";
    const id = genId(ID_PREFIX.project);
    const ts = now();
    this.db
      .prepare(
        `INSERT INTO projects (id, solutionId, name, description, status, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, solutionId, name, description, status, ts, ts);
    // Intentionally do NOT create any default milestone. A milestone should
    // describe a concrete problem to solve (with tasks that implement it), not
    // be a catch-all bucket - so milestones are created deliberately via createMilestone.
    return this.getProject(id)!;
  }

  updateProject(id: string, input: UpdateProjectInput): Project {
    const existing = this.getProject(id);
    if (!existing) throw notFound("project");
    this.assertScope(existing.solutionId);
    const name =
      input.name !== undefined ? requireString(input.name, "name") : existing.name;
    const description =
      input.description !== undefined
        ? (optionalString(input.description, "description") ?? "")
        : existing.description;
    const status =
      input.status !== undefined
        ? enumValue(input.status, PROJECT_STATUSES, "status")
        : existing.status;
    this.db
      .prepare(
        `UPDATE projects SET name = ?, description = ?, status = ?, updatedAt = ? WHERE id = ?`,
      )
      .run(name, description, status, now(), id);
    return this.getProject(id)!;
  }

  deleteProject(id: string): void {
    if (this.scopedSolutionId()) this.assertScope(this.solutionIdForProject(id));
    const res = this.db.prepare(`DELETE FROM projects WHERE id = ?`).run(id);
    if (res.changes === 0) throw notFound("project");
  }

  // --- milestones ---

  listMilestones(projectId: string): MilestoneRollup[] {
    // Scoped key: listing milestones of a project in another solution -> 403.
    if (this.scopedSolutionId()) this.assertScope(this.solutionIdForProject(projectId));
    // Active milestones on top, completed/archived at the bottom; keep the manual
    // sequence (position, then createdAt) within each status group.
    const milestones = this.db
      .prepare(
        `SELECT * FROM milestones WHERE projectId = ? ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 WHEN 'done' THEN 2 WHEN 'archived' THEN 3 ELSE 4 END ASC, position ASC, createdAt ASC`,
      )
      .all(projectId) as unknown as Milestone[];
    const counts = this.groupedCounts(
      `SELECT t.milestoneId AS key, t.status AS status, COUNT(*) AS n
       FROM tasks t JOIN milestones m ON t.milestoneId = m.id
       WHERE m.projectId = ? GROUP BY t.milestoneId, t.status`,
      [projectId],
    );
    return milestones.map((m) => {
      const sc = counts.get(m.id) ?? emptyStatusCounts();
      return { ...m, statusCounts: sc, progress: progressFromCounts(sc) };
    });
  }

  getMilestone(id: string): Milestone | null {
    const row = this.db.prepare(`SELECT * FROM milestones WHERE id = ?`).get(id);
    return row ? plain<Milestone>(row) : null;
  }

  getMilestoneRollup(id: string): MilestoneRollup | null {
    const m = this.getMilestone(id);
    if (!m) return null;
    if (this.scopedSolutionId()) this.assertScope(this.solutionIdForMilestone(id));
    const sc = this.statusCountsWhere(`WHERE t.milestoneId = ?`, [id]);
    return { ...m, statusCounts: sc, progress: progressFromCounts(sc) };
  }

  createMilestone(input: CreateMilestoneInput): Milestone {
    const projectId = requireString(input.projectId, "projectId");
    // Scoped key: the parent project must live in the key's solution.
    if (this.scopedSolutionId()) this.assertScope(this.solutionIdForProject(projectId));
    if (!this.getProject(projectId)) throw notFound("project");
    const title = requireString(input.title, "title");
    const description = optionalString(input.description, "description") ?? "";
    const status =
      input.status !== undefined
        ? enumValue(input.status, MILESTONE_STATUSES, "status")
        : "active";
    const position =
      optionalNumber(input.position, "position") ??
      this.scalar(
        `SELECT COALESCE(MAX(position), -1) + 1 AS n FROM milestones WHERE projectId = ?`,
        [projectId],
      );
    const outcome =
      input.outcome
        ? enumValue(input.outcome, MILESTONE_OUTCOMES, "outcome")
        : null;
    const id = genId(ID_PREFIX.milestone);
    const ts = now();
    this.db
      .prepare(
        `INSERT INTO milestones (id, projectId, title, description, status, position, outcome, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, projectId, title, description, status, position, outcome, ts, ts);
    return this.getMilestone(id)!;
  }

  updateMilestone(id: string, input: UpdateMilestoneInput): Milestone {
    return this.transaction(() => this.applyMilestoneUpdate(id, input));
  }

  /** Bulk update of milestones in ONE transaction (e.g. archiving many at once). */
  updateMilestones(items: MilestoneBulkUpdate[]): Milestone[] {
    checkBulk(items, "milestone updates");
    return this.transaction(() =>
      items.map(({ id, ...patch }) => this.applyMilestoneUpdate(id, patch)),
    );
  }

  private applyMilestoneUpdate(id: string, input: UpdateMilestoneInput): Milestone {
    const existing = this.getMilestone(id);
    if (!existing) throw notFound("milestone");
    if (this.scopedSolutionId()) this.assertScope(this.solutionIdForMilestone(id));
    const title =
      input.title !== undefined
        ? requireString(input.title, "title")
        : existing.title;
    const description =
      input.description !== undefined
        ? (optionalString(input.description, "description") ?? "")
        : existing.description;
    const status =
      input.status !== undefined
        ? enumValue(input.status, MILESTONE_STATUSES, "status")
        : existing.status;
    const position =
      optionalNumber(input.position, "position") ?? existing.position;
    const outcome =
      input.outcome !== undefined
        ? input.outcome
          ? enumValue(input.outcome, MILESTONE_OUTCOMES, "outcome")
          : null
        : existing.outcome;
    this.db
      .prepare(
        `UPDATE milestones SET title = ?, description = ?, status = ?, position = ?, outcome = ?, updatedAt = ? WHERE id = ?`,
      )
      .run(title, description, status, position, outcome, now(), id);
    return this.getMilestone(id)!;
  }

  deleteMilestone(id: string): void {
    if (this.scopedSolutionId()) this.assertScope(this.solutionIdForMilestone(id));
    const res = this.db.prepare(`DELETE FROM milestones WHERE id = ?`).run(id);
    if (res.changes === 0) throw notFound("milestone");
  }

  // --- tasks ---

  /** Map taskId -> labels (one query for the whole list). */
  private labelsFor(ids: string[]): Map<string, string[]> {
    const m = new Map<string, string[]>();
    if (ids.length === 0) return m;
    const ph = ids.map(() => "?").join(",");
    const rows = this.db
      .prepare(
        `SELECT taskId, label FROM task_labels WHERE taskId IN (${ph}) ORDER BY label ASC`,
      )
      .all(...ids) as { taskId: string; label: string }[];
    for (const r of rows) {
      const arr = m.get(r.taskId);
      if (arr) arr.push(r.label);
      else m.set(r.taskId, [r.label]);
    }
    return m;
  }

  /** Attaches the `labels` field to tasks (batched) and coerces `verified` from
   *  0/1 (SQLite has no boolean) to a boolean. All Task-returning paths go through here. */
  private withLabels<T extends { id: string }>(tasks: T[]): (T & { labels: string[] })[] {
    const m = this.labelsFor(tasks.map((t) => t.id));
    return tasks.map((t) => {
      const r = t as Record<string, unknown>;
      return {
        ...t,
        ...("verified" in r ? { verified: !!r.verified } : {}),
        labels: m.get(t.id) ?? [],
      };
    });
  }

  listTasks(filter: {
    milestoneId?: string;
    projectId?: string;
    solutionId?: string;
    status?: string;
    priority?: string;
    parentTaskId?: string;
    label?: string;
    ownerActorId?: string;
    limit?: number;
  }): Task[] {
    // Scoped key: force the solution filter to the key's solution so it cannot
    // enumerate tasks of another solution (ignoring/overriding a different caller value).
    const scoped = this.scopedSolutionId();
    if (scoped) filter = { ...filter, solutionId: scoped };
    const where: string[] = [];
    const params: (string | number)[] = [];
    // projectId and solutionId require walking up the hierarchy.
    const joins: string[] = [];
    if (filter.projectId || filter.solutionId) {
      joins.push(`JOIN milestones m ON t.milestoneId = m.id`);
    }
    if (filter.solutionId) {
      joins.push(`JOIN projects p ON m.projectId = p.id`);
    }
    if (filter.milestoneId) {
      where.push(`t.milestoneId = ?`);
      params.push(filter.milestoneId);
    }
    if (filter.projectId) {
      where.push(`m.projectId = ?`);
      params.push(filter.projectId);
    }
    if (filter.solutionId) {
      where.push(`p.solutionId = ?`);
      params.push(filter.solutionId);
    }
    if (filter.parentTaskId) {
      where.push(`t.parentTaskId = ?`);
      params.push(filter.parentTaskId);
    }
    if (filter.ownerActorId) {
      where.push(`t.ownerActorId = ?`);
      params.push(filter.ownerActorId);
    }
    if (filter.label) {
      where.push(`t.id IN (SELECT taskId FROM task_labels WHERE label = ?)`);
      params.push(filter.label);
    }
    if (filter.status) {
      where.push(`t.status = ?`);
      params.push(enumValue(filter.status, TASK_STATUSES, "status"));
    }
    if (filter.priority) {
      where.push(`t.priority = ?`);
      params.push(enumValue(filter.priority, TASK_PRIORITIES, "priority"));
    }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const limit = clampLimit(filter.limit, DEFAULT_TASK_LIMIT, MAX_TASK_LIMIT);
    const rows = (
      this.db
        .prepare(
          `SELECT t.* FROM tasks t ${joins.join(" ")} ${clause}
           ORDER BY t.position ASC, t.createdAt ASC LIMIT ?`,
        )
        .all(...params, limit) as object[]
    ).map((r) => plain<Task>(r));
    return this.withLabels(rows);
  }

  /**
   * Like listTasks, but attaches lightweight structural stats (batched, no N+1):
   * the number of subtasks and how many of them are done, plus the number of open
   * blockers (blockedBy dependencies whose blocking task is not done). For the
   * List/Kanban views.
   */
  listTasksWithMeta(filter: Parameters<Repo["listTasks"]>[0]): TaskListItem[] {
    const tasks = this.listTasks(filter);
    const ids = tasks.map((t) => t.id);
    if (ids.length === 0) return [];
    const ph = ids.map(() => "?").join(",");

    const children = new Map<string, { total: number; done: number }>();
    for (const r of this.db
      .prepare(
        `SELECT parentTaskId AS pid,
                COUNT(*) AS total,
                SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done
           FROM tasks WHERE parentTaskId IN (${ph}) GROUP BY parentTaskId`,
      )
      .all(...ids) as { pid: string; total: number; done: number }[]) {
      children.set(r.pid, { total: r.total, done: r.done });
    }

    const openBlockers = new Map<string, number>();
    for (const r of this.db
      .prepare(
        `SELECT d.taskId AS tid, COUNT(*) AS open
           FROM task_deps d JOIN tasks b ON b.id = d.blockedByTaskId
          WHERE d.taskId IN (${ph}) AND b.status != 'done'
          GROUP BY d.taskId`,
      )
      .all(...ids) as { tid: string; open: number }[]) {
      openBlockers.set(r.tid, r.open);
    }

    return tasks.map((t) => {
      const c = children.get(t.id);
      return {
        ...t,
        childCount: c?.total ?? 0,
        childDoneCount: c?.done ?? 0,
        openBlockerCount: openBlockers.get(t.id) ?? 0,
      };
    });
  }

  /**
   * Global full-text search (plain case-insensitive LIKE) over title+description.
   * Optionally scoped to a single solution. Returns tasks with their context
   * (solution/project/milestone) so the agent does not have to list per project
   * and grep mentally. Wildcards in the query are escaped.
   */
  searchTasks(query: string, scope?: { solutionId?: string }): TaskWithContext[] {
    const q = requireString(query, "q").toLowerCase();
    const like = `%${q.replace(/[\\%_]/g, (c) => "\\" + c)}%`;
    // Scoped key: force the solution scope (override any caller-supplied value).
    const scopedSolution = this.scopedSolutionId();
    if (scopedSolution) scope = { solutionId: scopedSolution };
    const where = [
      `(LOWER(t.title) LIKE ? ESCAPE '\\' OR LOWER(t.description) LIKE ? ESCAPE '\\')`,
    ];
    const params: string[] = [like, like];
    if (scope?.solutionId) {
      where.push(`cl.id = ?`);
      params.push(scope.solutionId);
    }
    const rows = this.db
      .prepare(
        `SELECT ${TASK_CTX_SELECT} WHERE ${where.join(" AND ")}
         ORDER BY t.updatedAt DESC LIMIT 50`,
      )
      .all(...params) as unknown as CtxRow[];
    return this.withLabels(rows.map(toTaskWithContext));
  }

  getTask(id: string): Task | null {
    const row = this.db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id);
    if (!row) return null;
    // Scoped key: reading a task outside the key's solution -> 403. Guard only when
    // a scoped key is in context (internal callers run without one, so this is a no-op
    // for them and for admin/anonymous/unscoped requests).
    if (this.scopedSolutionId()) this.assertScope(this.solutionIdForTask(id) ?? undefined);
    return this.withLabels([plain<Task>(row)])[0];
  }

  createTask(input: CreateTaskInput): Task {
    return this.transaction(() => this.insertTask(input));
  }

  /** Bulk create in ONE transaction: an error on any element rolls back the whole
   *  batch (all-or-nothing), so the agent is not left with partially created tasks. */
  createTasks(inputs: CreateTaskInput[]): Task[] {
    checkBulk(inputs, "tasks");
    return this.transaction(() => inputs.map((i) => this.insertTask(i)));
  }

  private insertTask(input: CreateTaskInput): Task {
    const milestoneId = requireString(input.milestoneId, "milestoneId");
    // Scoped key: the parent milestone must live in the key's solution.
    if (this.scopedSolutionId()) this.assertScope(this.solutionIdForMilestone(milestoneId));
    if (!this.getMilestone(milestoneId)) throw notFound("milestone");

    // Idempotency: a retry with the same clientRequestId returns the existing task.
    const clientRequestId = optionalString(
      input.clientRequestId,
      "clientRequestId",
    );
    if (clientRequestId) {
      const dup = this.db
        .prepare(`SELECT * FROM tasks WHERE clientRequestId = ?`)
        .get(clientRequestId);
      if (dup) return this.withLabels([plain<Task>(dup)])[0];
    }

    const title = requireString(input.title, "title");
    const description = optionalString(input.description, "description") ?? "";
    const status =
      input.status !== undefined
        ? enumValue(input.status, TASK_STATUSES, "status")
        : "todo";
    const priority =
      input.priority !== undefined
        ? enumValue(input.priority, TASK_PRIORITIES, "priority")
        : "none";
    const position =
      optionalNumber(input.position, "position") ??
      this.scalar(
        `SELECT COALESCE(MAX(position), -1) + 1 AS n FROM tasks WHERE milestoneId = ?`,
        [milestoneId],
      );
    const parentTaskId = optionalString(input.parentTaskId, "parentTaskId") ?? null;
    if (parentTaskId && !this.getTask(parentTaskId)) throw notFound("parent task");
    const verified = input.verified === true ? 1 : 0;
    const blockerType =
      input.blockerType
        ? enumValue(input.blockerType, BLOCKER_TYPES, "blockerType")
        : null;
    const id = genId(ID_PREFIX.task);
    const ts = now();
    // Auto-claim: the creator (by key) becomes the task owner.
    const ownerActorId = currentActorId() ?? null;
    // A task created directly as 'done' gets completedAt = now.
    const completedAt = status === "done" ? ts : null;
    this.db
      .prepare(
        `INSERT INTO tasks
          (id, milestoneId, title, description, status, priority, position, clientRequestId, ownerActorId, parentTaskId, verified, blockerType, completedAt, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        milestoneId,
        title,
        description,
        status,
        priority,
        position,
        clientRequestId ?? null,
        ownerActorId,
        parentTaskId,
        verified,
        blockerType,
        completedAt,
        ts,
        ts,
      );
    if (input.labels) this.setLabels(id, input.labels);
    if (input.blockedBy) this.setDeps(id, input.blockedBy);
    if (input.relatedTo) this.setRelated(id, input.relatedTo);
    if (input.artifacts) this.setArtifacts(id, input.artifacts);
    this.recordActivity("task", id, "create", title, this.solutionIdForTask(id));
    this.syncContainerStatus(milestoneId); // a new task may open/close the milestone
    return this.getTask(id)!;
  }

  updateTask(id: string, input: UpdateTaskInput): Task {
    return this.transaction(() => this.applyUpdate(id, input));
  }

  /** Bulk update of tasks in ONE transaction (all-or-nothing) - e.g. archiving
   *  many at once. Each element is {id, ...patch}. */
  updateTasks(items: TaskBulkUpdate[]): Task[] {
    checkBulk(items, "task updates");
    return this.transaction(() =>
      items.map(({ id, ...patch }) => this.applyUpdate(id, patch)),
    );
  }

  private applyUpdate(id: string, input: UpdateTaskInput): Task {
    const existing = this.getTask(id);
    if (!existing) throw notFound("task");
    // Scoped key: may only touch a task in its own solution.
    if (this.scopedSolutionId()) this.assertScope(this.solutionIdForTask(id));
    const milestoneId =
      input.milestoneId !== undefined
        ? requireString(input.milestoneId, "milestoneId")
        : existing.milestoneId;
    if (input.milestoneId !== undefined && !this.getMilestone(milestoneId)) {
      throw notFound("milestone");
    }
    // Moving a task: the destination milestone must also live in the key's solution
    // (otherwise a scoped key could shove a task into another solution).
    if (this.scopedSolutionId() && input.milestoneId !== undefined) {
      this.assertScope(this.solutionIdForMilestone(milestoneId));
    }
    const title =
      input.title !== undefined
        ? requireString(input.title, "title")
        : existing.title;
    const description =
      input.description !== undefined
        ? (optionalString(input.description, "description") ?? "")
        : existing.description;
    const status =
      input.status !== undefined
        ? enumValue(input.status, TASK_STATUSES, "status")
        : existing.status;
    const priority =
      input.priority !== undefined
        ? enumValue(input.priority, TASK_PRIORITIES, "priority")
        : existing.priority;
    const position =
      optionalNumber(input.position, "position") ?? existing.position;
    const verified =
      input.verified !== undefined
        ? input.verified === true
          ? 1
          : 0
        : existing.verified
          ? 1
          : 0;
    const blockerType =
      input.blockerType !== undefined
        ? input.blockerType
          ? enumValue(input.blockerType, BLOCKER_TYPES, "blockerType")
          : null
        : // Leaving 'blocked' clears the blocker type (a type on a non-blocked
          // task is misleading); when it stays blocked - keep the existing one.
          status !== "blocked"
          ? null
          : existing.blockerType;

    // Parent (subtasks): validate existence + no cycle.
    let parentTaskId = existing.parentTaskId;
    if (input.parentTaskId !== undefined) {
      const next = input.parentTaskId || null;
      if (next) {
        if (next === id) throw unprocessable("A task cannot be its own parent");
        if (!this.getTask(next)) throw notFound("parent task");
        if (this.isAncestor(id, next)) {
          throw unprocessable("Cycle: the given parent is a descendant of this task");
        }
      }
      parentTaskId = next;
    }

    // Owner: explicit override, otherwise auto-claim by the first actor with a key.
    let ownerActorId = existing.ownerActorId;
    if (input.ownerActorId !== undefined) {
      ownerActorId = input.ownerActorId || null;
    } else if (!ownerActorId) {
      ownerActorId = currentActorId() ?? null;
    }

    // Contract: transitioning into 'blocked' requires a reason, otherwise it is
    // unclear what unblocks it. We accept a provided `reason` (saved as a comment)
    // or an already existing comment on the task.
    const reason = optionalString(input.reason, "reason");
    const enteringBlocked = status === "blocked" && existing.status !== "blocked";
    if (enteringBlocked && !reason && this.listComments(id).length === 0) {
      throw unprocessable(
        'Status "blocked" requires a reason: provide a "reason" field or first add a comment explaining what should unblock it',
      );
    }

    // completedAt: marker of entering 'done' (source of "TODAY" on the scoreboard).
    // Entering 'done' from another status -> stamp now. Leaving 'done' -> NULL.
    // Staying 'done' (e.g. editing the title) -> no change (idempotent).
    const ts = now();
    let completedAt = existing.completedAt ?? null;
    if (status === "done" && existing.status !== "done") completedAt = ts;
    // 'closed' is a terminal/archival status (on par with 'done' in
    // autoCompleteParent), so done -> closed does NOT clear the marker - otherwise
    // we lose the completion history. We clear it only when returning to a truly
    // OPEN status (not 'done' and not 'closed').
    else if (status !== "done" && status !== "closed" && existing.status === "done")
      completedAt = null;

    this.db
      .prepare(
        `UPDATE tasks SET milestoneId = ?, title = ?, description = ?, status = ?,
          priority = ?, position = ?, ownerActorId = ?, parentTaskId = ?,
          verified = ?, blockerType = ?, completedAt = ?, updatedAt = ? WHERE id = ?`,
      )
      .run(milestoneId, title, description, status, priority, position, ownerActorId, parentTaskId, verified, blockerType, completedAt, ts, id);

    if (input.labels !== undefined) this.setLabels(id, input.labels);
    if (input.blockedBy !== undefined) this.setDeps(id, input.blockedBy);
    if (input.relatedTo !== undefined) this.setRelated(id, input.relatedTo);
    if (input.artifacts !== undefined) this.setArtifacts(id, input.artifacts);
    if (reason) {
      this.createComment(id, {
        author: optionalString(input.reasonAuthor, "reasonAuthor") ?? "",
        body: reason,
      });
    }
    if (status !== existing.status) {
      this.recordActivity(
        "task",
        id,
        "status",
        `${existing.status} -> ${status}`,
        this.solutionIdForTask(id),
      );
    }
    // Rollup upward: when a subtask enters a terminal state (done/closed) and all
    // its siblings are terminal too, the parent closes automatically.
    if ((status === "done" || status === "closed") && status !== existing.status) {
      this.autoCompleteParent(parentTaskId);
    }
    // Container auto-status: 100% of tasks (0 open, >=1 done) -> milestone/project
    // 'done'; reopen -> back to 'active'. Also the old milestone (when the task changed milestone).
    this.syncContainerStatus(milestoneId);
    if (existing.milestoneId !== milestoneId) {
      this.syncContainerStatus(existing.milestoneId);
    }
    return this.getTask(id)!;
  }

  deleteTask(id: string): void {
    const solutionId = this.solutionIdForTask(id);
    // Scoped key: may only delete a task in its own solution.
    if (this.scopedSolutionId()) this.assertScope(solutionId ?? undefined);
    const ms = this.db
      .prepare(`SELECT milestoneId AS m FROM tasks WHERE id = ?`)
      .get(id) as { m: string } | undefined;
    // Orphaned subtasks lose their parent (they stay, we do not cascade-delete them).
    this.db.prepare(`UPDATE tasks SET parentTaskId = NULL WHERE parentTaskId = ?`).run(id);
    const res = this.db.prepare(`DELETE FROM tasks WHERE id = ?`).run(id);
    if (res.changes === 0) throw notFound("task");
    this.recordActivity("task", id, "delete", "", solutionId);
    this.syncContainerStatus(ms?.m); // deleting a task may close the milestone/project
  }

  /** Container auto-status after task changes: a milestone/project with 0 open and
   *  >=1 'done' gets status 'done'; conversely it returns from 'done' to 'active'.
   *  paused/archived are LEFT UNTOUCHED (deliberate manual overrides). */
  private syncContainerStatus(milestoneId: string | null | undefined): void {
    if (!milestoneId) return;
    this.autoStatusFor("milestones", milestoneId, () => {
      const r = this.db
        .prepare(
          `SELECT
             SUM(CASE WHEN status='done' THEN 1 ELSE 0 END) AS d,
             SUM(CASE WHEN status IN (${OPEN_STATUSES}) THEN 1 ELSE 0 END) AS o
           FROM tasks WHERE milestoneId = ?`,
        )
        .get(milestoneId) as { d: number | null; o: number | null };
      return { d: r.d ?? 0, o: r.o ?? 0 };
    });
    const proj = this.db
      .prepare(`SELECT projectId AS p FROM milestones WHERE id = ?`)
      .get(milestoneId) as { p: string } | undefined;
    if (proj?.p) {
      const pid = proj.p;
      this.autoStatusFor("projects", pid, () => {
        const r = this.db
          .prepare(
            `SELECT
               SUM(CASE WHEN t.status='done' THEN 1 ELSE 0 END) AS d,
               SUM(CASE WHEN t.status IN (${OPEN_STATUSES}) THEN 1 ELSE 0 END) AS o
             FROM tasks t JOIN milestones m ON t.milestoneId = m.id WHERE m.projectId = ?`,
          )
          .get(pid) as { d: number | null; o: number | null };
        return { d: r.d ?? 0, o: r.o ?? 0 };
      });
    }
  }

  private autoStatusFor(
    table: "milestones" | "projects",
    id: string,
    counts: () => { d: number; o: number },
  ): void {
    const cur = this.db
      .prepare(`SELECT status AS s FROM ${table} WHERE id = ?`)
      .get(id) as { s: string } | undefined;
    if (!cur || (cur.s !== "active" && cur.s !== "done")) return; // paused/archived untouched
    const { d, o } = counts();
    const target = d > 0 && o === 0 ? "done" : "active";
    if (target !== cur.s) {
      this.db
        .prepare(`UPDATE ${table} SET status = ?, updatedAt = ? WHERE id = ?`)
        .run(target, now(), id);
    }
  }

  // --- subtasks, dependencies, labels (Stream B) ---

  /** Whether `ancestorId` is an ancestor of `taskId` (walking up via parentTaskId). */
  private isAncestor(ancestorId: string, taskId: string): boolean {
    let cur: string | null = taskId;
    const seen = new Set<string>();
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      const row = this.db
        .prepare(`SELECT parentTaskId AS p FROM tasks WHERE id = ?`)
        .get(cur) as { p: string | null } | undefined;
      cur = row?.p ?? null;
      if (cur === ancestorId) return true;
    }
    return false;
  }

  /** Sets the entire set of labels for a task (replaces existing ones). */
  setLabels(taskId: string, labels: string[]): void {
    if (!this.getTask(taskId)) throw notFound("task");
    const clean = Array.from(
      new Set(labels.map((l) => requireString(l, "label").toLowerCase())),
    );
    this.db.prepare(`DELETE FROM task_labels WHERE taskId = ?`).run(taskId);
    const ins = this.db.prepare(
      `INSERT OR IGNORE INTO task_labels (taskId, label) VALUES (?, ?)`,
    );
    for (const label of clean) ins.run(taskId, label);
  }

  /** Sets the entire set of dependencies (blockedBy). Validates existence and no self. */
  setDeps(taskId: string, blockedByIds: string[]): void {
    if (!this.getTask(taskId)) throw notFound("task");
    const clean = Array.from(new Set(blockedByIds.map((d) => requireString(d, "blockedBy"))));
    for (const dep of clean) {
      if (dep === taskId) throw unprocessable("A task cannot depend on itself");
      if (!this.getTask(dep)) throw notFound("blockedBy task");
    }
    this.db.prepare(`DELETE FROM task_deps WHERE taskId = ?`).run(taskId);
    const ins = this.db.prepare(
      `INSERT OR IGNORE INTO task_deps (taskId, blockedByTaskId) VALUES (?, ?)`,
    );
    for (const dep of clean) ins.run(taskId, dep);
  }

  /** Sets the entire set of soft links (relatedTo) for a task. Symmetric: the pair
   *  is stored normalized (a<b) and read in both directions. Replaces all links
   *  touching this task. */
  setRelated(taskId: string, relatedIds: string[]): void {
    if (!this.getTask(taskId)) throw notFound("task");
    const clean = Array.from(
      new Set(relatedIds.map((d) => requireString(d, "relatedTo"))),
    );
    for (const rid of clean) {
      if (rid === taskId) throw unprocessable("A task cannot be related to itself");
      if (!this.getTask(rid)) throw notFound("relatedTo task");
    }
    this.db
      .prepare(`DELETE FROM task_links WHERE taskId = ? OR relatedTaskId = ?`)
      .run(taskId, taskId);
    const ins = this.db.prepare(
      `INSERT OR IGNORE INTO task_links (taskId, relatedTaskId) VALUES (?, ?)`,
    );
    for (const rid of clean) {
      const [a, b] = taskId < rid ? [taskId, rid] : [rid, taskId];
      ins.run(a, b);
    }
  }

  /** Sets the entire set of artifacts for a task (replaces existing ones). */
  setArtifacts(taskId: string, artifacts: ArtifactInput[]): void {
    if (!this.getTask(taskId)) throw notFound("task");
    checkBulk(artifacts, "artifacts");
    this.db.prepare(`DELETE FROM task_artifacts WHERE taskId = ?`).run(taskId);
    const ins = this.db.prepare(
      `INSERT INTO task_artifacts (id, taskId, kind, value, label, createdAt) VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const ts = now();
    for (const a of artifacts) {
      const value = requireString(a.value, "artifact.value");
      if (value.length > MAX_ARTIFACT_VALUE) {
        throw unprocessable(
          `artifact.value too long: ${value.length} > ${MAX_ARTIFACT_VALUE}`,
        );
      }
      const kind = a.kind ? enumValue(a.kind, ARTIFACT_KINDS, "artifact.kind") : "url";
      const label = optionalString(a.label, "artifact.label") ?? "";
      ins.run(genId(ID_PREFIX.artifact), taskId, kind, value, label, ts);
    }
  }

  /** Task artifacts (sorted by time added). */
  private artifactsFor(taskId: string): TaskArtifact[] {
    return (
      this.db
        .prepare(`SELECT * FROM task_artifacts WHERE taskId = ? ORDER BY createdAt ASC`)
        .all(taskId) as object[]
    ).map((r) => plain<TaskArtifact>(r));
  }

  /** Ids of related tasks (relatedTo) - read in both directions. */
  private relatedIdsFor(taskId: string): string[] {
    const rows = this.db
      .prepare(
        `SELECT relatedTaskId AS rid FROM task_links WHERE taskId = ?
         UNION
         SELECT taskId AS rid FROM task_links WHERE relatedTaskId = ?`,
      )
      .all(taskId, taskId) as { rid: string }[];
    return rows.map((r) => r.rid);
  }

  private taskRefs(ids: string[]): TaskRef[] {
    if (ids.length === 0) return [];
    const ph = ids.map(() => "?").join(",");
    return (
      this.db
        .prepare(`SELECT id, title, status FROM tasks WHERE id IN (${ph})`)
        .all(...ids) as object[]
    ).map((r) => plain<TaskRef>(r));
  }

  /** A parent closes when all of its subtasks are terminal (done or closed),
   *  recursively upward. When there is real work (anything done) -> the parent
   *  is 'done'; when the whole subset is only closed (descoped) -> 'closed'. */
  private autoCompleteParent(parentTaskId: string | null): void {
    let parent = parentTaskId;
    const seen = new Set<string>();
    while (parent && !seen.has(parent)) {
      seen.add(parent);
      const p = this.getTask(parent);
      if (!p || p.status === "done" || p.status === "closed") break;
      const children = this.listTasks({ parentTaskId: parent });
      const allTerminal =
        children.length > 0 &&
        children.every((c) => c.status === "done" || c.status === "closed");
      if (!allTerminal) break;
      const next = children.some((c) => c.status === "done") ? "done" : "closed";
      // Closing the parent as 'done' also stamps completedAt (for "TODAY").
      const ts = now();
      this.db
        .prepare(
          `UPDATE tasks SET status = ?, completedAt = ?, updatedAt = ? WHERE id = ?`,
        )
        .run(next, next === "done" ? ts : null, ts, parent);
      this.recordActivity(
        "task",
        parent,
        "status",
        `${p.status} -> ${next} (auto: all subtasks ${next === "done" ? "done" : "closed"})`,
        this.solutionIdForTask(parent),
      );
      parent = p.parentTaskId;
    }
  }

  /** Details: task + dependencies + subtasks + rollup of subtask progress. */
  getTaskDetail(id: string): TaskDetail | null {
    const task = this.getTask(id);
    if (!task) return null;
    const depIds = (
      this.db
        .prepare(`SELECT blockedByTaskId AS d FROM task_deps WHERE taskId = ?`)
        .all(id) as { d: string }[]
    ).map((r) => r.d);
    const children = this.listTasks({ parentTaskId: id });
    const counts = emptyStatusCounts();
    for (const c of children) counts[c.status]++;
    return {
      ...task,
      blockedBy: this.taskRefs(depIds),
      relatedTo: this.taskRefs(this.relatedIdsFor(id)),
      children: children.map((c) => ({ id: c.id, title: c.title, status: c.status })),
      childCount: children.length,
      childStatusCounts: counts,
      childProgress: progressFromCounts(counts),
      artifacts: this.artifactsFor(id),
    };
  }

  // --- comments ---

  listComments(taskId: string): Comment[] {
    // Scoped key: only comments on a task in the key's solution. Guarded inside the
    // scoped-key branch so the (frequent) internal calls and admin/anonymous reads
    // stay free of the extra lookup.
    if (this.scopedSolutionId()) this.assertScope(this.solutionIdForTask(taskId) ?? undefined);
    return (
      this.db
        .prepare(`SELECT * FROM comments WHERE taskId = ? ORDER BY createdAt ASC`)
        .all(taskId) as object[]
    ).map((r) => plain<Comment>(r));
  }

  createComment(taskId: string, input: CreateCommentInput): Comment {
    return this.transaction(() => {
      if (!this.getTask(taskId)) throw notFound("task");
      // Scoped key: may only comment on a task in its own solution.
      if (this.scopedSolutionId()) this.assertScope(this.solutionIdForTask(taskId) ?? undefined);
      const body = requireString(input.body, "body");
      const author = optionalString(input.author, "author") ?? "";
      const id = genId(ID_PREFIX.comment);
      const ts = now();
      this.db
        .prepare(
          `INSERT INTO comments (id, taskId, author, body, createdAt) VALUES (?, ?, ?, ?, ?)`,
        )
        .run(id, taskId, author, body, ts);
      this.recordActivity(
        "task",
        taskId,
        "comment",
        body.length > 80 ? body.slice(0, 77) + "..." : body,
        this.solutionIdForTask(taskId),
      );
      const row = this.db.prepare(`SELECT * FROM comments WHERE id = ?`).get(id);
      if (!row) throw new AppError(500, "Comment vanished after insert");
      return plain<Comment>(row);
    });
  }

  deleteComment(id: string): void {
    if (this.scopedSolutionId()) this.assertScope(this.solutionIdForComment(id));
    const res = this.db.prepare(`DELETE FROM comments WHERE id = ?`).run(id);
    if (res.changes === 0) throw notFound("comment");
  }

  // --- identity, keys and audit (Stream C) ---

  /** Writes to the audit log. actorId is taken from the request context (x-api-key). */
  private recordActivity(
    entityType: string,
    entityId: string,
    action: string,
    summary: string,
    solutionId: string | null,
  ): void {
    this.db
      .prepare(
        `INSERT INTO activity (id, actorId, entityType, entityId, action, summary, solutionId, at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        genId(ID_PREFIX.activity),
        currentActorId() ?? null,
        entityType,
        entityId,
        action,
        summary,
        solutionId,
        now(),
      );
  }

  /** A task's solutionId (via milestone->project). null when the path is gone. */
  private solutionIdForTask(taskId: string): string | null {
    const row = this.db
      .prepare(
        `SELECT pr.solutionId AS sid FROM tasks t
         JOIN milestones ms ON t.milestoneId = ms.id
         JOIN projects pr ON ms.projectId = pr.id
         WHERE t.id = ?`,
      )
      .get(taskId) as { sid: string } | undefined;
    return row?.sid ?? null;
  }

  listActivity(
    filter: {
      solutionId?: string;
      entityId?: string;
      actorId?: string;
      limit?: number;
    } = {},
  ): Activity[] {
    // Scoped key: force the solution filter so the audit log of another solution
    // is not enumerable (override a different caller-supplied value).
    const scoped = this.scopedSolutionId();
    if (scoped) filter = { ...filter, solutionId: scoped };
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (filter.solutionId) {
      where.push(`solutionId = ?`);
      params.push(filter.solutionId);
    }
    if (filter.entityId) {
      where.push(`entityId = ?`);
      params.push(filter.entityId);
    }
    if (filter.actorId) {
      where.push(`actorId = ?`);
      params.push(filter.actorId);
    }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const limit = Math.min(
      Math.max(Number.isFinite(filter.limit) ? (filter.limit as number) : 50, 1),
      200,
    );
    return (
      this.db
        .prepare(`SELECT * FROM activity ${clause} ORDER BY at DESC LIMIT ?`)
        .all(...params, limit) as object[]
    ).map((r) => plain<Activity>(r));
  }

  // --- actors ---

  createActor(input: CreateActorInput): Actor {
    return this.transaction(() => {
      const name = requireString(input.name, "name");
      const kind: ActorKind =
        input.kind !== undefined ? enumValue(input.kind, ACTOR_KINDS, "kind") : "agent";
      const id = genId(ID_PREFIX.actor);
      this.db
        .prepare(
          `INSERT INTO actors (id, kind, name, createdByKeyId, archivedAt, createdAt)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(id, kind, name, currentContext().keyId ?? null, null, now());
      this.recordActivity("actor", id, "create", `${kind}: ${name}`, null);
      return this.getActor(id)!;
    });
  }

  getActor(id: string): Actor | null {
    const row = this.db.prepare(`SELECT * FROM actors WHERE id = ?`).get(id);
    return row ? plain<Actor>(row) : null;
  }

  listActors(): Actor[] {
    return (
      this.db.prepare(`SELECT * FROM actors ORDER BY createdAt ASC`).all() as object[]
    ).map((r) => plain<Actor>(r));
  }

  archiveActor(id: string): Actor {
    if (!this.getActor(id)) throw notFound("actor");
    this.db.prepare(`UPDATE actors SET archivedAt = ? WHERE id = ?`).run(now(), id);
    return this.getActor(id)!;
  }

  // --- api keys ---

  /** Key row -> public shape (WITHOUT secretHash). */
  private toPublicKey(row: ApiKey & { secretHash?: string }): ApiKey {
    return {
      id: row.id,
      actorId: row.actorId,
      solutionId: row.solutionId ?? null,
      name: row.name,
      prefix: row.prefix,
      scope: row.scope,
      expiresAt: row.expiresAt ?? null,
      createdByKeyId: row.createdByKeyId ?? null,
      lastUsedAt: row.lastUsedAt ?? null,
      revokedAt: row.revokedAt ?? null,
      createdAt: row.createdAt,
    };
  }

  /**
   * Creates an API key. Provide `actorId` (existing) OR `actorName` (creates a
   * new agent). The secret is hashed; the full token is returned ONCE. When
   * called within a key context (delegation), records createdByKeyId.
   */
  createApiKey(input: CreateApiKeyInput): ApiKeyWithSecret {
    let actorId = optionalString(input.actorId, "actorId");
    if (actorId) {
      if (!this.getActor(actorId)) throw notFound("actor");
    } else {
      const actorName = requireString(
        input.actorName,
        "actorName (or actorId)",
      );
      actorId = this.createActor({ kind: "agent", name: actorName }).id;
    }
    const solutionId = optionalString(input.solutionId, "solutionId") ?? null;
    if (solutionId && !this.getSolution(solutionId)) throw notFound("solution");
    const scope: KeyScope =
      input.scope !== undefined ? enumValue(input.scope, KEY_SCOPES, "scope") : "write";

    let expiresAt: string | null = optionalString(input.expiresAt, "expiresAt") ?? null;
    if (expiresAt) {
      // Normalize to canonical ISO so the lexicographic expiry/delegation
      // comparisons (expiresAt <= now, child > parent) are sound. Reject garbage.
      const d = new Date(expiresAt);
      if (isNaN(d.getTime())) throw unprocessable(`Field "expiresAt" must be a valid date`);
      expiresAt = d.toISOString();
    }
    if (!expiresAt && typeof input.ttlSeconds === "number") {
      expiresAt = new Date(Date.now() + input.ttlSeconds * 1000).toISOString();
    }

    // Delegation cannot widen permissions: a child key minted by a parent key
    // cannot exceed its scope/solution/lifetime.
    const callerKeyId = currentContext().keyId;
    if (callerKeyId) {
      const parent = this.getApiKey(callerKeyId);
      if (parent) {
        if (parent.scope === "read" && scope === "write") {
          throw new AppError(403, "A read key cannot create a write key");
        }
        if (parent.solutionId && solutionId !== parent.solutionId) {
          throw new AppError(
            403,
            "A solution-scoped key cannot create a key outside that solution",
          );
        }
        // the child's lifetime does not exceed the parent's (hard clamp)
        if (parent.expiresAt && (!expiresAt || expiresAt > parent.expiresAt)) {
          expiresAt = parent.expiresAt;
        }
      }
    }

    const { prefix, token, secretHash } = generateKey();
    const id = genId(ID_PREFIX.apiKey);
    this.db
      .prepare(
        `INSERT INTO api_keys
          (id, actorId, solutionId, name, prefix, secretHash, scope, expiresAt, createdByKeyId, lastUsedAt, revokedAt, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        actorId,
        solutionId,
        optionalString(input.name, "name") ?? "",
        prefix,
        secretHash,
        scope,
        expiresAt,
        currentContext().keyId ?? null,
        null,
        null,
        now(),
      );
    this.recordActivity("apikey", id, "create", `key ${prefix} (${scope})`, solutionId);
    const created = this.getApiKey(id)!;
    return { ...created, token };
  }

  getApiKey(id: string): ApiKey | null {
    const row = this.db
      .prepare(`SELECT ${API_KEY_PUBLIC_COLS} FROM api_keys WHERE id = ?`)
      .get(id);
    return row ? this.toPublicKey(plain(row)) : null;
  }

  listApiKeys(filter: { actorId?: string; solutionId?: string } = {}): ApiKey[] {
    // A solution-scoped key may only see keys of its own solution (admin/anonymous
    // operator and unscoped keys are unrestricted). Force the filter to the key's
    // solution, overriding any caller-supplied value.
    const scoped = this.scopedSolutionId();
    if (scoped) filter = { ...filter, solutionId: scoped };
    const where: string[] = [];
    const params: string[] = [];
    if (filter.actorId) {
      where.push(`actorId = ?`);
      params.push(filter.actorId);
    }
    if (filter.solutionId) {
      where.push(`solutionId = ?`);
      params.push(filter.solutionId);
    }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    return (
      this.db
        .prepare(`SELECT ${API_KEY_PUBLIC_COLS} FROM api_keys ${clause} ORDER BY createdAt DESC`)
        .all(...params) as object[]
    ).map((r) => this.toPublicKey(plain(r)));
  }

  revokeApiKey(id: string): ApiKey {
    const existing = this.getApiKey(id);
    if (!existing) throw notFound("apiKey");
    // Authorization: admin, anonymous local operator (open mode; in strict mode
    // route() already filters out keyless), the key itself, the delegation parent,
    // or the owner (the same actor). Otherwise 403.
    const ctx = currentContext();
    const authorized =
      ctx.admin === true ||
      (!ctx.keyId && !ctx.actorId) ||
      ctx.keyId === existing.id ||
      (!!existing.createdByKeyId && existing.createdByKeyId === ctx.keyId) ||
      (!!existing.actorId && existing.actorId === ctx.actorId);
    if (!authorized) {
      throw new AppError(403, "Not authorized to revoke this key");
    }
    this.db.prepare(`UPDATE api_keys SET revokedAt = ? WHERE id = ?`).run(now(), id);
    this.recordActivity("apikey", id, "revoke", existing.prefix, existing.solutionId);
    return this.getApiKey(id)!;
  }

  /**
   * Resolves an x-api-key token to an identity. null when there is no match
   * (bad prefix/secret). Throws 401 when the key is revoked or expired. Updates
   * lastUsedAt on a hit.
   */
  resolveApiKey(token: string): {
    actorId: string;
    keyId: string;
    solutionId: string | null;
    scope: KeyScope;
  } | null {
    const parts = splitToken(token);
    if (!parts) return null;
    const row = this.db
      .prepare(`SELECT * FROM api_keys WHERE prefix = ?`)
      .get(parts.prefix) as
      | (ApiKey & { secretHash: string })
      | undefined;
    if (!row) return null;
    // We check the secret BEFORE the key state, so the (public) prefix alone does
    // not reveal the existence/state of a key (revoked/expired) to someone without
    // the secret.
    if (!secretMatches(parts.secret, row.secretHash)) return null;
    if (row.revokedAt) throw new AppError(401, "API key has been revoked");
    if (row.expiresAt && row.expiresAt <= now()) {
      throw new AppError(401, "API key has expired");
    }
    // Throttle the lastUsedAt write: only refresh it when it is null or older than
    // ~60s, so a stream of authenticated GETs does not write on every request.
    const nowIso = now();
    const stale =
      !row.lastUsedAt || Date.now() - new Date(row.lastUsedAt).getTime() >= 60_000;
    if (stale) {
      this.db.prepare(`UPDATE api_keys SET lastUsedAt = ? WHERE id = ?`).run(nowIso, row.id);
    }
    return {
      actorId: row.actorId,
      keyId: row.id,
      solutionId: row.solutionId ?? null,
      scope: row.scope,
    };
  }

  // --- polling sync (fs_changes_since) ---

  /**
   * Returns the raw rows changed (updatedAt) or created (comments: createdAt)
   * AFTER the given `since`. The client passes empty / epoch on the first call,
   * and `serverTime` from the previous response on subsequent calls - this lets
   * it see what changed in the dashboard between its calls (manually via UI/curl
   * or by another agent).
   *
   * An invalid / empty `since` -> treated as the epoch (full snapshot).
   * Buckets are sorted ascending by timestamp so the client can process them in
   * order of occurrence.
   *
   * The boundary is INCLUSIVE (>=) so a change in the same millisecond as
   * `serverTime` is not lost on the next poll. In exchange a boundary row may
   * appear twice - the delta is IDEMPOTENT, the client should dedupe by `id`
   * (it fetches the fresh entity state anyway).
   */
  changesSince(since: string): ChangesSincePayload {
    const sinceIso = normalizeSince(since);
    const serverTime = now();
    // Per-bucket LIMIT so a client sending the epoch (full snapshot) cannot dump the
    // whole DB unbounded. Buckets stay ordered ascending by timestamp, so a client
    // that hits the cap simply advances its `since` cursor and pages forward.
    const cap = MAX_CHANGES_PER_BUCKET;
    const solutions = this.db
      .prepare(`SELECT * FROM solutions WHERE updatedAt >= ? ORDER BY updatedAt ASC LIMIT ?`)
      .all(sinceIso, cap)
      .map((r) => plain<Solution>(r));
    const projects = this.db
      .prepare(`SELECT * FROM projects WHERE updatedAt >= ? ORDER BY updatedAt ASC LIMIT ?`)
      .all(sinceIso, cap)
      .map((r) => plain<Project>(r));
    const milestones = this.db
      .prepare(`SELECT * FROM milestones WHERE updatedAt >= ? ORDER BY updatedAt ASC LIMIT ?`)
      .all(sinceIso, cap)
      .map((r) => plain<Milestone>(r));
    const tasks = this.withLabels(
      this.db
        .prepare(`SELECT * FROM tasks WHERE updatedAt >= ? ORDER BY updatedAt ASC LIMIT ?`)
        .all(sinceIso, cap)
        .map((r) => plain<Task>(r)),
    );
    const comments = this.db
      .prepare(`SELECT * FROM comments WHERE createdAt >= ? ORDER BY createdAt ASC LIMIT ?`)
      .all(sinceIso, cap)
      .map((r) => plain<Comment>(r));
    return { since: sinceIso, serverTime, solutions, projects, milestones, tasks, comments };
  }

  // --- overview / dashboard ---

  /** Latest comment per task (one query) - used as the block reason. */
  private latestCommentBodies(taskIds: string[]): Map<string, string> {
    const m = new Map<string, string>();
    if (taskIds.length === 0) return m;
    const ph = taskIds.map(() => "?").join(",");
    const rows = this.db
      .prepare(
        `SELECT c.taskId AS taskId, c.body AS body
         FROM comments c
         JOIN (
           SELECT taskId, MAX(createdAt) AS mx
           FROM comments WHERE taskId IN (${ph}) GROUP BY taskId
         ) last ON c.taskId = last.taskId AND c.createdAt = last.mx`,
      )
      .all(...taskIds) as { taskId: string; body: string }[];
    for (const r of rows) m.set(r.taskId, r.body);
    return m;
  }

  private attentionTasks(solutionId?: string): AttentionTask[] {
    const solFilter = solutionId ? `cl.id = ? AND` : ``;
    const rows = this.db
      .prepare(
        `SELECT ${TASK_CTX_SELECT}
         WHERE ${solFilter} (t.status = 'blocked'
            OR (t.priority = 'urgent' AND t.status NOT IN ('done', 'closed')))
         ORDER BY
           CASE WHEN t.priority = 'urgent' THEN 0 ELSE 1 END,
           CASE WHEN t.status = 'blocked' THEN 0 ELSE 1 END,
           t.updatedAt DESC
         LIMIT 50`,
      )
      .all(...(solutionId ? [solutionId] : [])) as unknown as CtxRow[];
    const tasks = this.withLabels(rows.map(toTaskWithContext));
    // For blocked tasks attach the latest comment as `note` (the block reason).
    const notes = this.latestCommentBodies(
      tasks.filter((t) => t.status === "blocked").map((t) => t.id),
    );
    return tasks.map((t) =>
      t.status === "blocked" && notes.has(t.id)
        ? { ...t, note: notes.get(t.id) }
        : t,
    );
  }

  private recentTasks(limit = 12, solutionId?: string): TaskWithContext[] {
    const solWhere = solutionId ? `WHERE cl.id = ?` : ``;
    const params: (string | number)[] = solutionId ? [solutionId, limit] : [limit];
    const rows = this.db
      .prepare(
        `SELECT ${TASK_CTX_SELECT} ${solWhere} ORDER BY t.updatedAt DESC, t.rowid DESC LIMIT ?`,
      )
      .all(...params) as unknown as CtxRow[];
    return this.withLabels(rows.map(toTaskWithContext));
  }

  /** The N most recently changed tasks of a given solution (any status). t.rowid
   *  DESC is a deterministic tie-breaker when updatedAt is identical (e.g. a batch
   *  created in the same millisecond) - the most recently inserted wins. */
  private recentTasksForSolution(solutionId: string, limit = 5): TaskWithContext[] {
    const rows = this.db
      .prepare(
        `SELECT ${TASK_CTX_SELECT} WHERE cl.id = ?
         ORDER BY t.updatedAt DESC, t.rowid DESC LIMIT ?`,
      )
      .all(solutionId, limit) as unknown as CtxRow[];
    return this.withLabels(rows.map(toTaskWithContext));
  }

  /** Cumulative completion counters (for gamification). A milestone/project/solution
   *  counts as "done" when its status is done/archived OR it has tasks and none is
   *  open (todo/in_progress/blocked) with >=1 done (i.e. 100%).
   *  When `solutionId` is given (solution-scoped key), counters cover only that
   *  solution; otherwise they are global. */
  private completionCounts(solutionId?: string): DashboardPayload["completed"] {
    // Restrict the entity universe (the outer FROM) to the scoped solution. The
    // task tally is restricted via a join through projects to the same solution.
    const sid = solutionId ? [solutionId] : [];
    const tasksScope = solutionId
      ? `JOIN milestones m ON t.milestoneId = m.id
         JOIN projects p ON m.projectId = p.id WHERE p.solutionId = ?`
      : ``;
    const msWhere = solutionId
      ? `JOIN projects pr ON m.projectId = pr.id WHERE pr.solutionId = ? AND`
      : `WHERE`;
    const prWhere = solutionId ? `WHERE p.solutionId = ? AND` : `WHERE`;
    const slWhere = solutionId ? `WHERE s.id = ? AND` : `WHERE`;
    return {
      tasksDone: this.scalar(
        `SELECT COUNT(*) AS n FROM tasks t ${tasksScope} ${solutionId ? "AND" : "WHERE"} t.status='done'`,
        sid,
      ),
      milestonesDone: this.scalar(
        `SELECT COUNT(*) AS n FROM milestones m
         ${msWhere} (m.status IN ('done','archived')
            OR ${fullyDone(MILESTONE_SCOPE)})`,
        sid,
      ),
      projectsDone: this.scalar(
        `SELECT COUNT(*) AS n FROM projects p
         ${prWhere} (p.status IN ('done','archived')
            OR ${fullyDone(PROJECT_SCOPE)})`,
        sid,
      ),
      solutionsDone: this.scalar(
        `SELECT COUNT(*) AS n FROM solutions s
         ${slWhere} (s.status = 'archived'
            OR ${fullyDone(SOLUTION_SCOPE)})`,
        sid,
      ),
    };
  }

  /** A single `id` column as an array of strings. */
  private idList(sql: string, params: (string | number)[] = []): string[] {
    return (this.db.prepare(sql).all(...params) as { id: string }[]).map(
      (r) => r.id,
    );
  }

  /** Ids of milestones/projects/solutions currently "closed" (status done/archived
   *  OR 100% - the same rule as completionCounts). Low cardinality, so the client
   *  can diff the id sets between refreshes and know EXACTLY what just closed (for
   *  the "+1" animation from a specific row).
   *  When `solutionId` is given (solution-scoped key), only that solution's entities
   *  are listed; otherwise the result is global. */
  private completedIds(solutionId?: string): DashboardPayload["completedIds"] {
    const sid = solutionId ? [solutionId] : [];
    const msWhere = solutionId
      ? `JOIN projects pr ON m.projectId = pr.id WHERE pr.solutionId = ? AND`
      : `WHERE`;
    const prWhere = solutionId ? `WHERE p.solutionId = ? AND` : `WHERE`;
    const slWhere = solutionId ? `WHERE s.id = ? AND` : `WHERE`;
    return {
      milestones: this.idList(
        `SELECT m.id AS id FROM milestones m
         ${msWhere} (m.status IN ('done','archived')
            OR ${fullyDone(MILESTONE_SCOPE)})`,
        sid,
      ),
      projects: this.idList(
        `SELECT p.id AS id FROM projects p
         ${prWhere} (p.status IN ('done','archived')
            OR ${fullyDone(PROJECT_SCOPE)})`,
        sid,
      ),
      solutions: this.idList(
        `SELECT s.id AS id FROM solutions s
         ${slWhere} (s.status = 'archived'
            OR ${fullyDone(SOLUTION_SCOPE)})`,
        sid,
      ),
    };
  }

  /** Local start of today as ISO (UTC) - the "TODAY" boundary. The app is local
   *  (server tz == user tz), so we compute midnight in the server's local time and
   *  compare it with completedAt (stored as ISO/UTC). */
  private startOfTodayIso(nowDate = new Date()): string {
    const midnight = new Date(
      nowDate.getFullYear(),
      nowDate.getMonth(),
      nowDate.getDate(),
    );
    return midnight.toISOString();
  }

  /**
   * Authoritative "TODAY" counter for the scoreboard HUD - server-side, shared.
   *  - TASK: status='done' and completedAt >= start of today.
   *  - MILESTONE: currently closed (same rule as completedIds) and its closing
   *    time = MAX(completedAt of its tasks) >= today.
   *  - PROJECT: currently closed and MAX(completedAt of the whole project's tasks) today.
   * MAX(completedAt) is correct because a milestone/project closes together with
   *  its last task - which is exactly when it would "count" toward the scoreboard.
   */
  private completedToday(
    nowDate = new Date(),
    solutionId?: string,
  ): DashboardPayload["completedToday"] {
    const startIso = this.startOfTodayIso(nowDate);
    const maxDoneToday = (scope: string) =>
      `(SELECT MAX(t.completedAt) FROM tasks t ${scope} AND t.status='done') >= ?`;
    // Outer-entity scope for the solution-scoped key. The solution params come
    // first because they bind the leading WHERE clause; the startIso params bind
    // the trailing completedAt comparisons (placeholder order).
    const sid = solutionId ? [solutionId] : [];
    const taskSolJoin = solutionId
      ? `JOIN milestones m ON t.milestoneId = m.id
         JOIN projects p ON m.projectId = p.id WHERE p.solutionId = ? AND`
      : `WHERE`;
    const msSolJoin = solutionId
      ? `JOIN projects pr ON m.projectId = pr.id WHERE pr.solutionId = ? AND`
      : `WHERE`;
    const prSolWhere = solutionId ? `WHERE p.solutionId = ? AND` : `WHERE`;
    return {
      tasks: this.scalar(
        `SELECT COUNT(*) AS n FROM tasks t ${taskSolJoin}
         t.status='done' AND t.completedAt IS NOT NULL AND t.completedAt >= ?`,
        [...sid, startIso],
      ),
      milestones: this.scalar(
        `SELECT COUNT(*) AS n FROM milestones m
         ${msSolJoin} (m.status IN ('done','archived') OR ${fullyDone(MILESTONE_SCOPE)})
           AND ${maxDoneToday(MILESTONE_SCOPE)}`,
        [...sid, startIso],
      ),
      projects: this.scalar(
        `SELECT COUNT(*) AS n FROM projects p
         ${prSolWhere} (p.status IN ('done','archived') OR ${fullyDone(PROJECT_SCOPE)})
           AND ${maxDoneToday(PROJECT_SCOPE)}`,
        [...sid, startIso],
      ),
    };
  }

  /** Cap on the number of distinct days returned by dailyByStatus, so the chart
   *  payload stays bounded even on a long-lived DB. We keep the most recent days
   *  that actually have transitions. */
  private static readonly DAILY_CHART_MAX_DAYS = 60;

  /**
   * Task status transitions per day - the data behind the live daily line chart.
   * Reads the activity log (entityType='task', action='status', summary 'old -> new')
   * and counts, for each day, how many tasks ENTERED each status that day. ONE grouped
   * query gives a sparse (day, summary, count) set; we derive the target status from
   * the 'new' side of the summary and assemble the dense matrix.
   *
   * The day bucket is date(activity.at) (local civil date in SQLite, matching the
   * "TODAY" boundary used elsewhere). Capped to the most recent DAILY_CHART_MAX_DAYS
   * days that have transitions; fewer days -> all of them.
   *
   * Scope: when `solutionId` is set (a solution-scoped key), the query filters on
   * activity.solutionId (stamped at record time to the task's solution), so the chart
   * only ever exposes the key's own solution, exactly like the rest of getDashboard.
   * `statuses` lists only the statuses with transitions in the window, in canonical
   * STATUS_ORDER; the UI owns each status' color and label.
   */
  private dailyByStatus(solutionId?: string): DailyByStatus {
    const params: (string | number)[] = [];
    const solWhere = solutionId ? `AND solutionId = ?` : ``;
    if (solutionId) params.push(solutionId);
    const rows = this.db
      .prepare(
        `SELECT date(at) AS day, summary, COUNT(*) AS c
         FROM activity
         WHERE entityType = 'task' AND action = 'status' ${solWhere}
         GROUP BY day, summary
         ORDER BY day ASC`,
      )
      .all(...params) as { day: string; summary: string; c: number }[];

    // Derive the TARGET status from each "old -> new" summary; tally per (day, status).
    const validStatus = new Set<string>(TASK_STATUSES);
    const perDay = new Map<string, Map<string, number>>(); // day -> (status -> count)
    const days: string[] = [];
    for (const r of rows) {
      const target = r.summary.split(" -> ")[1]?.trim();
      if (!target || !validStatus.has(target)) continue;
      let m = perDay.get(r.day);
      if (!m) {
        m = new Map();
        perDay.set(r.day, m);
        days.push(r.day); // rows are day-ascending, so this stays chronological
      }
      m.set(target, (m.get(target) ?? 0) + Number(r.c));
    }

    // Keep only the most recent N days that have transitions.
    const keptDays = days.slice(-Repo.DAILY_CHART_MAX_DAYS);

    // Statuses with transitions within the kept window, in canonical STATUS_ORDER.
    const used = new Set<string>();
    for (const day of keptDays) {
      for (const s of perDay.get(day)!.keys()) used.add(s);
    }
    const statuses: TaskStatus[] = TASK_STATUSES.filter((s) => used.has(s));

    const statusIndex = new Map(statuses.map((s, i) => [s, i] as const));
    const counts = keptDays.map((day) => {
      const row = statuses.map(() => 0);
      for (const [s, c] of perDay.get(day)!) {
        const si = statusIndex.get(s as TaskStatus);
        if (si !== undefined) row[si] = c;
      }
      return row;
    });
    return { days: keptDays, statuses, counts };
  }

  getDashboard(): DashboardPayload {
    // Solution-scoped key: the whole dashboard reflects ONLY that solution. When
    // unset (admin/unscoped/anonymous/internal callers) every figure is global,
    // exactly as before. listSolutions/listProjects/recentTasksForSolution already
    // self-scope; the remaining totals, counts and feeds take the scoped id below.
    const scoped = this.scopedSolutionId();
    const solutions = this.listSolutions();
    const dashSolutions: DashboardSolution[] = solutions.map((c) => ({
      ...c,
      projects: this.listProjects(c.id),
      recentTasks: this.recentTasksForSolution(c.id, 5),
    }));

    const countsWhere = scoped
      ? this.statusCountsWhere(
          `JOIN milestones m ON t.milestoneId = m.id
           JOIN projects p ON m.projectId = p.id WHERE p.solutionId = ?`,
          [scoped],
        )
      : this.statusCountsWhere("", []);
    const totals = {
      solutions: scoped
        ? this.scalar(`SELECT COUNT(*) AS n FROM solutions WHERE id = ?`, [scoped])
        : this.scalar(`SELECT COUNT(*) AS n FROM solutions`),
      projects: scoped
        ? this.scalar(`SELECT COUNT(*) AS n FROM projects WHERE solutionId = ?`, [
            scoped,
          ])
        : this.scalar(`SELECT COUNT(*) AS n FROM projects`),
      milestones: scoped
        ? this.scalar(
            `SELECT COUNT(*) AS n FROM milestones m
             JOIN projects p ON m.projectId = p.id WHERE p.solutionId = ?`,
            [scoped],
          )
        : this.scalar(`SELECT COUNT(*) AS n FROM milestones`),
      tasks: scoped
        ? this.scalar(
            `SELECT COUNT(*) AS n FROM tasks t
             JOIN milestones m ON t.milestoneId = m.id
             JOIN projects p ON m.projectId = p.id WHERE p.solutionId = ?`,
            [scoped],
          )
        : this.scalar(`SELECT COUNT(*) AS n FROM tasks`),
    };

    return {
      totals,
      statusCounts: countsWhere,
      progress: progressFromCounts(countsWhere),
      completed: this.completionCounts(scoped),
      completedIds: this.completedIds(scoped),
      completedToday: this.completedToday(new Date(), scoped),
      solutions: dashSolutions,
      attention: this.attentionTasks(scoped),
      recent: this.recentTasks(12, scoped),
      dailyByStatus: this.dailyByStatus(scoped),
    };
  }
}

/** Repo bound to the DB singleton (used by the route handlers). */
import { getDb } from "./db";
let _repo: Repo | null = null;
export function repo(): Repo {
  if (!_repo) _repo = new Repo(getDb());
  return _repo;
}

export type { Progress };
