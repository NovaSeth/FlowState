import { beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createDatabase } from "./db";
import { Repo } from "./repo";
import { AppError } from "./errors";
import { runWithContext } from "./context";

function freshRepo(): Repo {
  return new Repo(createDatabase(":memory:"));
}

describe("Repo - solutions and projects", () => {
  let repo: Repo;
  beforeEach(() => {
    repo = freshRepo();
  });

  it("creates a solution and returns it in the list", () => {
    const c = repo.createSolution({ name: "Acme" });
    expect(c.id).toMatch(/^so_/);
    expect(c.name).toBe("Acme");
    const list = repo.listSolutions();
    expect(list).toHaveLength(1);
    expect(list[0].progress).toEqual({ total: 0, done: 0, percent: 0 });
    expect(list[0].projectCount).toBe(0);
  });

  it("rejects a solution without a name (422)", () => {
    expect(() => repo.createSolution({ name: "  " })).toThrow(AppError);
    try {
      repo.createSolution({ name: "" });
    } catch (e) {
      expect((e as AppError).status).toBe(422);
    }
  });

  it("creating a project does NOT create any default milestone", () => {
    const c = repo.createSolution({ name: "Acme" });
    const p = repo.createProject({ solutionId: c.id, name: "Web" });
    expect(p.id).toMatch(/^pr_/);
    // Milestones are created deliberately - a project starts without a milestone.
    const milestones = repo.listMilestones(p.id);
    expect(milestones).toHaveLength(0);
  });

  it("lists solutions alphabetically by name (case-insensitive)", () => {
    repo.createSolution({ name: "banana" });
    repo.createSolution({ name: "Apple" });
    repo.createSolution({ name: "cherry" });
    expect(repo.listSolutions().map((s) => s.name)).toEqual([
      "Apple",
      "banana",
      "cherry",
    ]);
  });

  it("lists active projects before completed ones", () => {
    const c = repo.createSolution({ name: "Acme" });
    const done = repo.createProject({ solutionId: c.id, name: "Done", status: "done" });
    const active = repo.createProject({ solutionId: c.id, name: "Active", status: "active" });
    const ids = repo.listProjects(c.id).map((p) => p.id);
    expect(ids.indexOf(active.id)).toBeLessThan(ids.indexOf(done.id));
  });

  it("lists active milestones before completed ones, preserving sequence within a status", () => {
    const c = repo.createSolution({ name: "Acme" });
    const p = repo.createProject({ solutionId: c.id, name: "Web" });
    const m1 = repo.createMilestone({ projectId: p.id, title: "M1" });
    const m2 = repo.createMilestone({ projectId: p.id, title: "M2" });
    const m3 = repo.createMilestone({ projectId: p.id, title: "M3" });
    // Mark the first milestone done; the remaining active ones keep their order.
    repo.updateMilestone(m1.id, { status: "done" });
    expect(repo.listMilestones(p.id).map((m) => m.id)).toEqual([m2.id, m3.id, m1.id]);
  });

  it("project for a non-existent solution -> 404", () => {
    try {
      repo.createProject({ solutionId: "so_nope", name: "X" });
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as AppError).status).toBe(404);
    }
  });

  it("rejects an invalid project status (422)", () => {
    const c = repo.createSolution({ name: "Acme" });
    try {
      // @ts-expect-error intentionally bad status
      repo.createProject({ solutionId: c.id, name: "X", status: "wat" });
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as AppError).status).toBe(422);
    }
  });
});

describe("Repo - tasks and progress", () => {
  let repo: Repo;
  let milestoneId: string;
  let projectId: string;
  let solutionId: string;

  beforeEach(() => {
    repo = freshRepo();
    const c = repo.createSolution({ name: "Acme" });
    solutionId = c.id;
    const p = repo.createProject({ solutionId, name: "Web" });
    projectId = p.id;
    milestoneId = repo.createMilestone({ projectId, title: "M1" }).id;
  });

  it("default status todo and priority none", () => {
    const t = repo.createTask({ milestoneId, title: "Do something" });
    expect(t.status).toBe("todo");
    expect(t.priority).toBe("none");
    expect(t.position).toBe(0);
  });

  it("subsequent tasks get an increasing position", () => {
    const a = repo.createTask({ milestoneId, title: "A" });
    const b = repo.createTask({ milestoneId, title: "B" });
    expect(b.position).toBeGreaterThan(a.position);
  });

  it("milestone progress = done/total", () => {
    repo.createTask({ milestoneId, title: "A", status: "done" });
    repo.createTask({ milestoneId, title: "B", status: "todo" });
    repo.createTask({ milestoneId, title: "C", status: "blocked" });
    const m = repo.getMilestoneRollup(milestoneId)!;
    expect(m.progress.total).toBe(3);
    expect(m.progress.done).toBe(1);
    expect(m.progress.percent).toBe(33);
    expect(m.statusCounts).toEqual({
      todo: 1,
      in_progress: 0,
      blocked: 1,
      done: 1,
      closed: 0,
    });
  });

  it("closed does not enter the milestone progress denominator (but is in statusCounts)", () => {
    repo.createTask({ milestoneId, title: "A", status: "done" });
    repo.createTask({ milestoneId, title: "B", status: "todo" });
    repo.createTask({ milestoneId, title: "C", status: "closed" });
    const m = repo.getMilestoneRollup(milestoneId)!;
    // total excludes closed: done(1)+todo(1)=2; percent = 1/2 = 50.
    expect(m.progress).toEqual({ total: 2, done: 1, percent: 50 });
    expect(m.statusCounts.closed).toBe(1);
  });

  it("rollup propagates to the project and solution", () => {
    repo.createTask({ milestoneId, title: "A", status: "done" });
    repo.createTask({ milestoneId, title: "B", status: "done" });
    const pr = repo.getProjectRollup(projectId)!;
    expect(pr.progress).toEqual({ total: 2, done: 2, percent: 100 });
    const cl = repo.getSolutionRollup(solutionId)!;
    expect(cl.progress).toEqual({ total: 2, done: 2, percent: 100 });
  });

  it("project does NOT auto-complete while a sibling milestone (no tasks) is still active", () => {
    // M1 has tasks, M2 is an empty/active milestone. Completing all of M1's
    // tasks must NOT close the project - there is still open milestone work.
    const m2 = repo.createMilestone({ projectId, title: "M2" }).id;
    const t = repo.createTask({ milestoneId, title: "A" });
    repo.updateTask(t.id, { status: "done" });
    // M1 itself rolls up to done...
    expect(repo.getMilestone(milestoneId)!.status).toBe("done");
    // ...but M2 is still active, so the project must stay active.
    expect(repo.getMilestone(m2)!.status).toBe("active");
    expect(repo.getProject(projectId)!.status).toBe("active");
  });

  it("project auto-completes once every milestone is done", () => {
    const m2 = repo.createMilestone({ projectId, title: "M2" }).id;
    repo.updateTask(repo.createTask({ milestoneId, title: "A" }).id, { status: "done" });
    expect(repo.getProject(projectId)!.status).toBe("active"); // M2 still open
    repo.updateTask(repo.createTask({ milestoneId: m2, title: "B" }).id, { status: "done" });
    expect(repo.getProject(projectId)!.status).toBe("done"); // every milestone done
  });

  it("PATCH status in a single call", () => {
    const t = repo.createTask({ milestoneId, title: "A" });
    const updated = repo.updateTask(t.id, { status: "done" });
    expect(updated.status).toBe("done");
    expect(updated.updatedAt >= t.updatedAt).toBe(true);
  });

  it("idempotency: the same clientRequestId does not create a duplicate", () => {
    const a = repo.createTask({
      milestoneId,
      title: "A",
      clientRequestId: "req-1",
    });
    const b = repo.createTask({
      milestoneId,
      title: "A again",
      clientRequestId: "req-1",
    });
    expect(b.id).toBe(a.id);
    expect(b.title).toBe("A");
    expect(repo.listTasks({ milestoneId })).toHaveLength(1);
  });

  it("filters tasks by status and priority", () => {
    repo.createTask({ milestoneId, title: "A", status: "blocked" });
    repo.createTask({ milestoneId, title: "B", priority: "urgent" });
    expect(repo.listTasks({ milestoneId, status: "blocked" })).toHaveLength(1);
    expect(repo.listTasks({ projectId, priority: "urgent" })).toHaveLength(1);
  });

  it("listTasks limit is applied and clamped to [1, MAX]", () => {
    for (let i = 0; i < 5; i++) repo.createTask({ milestoneId, title: `L${i}` });
    // explicit small limit
    expect(repo.listTasks({ milestoneId, limit: 2 })).toHaveLength(2);
    // limit below 1 is clamped up to 1 (never returns 0 by clamp)
    expect(repo.listTasks({ milestoneId, limit: 0 })).toHaveLength(1);
    // a NaN/absurd limit does not throw and returns all (within MAX)
    expect(repo.listTasks({ milestoneId, limit: NaN })).toHaveLength(5);
    expect(repo.listTasks({ milestoneId, limit: 10_000_000 })).toHaveLength(5);
  });

  it("filters tasks by solutionId (across all projects of the solution)", () => {
    repo.createTask({ milestoneId, title: "A", status: "blocked" });
    // second project + milestone in the same solution
    const p2 = repo.createProject({ solutionId, name: "Web2" });
    const m2 = repo.createMilestone({ projectId: p2.id, title: "M2" });
    repo.createTask({ milestoneId: m2.id, title: "B", status: "blocked" });
    // a task in another solution should not count
    const other = repo.createSolution({ name: "Other" });
    const op = repo.createProject({ solutionId: other.id, name: "X" });
    const om = repo.createMilestone({ projectId: op.id, title: "MX" });
    repo.createTask({ milestoneId: om.id, title: "C", status: "blocked" });

    expect(repo.listTasks({ solutionId, status: "blocked" })).toHaveLength(2);
    expect(repo.listTasks({ solutionId })).toHaveLength(2);
  });

  it("searchTasks finds by title and description (case-insensitive) with context", () => {
    repo.createTask({ milestoneId, title: "Voice eval pipeline" });
    repo.createTask({ milestoneId, title: "Other", description: "about the VOICE eval" });
    repo.createTask({ milestoneId, title: "Unrelated" });
    const hits = repo.searchTasks("voice eval");
    expect(hits).toHaveLength(2);
    expect(hits[0].context.solutionId).toBe(solutionId);
    // scoping to another solution -> empty
    const other = repo.createSolution({ name: "Other" });
    expect(repo.searchTasks("voice", { solutionId: other.id })).toHaveLength(0);
  });

  it("searchTasks: empty query -> 422", () => {
    try {
      repo.searchTasks("   ");
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as AppError).status).toBe(422);
    }
  });

  it("transition to blocked without a reason -> 422", () => {
    const t = repo.createTask({ milestoneId, title: "A" });
    try {
      repo.updateTask(t.id, { status: "blocked" });
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as AppError).status).toBe(422);
    }
  });

  it("transition to blocked with a reason saves a comment", () => {
    const t = repo.createTask({ milestoneId, title: "A" });
    const updated = repo.updateTask(t.id, {
      status: "blocked",
      reason: "waiting for the phone MAC",
      reasonAuthor: "claude-code",
    });
    expect(updated.status).toBe("blocked");
    const comments = repo.listComments(t.id);
    expect(comments).toHaveLength(1);
    expect(comments[0].body).toBe("waiting for the phone MAC");
    expect(comments[0].author).toBe("claude-code");
  });

  it("blocked allowed without a reason when the task already has a comment", () => {
    const t = repo.createTask({ milestoneId, title: "A" });
    repo.createComment(t.id, { body: "reason given earlier" });
    const updated = repo.updateTask(t.id, { status: "blocked" });
    expect(updated.status).toBe("blocked");
    // no additional comment was created
    expect(repo.listComments(t.id)).toHaveLength(1);
  });

  it("changing another field while already blocked does not require a reason", () => {
    const t = repo.createTask({ milestoneId, title: "A" });
    repo.updateTask(t.id, { status: "blocked", reason: "reason" });
    // another update without a reason (status stays blocked) - no error
    const updated = repo.updateTask(t.id, { priority: "high" });
    expect(updated.priority).toBe("high");
    expect(updated.status).toBe("blocked");
  });

  it("rejects a non-numeric position (422)", () => {
    try {
      // @ts-expect-error intentionally bad position
      repo.createTask({ milestoneId, title: "X", position: "abc" });
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as AppError).status).toBe(422);
    }
  });

  it("bad task status enum -> 422", () => {
    try {
      // @ts-expect-error intentionally bad status
      repo.createTask({ milestoneId, title: "A", status: "nope" });
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as AppError).status).toBe(422);
    }
  });
});

describe("Repo - cascading deletes", () => {
  it("deleting a solution deletes projects, milestones, tasks, comments", () => {
    const repo = freshRepo();
    const c = repo.createSolution({ name: "Acme" });
    const p = repo.createProject({ solutionId: c.id, name: "Web" });
    const m = repo.createMilestone({ projectId: p.id, title: "M1" }).id;
    const t = repo.createTask({ milestoneId: m, title: "A" });
    repo.createComment(t.id, { body: "hi" });

    repo.deleteSolution(c.id);

    expect(repo.listSolutions()).toHaveLength(0);
    expect(repo.listProjects()).toHaveLength(0);
    expect(repo.getTask(t.id)).toBeNull();
    expect(repo.listComments(t.id)).toHaveLength(0);
  });

  it("deleting a project deletes its milestones and tasks (cascade)", () => {
    const repo = freshRepo();
    const c = repo.createSolution({ name: "Acme" });
    const p = repo.createProject({ solutionId: c.id, name: "Web" });
    const m = repo.createMilestone({ projectId: p.id, title: "M1" }).id;
    const t = repo.createTask({ milestoneId: m, title: "A" });
    repo.deleteProject(p.id);
    expect(repo.getProject(p.id)).toBeNull();
    expect(repo.getMilestone(m)).toBeNull();
    expect(repo.getTask(t.id)).toBeNull();
  });

  it("deleting a milestone deletes its tasks (cascade)", () => {
    const repo = freshRepo();
    const c = repo.createSolution({ name: "Acme" });
    const p = repo.createProject({ solutionId: c.id, name: "Web" });
    const m = repo.createMilestone({ projectId: p.id, title: "M1" }).id;
    const t = repo.createTask({ milestoneId: m, title: "A" });
    repo.deleteMilestone(m);
    expect(repo.getMilestone(m)).toBeNull();
    expect(repo.getTask(t.id)).toBeNull();
  });

  it("deleting something non-existent -> 404", () => {
    const repo = freshRepo();
    try {
      repo.deleteSolution("so_nope");
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as AppError).status).toBe(404);
    }
  });
});

describe("Repo - comments and dashboard", () => {
  it("adds comments and lists them", () => {
    const repo = freshRepo();
    const c = repo.createSolution({ name: "Acme" });
    const p = repo.createProject({ solutionId: c.id, name: "Web" });
    const m = repo.createMilestone({ projectId: p.id, title: "M1" }).id;
    const t = repo.createTask({ milestoneId: m, title: "A" });
    repo.createComment(t.id, { body: "first", author: "claude" });
    repo.createComment(t.id, { body: "second" });
    const comments = repo.listComments(t.id);
    expect(comments).toHaveLength(2);
    expect(comments[0].body).toBe("first");
    expect(comments[0].author).toBe("claude");
  });

  it("attention skips urgent tasks that are done/closed (catches blocked and open urgent)", () => {
    const repo = freshRepo();
    const c = repo.createSolution({ name: "Acme" });
    const p = repo.createProject({ solutionId: c.id, name: "Web" });
    const m = repo.createMilestone({ projectId: p.id, title: "M1" }).id;
    repo.createTask({ milestoneId: m, title: "Urgent open", priority: "urgent" });
    repo.createTask({ milestoneId: m, title: "Urgent done", priority: "urgent", status: "done" });
    repo.createTask({ milestoneId: m, title: "Urgent closed", priority: "urgent", status: "closed" });
    repo.createTask({ milestoneId: m, title: "Blocker", status: "blocked" });

    const titles = repo.getDashboard().attention.map((t) => t.title);
    expect(titles).toContain("Urgent open");
    expect(titles).toContain("Blocker");
    expect(titles).not.toContain("Urgent done");
    expect(titles).not.toContain("Urgent closed");
  });

  it("attention attaches a note (latest comment = reason) for blocked tasks", () => {
    const repo = freshRepo();
    const c = repo.createSolution({ name: "Acme" });
    const p = repo.createProject({ solutionId: c.id, name: "Web" });
    const m = repo.createMilestone({ projectId: p.id, title: "M1" }).id;
    const t = repo.createTask({ milestoneId: m, title: "Blocker" });
    repo.updateTask(t.id, { status: "blocked", reason: "waiting for Michal's decision" });
    repo.createComment(t.id, { body: "update: still waiting" });

    const att = repo.getDashboard().attention.find((a) => a.id === t.id)!;
    expect(att.note).toBe("update: still waiting"); // the latest comment
  });

  it("dashboard: each solution has up to 5 recent tasks (any status)", () => {
    const repo = freshRepo();
    const c = repo.createSolution({ name: "Acme" });
    const p = repo.createProject({ solutionId: c.id, name: "Web" });
    const m = repo.createMilestone({ projectId: p.id, title: "M1" }).id;
    // 6 tasks of various statuses; we expect the 5 most recent
    for (let i = 0; i < 6; i++) {
      repo.createTask({ milestoneId: m, title: `T${i}`, status: i % 2 ? "done" : "todo" });
    }
    const sol = repo.getDashboard().solutions.find((s) => s.id === c.id)!;
    expect(sol.recentTasks).toHaveLength(5);
    // most recent first (T5 created last)
    expect(sol.recentTasks[0].title).toBe("T5");
    // mixes statuses (not only done)
    const statuses = new Set(sol.recentTasks.map((t) => t.status));
    expect(statuses.size).toBeGreaterThan(1);
  });

  it("dashboard.completed counts completions at every level (for gamification)", () => {
    const repo = freshRepo();
    const c = repo.createSolution({ name: "Acme" });
    const p = repo.createProject({ solutionId: c.id, name: "Web" });
    const m = repo.createMilestone({ projectId: p.id, title: "M1" }).id;
    repo.createTask({ milestoneId: m, title: "A", status: "done" });
    repo.createTask({ milestoneId: m, title: "B", status: "todo" });

    // one task done, but the milestone is incomplete (a todo remains) -> nothing above is closed
    let d = repo.getDashboard();
    expect(d.completed.tasksDone).toBe(1);
    expect(d.completed.milestonesDone).toBe(0);
    expect(d.completed.projectsDone).toBe(0);
    expect(d.completed.solutionsDone).toBe(0);

    // close the last task -> milestone, project and solution become 100% -> done
    const tasks = repo.listTasks({ milestoneId: m });
    repo.updateTask(tasks.find((t) => t.title === "B")!.id, { status: "done" });
    d = repo.getDashboard();
    expect(d.completed.tasksDone).toBe(2);
    expect(d.completed.milestonesDone).toBe(1);
    expect(d.completed.projectsDone).toBe(1);
    expect(d.completed.solutionsDone).toBe(1);
  });

  it("dashboard.completedIds returns ids of closed milestones/projects/solutions", () => {
    const repo = freshRepo();
    const c = repo.createSolution({ name: "Acme" });
    const p = repo.createProject({ solutionId: c.id, name: "Web" });
    const m = repo.createMilestone({ projectId: p.id, title: "M1" }).id;
    repo.createTask({ milestoneId: m, title: "A", status: "done" });
    repo.createTask({ milestoneId: m, title: "B", status: "todo" });

    // incomplete milestone -> no ids anywhere
    let ids = repo.getDashboard().completedIds;
    expect(ids.milestones).not.toContain(m);
    expect(ids.projects).not.toContain(p.id);

    // close it -> ids appear at every level
    const b = repo.listTasks({ milestoneId: m }).find((t) => t.title === "B")!;
    repo.updateTask(b.id, { status: "done" });
    ids = repo.getDashboard().completedIds;
    expect(ids.milestones).toContain(m);
    expect(ids.projects).toContain(p.id);
    expect(ids.solutions).toContain(c.id);
  });

  it("dashboard.completed: an archived milestone counts as done even without tasks", () => {
    const repo = freshRepo();
    const c = repo.createSolution({ name: "Acme" });
    const p = repo.createProject({ solutionId: c.id, name: "Web" });
    const m = repo.createMilestone({ projectId: p.id, title: "Empty" }).id;
    repo.updateMilestone(m, { status: "archived" });
    expect(repo.getDashboard().completed.milestonesDone).toBe(1);
  });

  it("dashboard collects totals, statusCounts, attention and recent", () => {
    const repo = freshRepo();
    const c = repo.createSolution({ name: "Acme" });
    const p = repo.createProject({ solutionId: c.id, name: "Web" });
    const m = repo.createMilestone({ projectId: p.id, title: "M1" }).id;
    repo.createTask({ milestoneId: m, title: "Blocker", status: "blocked" });
    repo.createTask({ milestoneId: m, title: "Urgent", priority: "urgent" });
    repo.createTask({ milestoneId: m, title: "Done", status: "done" });

    const d = repo.getDashboard();
    expect(d.totals.solutions).toBe(1);
    expect(d.totals.projects).toBe(1);
    expect(d.totals.tasks).toBe(3);
    expect(d.statusCounts.done).toBe(1);
    expect(d.attention).toHaveLength(2); // blocked + urgent
    expect(d.attention[0].context.solutionName).toBe("Acme");
    expect(d.solutions).toHaveLength(1);
    expect(d.solutions[0].projects).toHaveLength(1);
  });
});

describe("Repo - changesSince", () => {
  let repo: Repo;
  beforeEach(() => {
    repo = freshRepo();
  });

  it("with empty since returns full snapshot of current state", () => {
    const s = repo.createSolution({ name: "S1" });
    const p = repo.createProject({ solutionId: s.id, name: "P1" });
    const ms = repo.createMilestone({ projectId: p.id, title: "M1" });
    const t = repo.createTask({ milestoneId: ms.id, title: "T1" });

    const ch = repo.changesSince("");
    expect(ch.solutions.map((x) => x.id)).toContain(s.id);
    expect(ch.projects.map((x) => x.id)).toContain(p.id);
    expect(ch.milestones.map((x) => x.id)).toContain(ms.id);
    expect(ch.tasks.map((x) => x.id)).toContain(t.id);
    expect(ch.comments).toEqual([]);
  });

  it("returns serverTime and echoes the since param", () => {
    const before = new Date().toISOString();
    const ch = repo.changesSince("2026-01-01T00:00:00.000Z");
    expect(ch.since).toBe("2026-01-01T00:00:00.000Z");
    expect(ch.serverTime >= before).toBe(true);
  });

  it("returns a row with updatedAt == since (the ms boundary does not lose changes)", () => {
    const s = repo.createSolution({ name: "S1" });
    // since == the row's updatedAt: with '>' it would be lost, with '>=' it is returned.
    const ch = repo.changesSince(s.updatedAt);
    expect(ch.solutions.map((x) => x.id)).toContain(s.id);
  });

  it("with a future since returns empty buckets", () => {
    const s = repo.createSolution({ name: "S1" });
    const p = repo.createProject({ solutionId: s.id, name: "P1" });
    const ms = repo.createMilestone({ projectId: p.id, title: "M1" });
    repo.createTask({ milestoneId: ms.id, title: "T1" });

    const ch = repo.changesSince("9999-12-31T23:59:59.999Z");
    expect(ch.solutions).toEqual([]);
    expect(ch.projects).toEqual([]);
    expect(ch.milestones).toEqual([]);
    expect(ch.tasks).toEqual([]);
    expect(ch.comments).toEqual([]);
  });

  it("reflects task status updates when polled with epoch", () => {
    const s = repo.createSolution({ name: "S1" });
    const p = repo.createProject({ solutionId: s.id, name: "P1" });
    const ms = repo.createMilestone({ projectId: p.id, title: "M1" });
    const t = repo.createTask({ milestoneId: ms.id, title: "T1" });
    repo.updateTask(t.id, { status: "in_progress" });

    const ch = repo.changesSince("");
    const updated = ch.tasks.find((x) => x.id === t.id);
    expect(updated).toBeDefined();
    expect(updated!.status).toBe("in_progress");
  });

  it("includes new comments since the given timestamp", () => {
    const s = repo.createSolution({ name: "S1" });
    const p = repo.createProject({ solutionId: s.id, name: "P1" });
    const ms = repo.createMilestone({ projectId: p.id, title: "M1" });
    const t = repo.createTask({ milestoneId: ms.id, title: "T1" });
    const c = repo.createComment(t.id, { body: "hello" });

    const ch = repo.changesSince("");
    expect(ch.comments.map((x) => x.id)).toContain(c.id);
  });
});

describe("Repo - identity, keys and audit (Stream C)", () => {
  let repo: Repo;
  beforeEach(() => {
    repo = freshRepo();
  });

  it("creates actors (agent by default) and lists them", () => {
    const human = repo.createActor({ kind: "human", name: "Michal" });
    const agent = repo.createActor({ name: "worker" });
    expect(human.kind).toBe("human");
    expect(agent.kind).toBe("agent");
    expect(repo.listActors().map((a) => a.id).sort()).toEqual(
      [human.id, agent.id].sort(),
    );
  });

  it("createApiKey: token once, no secret in the DB, actorName creates an agent", () => {
    const key = repo.createApiKey({ actorName: "voice-worker", scope: "write" });
    expect(key.token).toContain(".");
    expect(key.prefix.startsWith("fsk_")).toBe(true);
    // actor created
    expect(repo.getActor(key.actorId)?.name).toBe("voice-worker");
    // the list does not expose the secret
    const listed = repo.listApiKeys();
    expect(listed).toHaveLength(1);
    expect((listed[0] as unknown as Record<string, unknown>).secretHash).toBeUndefined();
    expect((listed[0] as unknown as Record<string, unknown>).token).toBeUndefined();
  });

  it("resolveApiKey: valid token -> actor; bad secret -> null", () => {
    const key = repo.createApiKey({ actorName: "a" });
    const ok = repo.resolveApiKey(key.token);
    expect(ok?.actorId).toBe(key.actorId);
    expect(repo.resolveApiKey(`${key.prefix}.badsecret`)).toBeNull();
    expect(repo.resolveApiKey("nodot")).toBeNull();
  });

  it("resolveApiKey: revoked -> 401, expired -> 401", () => {
    const revoked = repo.createApiKey({ actorName: "r" });
    repo.revokeApiKey(revoked.id);
    expect(() => repo.resolveApiKey(revoked.token)).toThrowError(
      expect.objectContaining({ status: 401 }),
    );

    const expired = repo.createApiKey({ actorName: "e", ttlSeconds: -1 });
    expect(() => repo.resolveApiKey(expired.token)).toThrowError(
      expect.objectContaining({ status: 401 }),
    );
  });

  it("resolveApiKey: bad secret on a revoked key -> null (does not reveal state via the prefix)", () => {
    const k = repo.createApiKey({ actorName: "x" });
    repo.revokeApiKey(k.id);
    // The secret is checked BEFORE the key state: bad secret -> null, not 401-revoked.
    expect(repo.resolveApiKey(`${k.prefix}.badsecret`)).toBeNull();
  });

  it("listActivity with a NaN limit does not blow up (default limit)", () => {
    expect(() => repo.listActivity({ limit: NaN })).not.toThrow();
  });

  it("ttlSeconds sets expiresAt in the future", () => {
    const key = repo.createApiKey({ actorName: "t", ttlSeconds: 3600 });
    expect(key.expiresAt).toBeTruthy();
    expect(key.expiresAt! > new Date().toISOString()).toBe(true);
  });

  it("attribution: creating within a key context sets the owner and writes activity", () => {
    const actor = repo.createActor({ name: "agentX" });
    const s = repo.createSolution({ name: "S" });
    const p = repo.createProject({ solutionId: s.id, name: "P" });
    const m = repo.createMilestone({ projectId: p.id, title: "M" });

    const task = runWithContext({ actorId: actor.id }, () =>
      repo.createTask({ milestoneId: m.id, title: "T" }),
    );
    expect(task.ownerActorId).toBe(actor.id);

    runWithContext({ actorId: actor.id }, () =>
      repo.updateTask(task.id, { status: "done" }),
    );
    const log = repo.listActivity({ entityId: task.id });
    expect(log.some((e) => e.action === "create")).toBe(true);
    expect(log.some((e) => e.action === "status" && e.summary.includes("done"))).toBe(true);
    expect(log.every((e) => e.actorId === actor.id)).toBe(true);
  });

  it("delegation: a key minted within a context records createdByKeyId", () => {
    const parent = repo.createActor({ name: "parent" });
    const child = runWithContext({ actorId: parent.id, keyId: "key_parent" }, () =>
      repo.createApiKey({ actorName: "child-agent", ttlSeconds: 7200 }),
    );
    expect(child.createdByKeyId).toBe("key_parent");
    expect(repo.getActor(child.actorId)?.createdByKeyId).toBe("key_parent");
  });

  it("createApiKey: normalizes a non-ISO expiresAt and rejects garbage (422)", () => {
    // a parseable but non-canonical date is normalized to ISO
    const k = repo.createApiKey({ actorName: "z", expiresAt: "2030-01-02 03:04:05" });
    expect(k.expiresAt).toBe(new Date("2030-01-02 03:04:05").toISOString());
    // garbage -> 422
    try {
      repo.createApiKey({ actorName: "g", expiresAt: "not-a-date" });
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as AppError).status).toBe(422);
    }
  });

  it("resolveApiKey throttles the lastUsedAt write (no second write within 60s)", () => {
    const k = repo.createApiKey({ actorName: "lru" });
    repo.resolveApiKey(k.token);
    const first = repo.getApiKey(k.id)!.lastUsedAt;
    expect(first).toBeTruthy();
    repo.resolveApiKey(k.token); // immediately again -> should NOT rewrite
    expect(repo.getApiKey(k.id)!.lastUsedAt).toBe(first);
  });
});

describe("Repo - solution-scope enforcement (scoped key)", () => {
  // Two solutions; a key scoped to A may only touch A.
  let repo: Repo;
  let solA: string;
  let solB: string;
  let msA: string;
  let msB: string;
  let taskB: string;
  beforeEach(() => {
    repo = freshRepo();
    solA = repo.createSolution({ name: "A" }).id;
    solB = repo.createSolution({ name: "B" }).id;
    const pA = repo.createProject({ solutionId: solA, name: "PA" }).id;
    const pB = repo.createProject({ solutionId: solB, name: "PB" }).id;
    msA = repo.createMilestone({ projectId: pA, title: "MA" }).id;
    msB = repo.createMilestone({ projectId: pB, title: "MB" }).id;
    taskB = repo.createTask({ milestoneId: msB, title: "B-task" }).id;
  });

  const scoped = <T>(solutionId: string, fn: () => T): T =>
    runWithContext({ keySolutionId: solutionId, keyScope: "write" }, fn);
  const expect403 = (fn: () => unknown) => {
    try {
      fn();
      throw new Error("should have thrown 403");
    } catch (e) {
      expect((e as AppError).status).toBe(403);
    }
  };

  it("create in own solution OK, in another -> 403", () => {
    expect(scoped(solA, () => repo.createTask({ milestoneId: msA, title: "ok" })).title).toBe("ok");
    expect403(() => scoped(solA, () => repo.createTask({ milestoneId: msB, title: "x" })));
  });

  it("update/delete/read across solutions -> 403", () => {
    expect403(() => scoped(solA, () => repo.updateTask(taskB, { status: "in_progress" })));
    expect403(() => scoped(solA, () => repo.deleteTask(taskB)));
    expect403(() => scoped(solA, () => repo.getTask(taskB)));
    expect403(() => scoped(solA, () => repo.getMilestoneRollup(msB)));
    expect403(() => scoped(solA, () => repo.getSolutionRollup(solB)));
  });

  it("cannot move a task into another solution -> 403", () => {
    const tA = scoped(solA, () => repo.createTask({ milestoneId: msA, title: "move me" }));
    expect403(() => scoped(solA, () => repo.updateTask(tA.id, { milestoneId: msB })));
  });

  it("cannot create or mutate another solution; can update its own", () => {
    expect403(() => scoped(solA, () => repo.createSolution({ name: "new" })));
    expect403(() => scoped(solA, () => repo.updateSolution(solB, { name: "hijack" })));
    expect(scoped(solA, () => repo.updateSolution(solA, { description: "mine" })).description).toBe("mine");
  });

  it("enumeration is forced to the key's solution (cannot list/search B)", () => {
    // even when asking for B explicitly, listTasks returns only A
    const list = scoped(solA, () => repo.listTasks({ solutionId: solB }));
    expect(list.every((t) => t.id !== taskB)).toBe(true);
    // search forced to A
    const hits = scoped(solA, () => repo.searchTasks("task", { solutionId: solB }));
    expect(hits.every((t) => t.id !== taskB)).toBe(true);
    // listSolutions returns only A
    const sols = scoped(solA, () => repo.listSolutions());
    expect(sols.map((s) => s.id)).toEqual([solA]);
    // listApiKeys forced to A's keys only
    repo.createApiKey({ actorName: "kb", solutionId: solB });
    repo.createApiKey({ actorName: "ka", solutionId: solA });
    const keys = scoped(solA, () => repo.listApiKeys());
    expect(keys.every((k) => k.solutionId === solA)).toBe(true);
  });

  it("admin/unscoped/anonymous are unaffected (full cross-solution access)", () => {
    // no context (anonymous/open mode)
    expect(repo.getTask(taskB)!.id).toBe(taskB);
    expect(repo.listTasks({ solutionId: solB }).some((t) => t.id === taskB)).toBe(true);
    // admin context (no keySolutionId)
    runWithContext({ admin: true }, () => {
      expect(repo.getTask(taskB)!.id).toBe(taskB);
      expect(repo.updateTask(taskB, { status: "in_progress" }).status).toBe("in_progress");
    });
    // unscoped key context (keyId/actorId but no keySolutionId)
    runWithContext({ keyId: "k1", actorId: "a1" }, () => {
      expect(repo.getMilestoneRollup(msB)).not.toBeNull();
    });
  });
});

describe("Repo - subtasks, dependencies, labels (Stream B)", () => {
  let repo: Repo;
  let milestoneId: string;
  beforeEach(() => {
    repo = freshRepo();
    const s = repo.createSolution({ name: "S" });
    const p = repo.createProject({ solutionId: s.id, name: "P" });
    milestoneId = repo.createMilestone({ projectId: p.id, title: "M" }).id;
  });

  it("parentTaskId + subtask rollup in getTaskDetail", () => {
    const parent = repo.createTask({ milestoneId, title: "Parent" });
    repo.createTask({ milestoneId, title: "C1", parentTaskId: parent.id, status: "done" });
    repo.createTask({ milestoneId, title: "C2", parentTaskId: parent.id });
    const detail = repo.getTaskDetail(parent.id)!;
    expect(detail.childCount).toBe(2);
    expect(detail.childProgress).toEqual({ total: 2, done: 1, percent: 50 });
    expect(detail.children.map((c) => c.title).sort()).toEqual(["C1", "C2"]);
  });

  it("parent closes automatically when all subtasks are done", () => {
    const parent = repo.createTask({ milestoneId, title: "Parent" });
    const c1 = repo.createTask({ milestoneId, title: "C1", parentTaskId: parent.id });
    const c2 = repo.createTask({ milestoneId, title: "C2", parentTaskId: parent.id });
    repo.updateTask(c1.id, { status: "done" });
    expect(repo.getTask(parent.id)!.status).not.toBe("done"); // not all yet
    repo.updateTask(c2.id, { status: "done" });
    expect(repo.getTask(parent.id)!.status).toBe("done"); // auto-done
  });

  it("parent with all subtasks closed closes as closed", () => {
    const parent = repo.createTask({ milestoneId, title: "Parent" });
    const c1 = repo.createTask({ milestoneId, title: "C1", parentTaskId: parent.id });
    const c2 = repo.createTask({ milestoneId, title: "C2", parentTaskId: parent.id });
    repo.updateTask(c1.id, { status: "closed" });
    expect(repo.getTask(parent.id)!.status).not.toBe("closed"); // not all yet
    repo.updateTask(c2.id, { status: "closed" });
    expect(repo.getTask(parent.id)!.status).toBe("closed"); // the whole subset is closed
  });

  it("parent with done+closed subtasks closes as done (there is real work)", () => {
    const parent = repo.createTask({ milestoneId, title: "Parent" });
    const c1 = repo.createTask({ milestoneId, title: "C1", parentTaskId: parent.id });
    const c2 = repo.createTask({ milestoneId, title: "C2", parentTaskId: parent.id });
    repo.updateTask(c1.id, { status: "done" });
    repo.updateTask(c2.id, { status: "closed" });
    expect(repo.getTask(parent.id)!.status).toBe("done");
  });

  it("does not allow a parent cycle", () => {
    const a = repo.createTask({ milestoneId, title: "A" });
    const b = repo.createTask({ milestoneId, title: "B", parentTaskId: a.id });
    // setting A's parent to its descendant B -> cycle -> 422
    try {
      repo.updateTask(a.id, { parentTaskId: b.id });
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as AppError).status).toBe(422);
    }
  });

  it("blockedBy: structured dependencies in getTaskDetail", () => {
    const dep = repo.createTask({ milestoneId, title: "This first" });
    const t = repo.createTask({ milestoneId, title: "Then this", blockedBy: [dep.id] });
    const detail = repo.getTaskDetail(t.id)!;
    expect(detail.blockedBy).toHaveLength(1);
    expect(detail.blockedBy[0].id).toBe(dep.id);
    expect(detail.blockedBy[0].title).toBe("This first");
  });

  it("blockedBy does not allow depending on itself", () => {
    const t = repo.createTask({ milestoneId, title: "T" });
    try {
      repo.updateTask(t.id, { blockedBy: [t.id] });
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as AppError).status).toBe(422);
    }
  });

  it("labels: writing, on the task, and list filtering", () => {
    const t = repo.createTask({
      milestoneId,
      title: "Recording",
      labels: ["needs-physical", "Needs-Physical", "exploration"],
    });
    // dedup + lowercase
    expect(t.labels.sort()).toEqual(["exploration", "needs-physical"]);
    repo.createTask({ milestoneId, title: "Code", labels: ["code-only"] });
    const hits = repo.listTasks({ milestoneId, label: "needs-physical" });
    expect(hits).toHaveLength(1);
    expect(hits[0].id).toBe(t.id);
  });

  it("update replaces the set of labels", () => {
    const t = repo.createTask({ milestoneId, title: "T", labels: ["a", "b"] });
    const updated = repo.updateTask(t.id, { labels: ["c"] });
    expect(updated.labels).toEqual(["c"]);
  });

  it("listTasksWithMeta: childCount/childDoneCount/openBlockerCount in batch", () => {
    const parent = repo.createTask({ milestoneId, title: "Parent" });
    repo.createTask({ milestoneId, title: "C1", parentTaskId: parent.id, status: "done" });
    repo.createTask({ milestoneId, title: "C2", parentTaskId: parent.id });
    const dep = repo.createTask({ milestoneId, title: "Dep" }); // not done yet
    const blocked = repo.createTask({ milestoneId, title: "Blocked", blockedBy: [dep.id] });

    const byId = Object.fromEntries(
      repo.listTasksWithMeta({ milestoneId }).map((t) => [t.id, t]),
    );
    expect(byId[parent.id].childCount).toBe(2);
    expect(byId[parent.id].childDoneCount).toBe(1);
    expect(byId[blocked.id].openBlockerCount).toBe(1);
    // a task with no children/blockers has zeros
    expect(byId[dep.id].childCount).toBe(0);
    expect(byId[dep.id].openBlockerCount).toBe(0);

    // when the blocker is closed -> it stops counting as open
    repo.updateTask(dep.id, { status: "done" });
    const after = repo.listTasksWithMeta({ milestoneId }).find((t) => t.id === blocked.id)!;
    expect(after.openBlockerCount).toBe(0);
  });

  it("deleting a parent detaches subtasks (does not delete them)", () => {
    const parent = repo.createTask({ milestoneId, title: "Parent" });
    const child = repo.createTask({ milestoneId, title: "Child", parentTaskId: parent.id });
    repo.deleteTask(parent.id);
    const after = repo.getTask(child.id);
    expect(after).not.toBeNull();
    expect(after!.parentTaskId).toBeNull();
  });
});

describe("Repo - atomicity (transactions)", () => {
  let repo: Repo;
  let milestoneId: string;
  beforeEach(() => {
    repo = freshRepo();
    const s = repo.createSolution({ name: "S" });
    const p = repo.createProject({ solutionId: s.id, name: "P" });
    milestoneId = repo.createMilestone({ projectId: p.id, title: "M" }).id;
  });

  it("createTask with a non-existent blockedBy leaves no half-created task", () => {
    // The task INSERT happens before setDeps, which throws notFound on a bad blockedBy.
    // Without a transaction the task stays in the DB despite the error - that's a bug.
    expect(() =>
      repo.createTask({ milestoneId, title: "X", blockedBy: ["ta_nope"] }),
    ).toThrow(AppError);
    expect(repo.listTasks({ milestoneId })).toHaveLength(0);
  });

  it("createTasks (bulk) is atomic - an error on one element rolls back the whole batch", () => {
    expect(() =>
      repo.createTasks([
        { milestoneId, title: "OK1" },
        // @ts-expect-error intentionally bad status in the middle of the batch
        { milestoneId, title: "BAD", status: "nope" },
        { milestoneId, title: "OK2" },
      ]),
    ).toThrow(AppError);
    // Nothing should be created (not even OK1 before the error).
    expect(repo.listTasks({ milestoneId })).toHaveLength(0);
  });

  it("createTasks (bulk) happy-path creates all and returns them in order", () => {
    const created = repo.createTasks([
      { milestoneId, title: "A" },
      { milestoneId, title: "B" },
      { milestoneId, title: "C" },
    ]);
    expect(created.map((t) => t.title)).toEqual(["A", "B", "C"]);
    expect(repo.listTasks({ milestoneId })).toHaveLength(3);
  });

  it("transaction: a nested call does not throw (re-entrancy)", () => {
    // createTasks wraps transaction, and createTask inside does too - it must not be
    // 'cannot start a transaction within a transaction'.
    expect(() =>
      repo.createTasks([{ milestoneId, title: "A" }]),
    ).not.toThrow();
  });
});

describe("Repo - agent feedback: outcome model", () => {
  let repo: Repo;
  let milestoneId: string;
  let projectId: string;
  beforeEach(() => {
    repo = freshRepo();
    const s = repo.createSolution({ name: "S" });
    const p = repo.createProject({ solutionId: s.id, name: "P" });
    projectId = p.id;
    milestoneId = repo.createMilestone({ projectId, title: "M" }).id;
  });

  it("verified: false by default; settable; does NOT affect progress %", () => {
    const t = repo.createTask({ milestoneId, title: "Code", status: "done" });
    expect(t.verified).toBe(false);
    const v = repo.updateTask(t.id, { verified: true });
    expect(v.verified).toBe(true);
    // progress is computed from the 'done' status, verified is orthogonal
    expect(repo.getMilestoneRollup(milestoneId)!.progress.percent).toBe(100);
    // create with verified
    const t2 = repo.createTask({ milestoneId, title: "Verified right away", verified: true });
    expect(t2.verified).toBe(true);
    // clearing the flag
    expect(repo.updateTask(t2.id, { verified: false }).verified).toBe(false);
  });

  it("blockerType: enum, settable, cleared with an empty string", () => {
    const t = repo.createTask({ milestoneId, title: "T" });
    const b = repo.updateTask(t.id, { status: "blocked", reason: "waiting", blockerType: "external" });
    expect(b.blockerType).toBe("external");
    expect(repo.updateTask(t.id, { blockerType: "" }).blockerType).toBeNull();
    // bad enum -> 422
    try {
      // @ts-expect-error intentionally bad type
      repo.updateTask(t.id, { blockerType: "nope" });
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as AppError).status).toBe(422);
    }
  });

  it("milestone outcome: null by default, settable, independent of task %", () => {
    const m = repo.getMilestone(milestoneId)!;
    expect(m.outcome).toBeNull();
    repo.createTask({ milestoneId, title: "A", status: "done" });
    const upd = repo.updateMilestone(milestoneId, { outcome: "infeasible" });
    expect(upd.outcome).toBe("infeasible");
    // task % is still 100 (outcome is orthogonal)
    expect(repo.getMilestoneRollup(milestoneId)!.progress.percent).toBe(100);
    expect(repo.updateMilestone(milestoneId, { outcome: "" }).outcome).toBeNull();
  });

  it("artifacts: write and read in getTaskDetail; replacing the set", () => {
    const t = repo.createTask({
      milestoneId,
      title: "T",
      artifacts: [{ kind: "commit", value: "abc123", label: "fix" }],
    });
    let d = repo.getTaskDetail(t.id)!;
    expect(d.artifacts).toHaveLength(1);
    expect(d.artifacts[0].kind).toBe("commit");
    expect(d.artifacts[0].value).toBe("abc123");
    expect(d.artifacts[0].id).toMatch(/^art_/);
    // default kind = url; replace
    repo.updateTask(t.id, { artifacts: [{ value: "https://x/pr/1" }] });
    d = repo.getTaskDetail(t.id)!;
    expect(d.artifacts).toHaveLength(1);
    expect(d.artifacts[0].kind).toBe("url");
    // an empty array clears them
    repo.updateTask(t.id, { artifacts: [] });
    expect(repo.getTaskDetail(t.id)!.artifacts).toHaveLength(0);
  });

  it("relatedTo: symmetric soft links in getTaskDetail", () => {
    const a = repo.createTask({ milestoneId, title: "A" });
    const b = repo.createTask({ milestoneId, title: "B" });
    repo.updateTask(a.id, { relatedTo: [b.id] });
    // visible from both sides (symmetric)
    expect(repo.getTaskDetail(a.id)!.relatedTo.map((r) => r.id)).toEqual([b.id]);
    expect(repo.getTaskDetail(b.id)!.relatedTo.map((r) => r.id)).toEqual([a.id]);
    // cannot be related to itself
    try {
      repo.updateTask(a.id, { relatedTo: [a.id] });
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as AppError).status).toBe(422);
    }
  });

  it("bulk updateTasks: atomic; archiving many at once", () => {
    const a = repo.createTask({ milestoneId, title: "A" });
    const b = repo.createTask({ milestoneId, title: "B" });
    const res = repo.updateTasks([
      { id: a.id, status: "done" },
      { id: b.id, status: "done" },
    ]);
    expect(res.map((t) => t.status)).toEqual(["done", "done"]);
    // atomic: a bad element rolls back the whole batch
    const c = repo.createTask({ milestoneId, title: "C" });
    try {
      repo.updateTasks([
        { id: c.id, priority: "high" },
        // @ts-expect-error intentionally bad status
        { id: c.id, status: "nope" },
      ]);
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as AppError).status).toBe(422);
    }
    expect(repo.getTask(c.id)!.priority).toBe("none"); // rollback
  });

  it("bulk updateMilestones: archive N milestones in a single call", () => {
    const m2 = repo.createMilestone({ projectId, title: "M2" });
    const res = repo.updateMilestones([
      { id: milestoneId, status: "archived" },
      { id: m2.id, status: "archived" },
    ]);
    expect(res.every((m) => m.status === "archived")).toBe(true);
  });

  it("listTasks filters by ownerActorId (mine only)", () => {
    const me = repo.createActor({ name: "me" });
    const other = repo.createActor({ name: "other" });
    const mine = runWithContext({ actorId: me.id }, () =>
      repo.createTask({ milestoneId, title: "Mine" }),
    );
    runWithContext({ actorId: other.id }, () =>
      repo.createTask({ milestoneId, title: "Someone else's" }),
    );
    const got = repo.listTasks({ milestoneId, ownerActorId: me.id });
    expect(got.map((t) => t.id)).toEqual([mine.id]);
  });
});

describe("Repo - security (batch guards and hygiene)", () => {
  let repo: Repo;
  let milestoneId: string;
  beforeEach(() => {
    repo = freshRepo();
    const s = repo.createSolution({ name: "S" });
    const p = repo.createProject({ solutionId: s.id, name: "P" });
    milestoneId = repo.createMilestone({ projectId: p.id, title: "M" }).id;
  });

  it("createTasks rejects a batch > the limit (422)", () => {
    const huge = Array.from({ length: 1001 }, (_, i) => ({
      milestoneId,
      title: `T${i}`,
    }));
    try {
      repo.createTasks(huge);
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as AppError).status).toBe(422);
    }
    // nothing written (the guard runs before the transaction)
    expect(repo.listTasks({ milestoneId })).toHaveLength(0);
  });

  it("setArtifacts rejects a value that is too long (422)", () => {
    const t = repo.createTask({ milestoneId, title: "T" });
    try {
      repo.updateTask(t.id, {
        artifacts: [{ value: "x".repeat(2049) }],
      });
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as AppError).status).toBe(422);
    }
  });

  it("blockerType cleared when leaving blocked", () => {
    const t = repo.createTask({ milestoneId, title: "T" });
    repo.updateTask(t.id, { status: "blocked", reason: "waiting", blockerType: "external" });
    expect(repo.getTask(t.id)!.blockerType).toBe("external");
    // returns to in_progress without an explicit blockerType -> cleared
    const back = repo.updateTask(t.id, { status: "in_progress" });
    expect(back.blockerType).toBeNull();
  });
});

describe("DB - migration of an existing database (additive)", () => {
  it("adds parentTaskId/ownerActorId and new tables to an old database without error", () => {
    const dir = mkdtempSync(join(tmpdir(), "fs-mig-"));
    const path = join(dir, "old.db");
    // Old database: tasks without parentTaskId/ownerActorId; no task_labels/deps/actors.
    const old = new DatabaseSync(path);
    old.exec(
      `CREATE TABLE tasks (id TEXT PRIMARY KEY, milestoneId TEXT, title TEXT,
        description TEXT DEFAULT '', status TEXT DEFAULT 'todo', priority TEXT DEFAULT 'none',
        position REAL DEFAULT 0, clientRequestId TEXT, createdAt TEXT, updatedAt TEXT)`,
    );
    old.exec(
      `INSERT INTO tasks (id, milestoneId, title, createdAt, updatedAt)
       VALUES ('ta_old','ms_x','Old','t','t')`,
    );
    old.close();

    // Opening with the new code should NOT throw (this was a bug: CREATE INDEX on
    // the not-yet-existing parentTaskId column in SCHEMA).
    const repo = new Repo(createDatabase(path));
    const t = repo.getTask("ta_old");
    expect(t).not.toBeNull();
    expect(t!.parentTaskId).toBeNull();
    expect(t!.labels).toEqual([]);
    // the new tables work
    repo.setLabels("ta_old", ["x"]);
    expect(repo.getTask("ta_old")!.labels).toEqual(["x"]);

    rmSync(dir, { recursive: true, force: true });
  });
});

describe("Repo - completedToday (authoritative TODAY scoreboard)", () => {
  // Own db, so we can roll completedAt back to yesterday (simulating completion on another day).
  function repoWithDb(): { repo: Repo; db: DatabaseSync } {
    const db = createDatabase(":memory:");
    return { repo: new Repo(db), db };
  }

  it("counts tasks completed TODAY, skips ones completed yesterday", () => {
    const { repo, db } = repoWithDb();
    const c = repo.createSolution({ name: "Acme" });
    const p = repo.createProject({ solutionId: c.id, name: "Web" });
    const m = repo.createMilestone({ projectId: p.id, title: "M1" });
    // Two tasks completed today (the todo -> done transition stamps completedAt).
    const a = repo.createTask({ milestoneId: m.id, title: "A" });
    const b = repo.createTask({ milestoneId: m.id, title: "B" });
    repo.updateTask(a.id, { status: "done" });
    repo.updateTask(b.id, { status: "done" });
    // One "yesterday": roll completedAt back before midnight.
    const yesterday = new Date(Date.now() - 36 * 3600 * 1000).toISOString();
    const old = repo.createTask({ milestoneId: m.id, title: "Old" });
    repo.updateTask(old.id, { status: "done" });
    db.prepare(`UPDATE tasks SET completedAt = ? WHERE id = ?`).run(yesterday, old.id);

    const d = repo.getDashboard();
    expect(d.completedToday.tasks).toBe(2);
  });

  it("leaving done clears completedAt (no longer counts toward TODAY)", () => {
    const { repo } = repoWithDb();
    const c = repo.createSolution({ name: "Acme" });
    const p = repo.createProject({ solutionId: c.id, name: "Web" });
    const m = repo.createMilestone({ projectId: p.id, title: "M1" });
    const t = repo.createTask({ milestoneId: m.id, title: "T" });
    repo.updateTask(t.id, { status: "done" });
    expect(repo.getDashboard().completedToday.tasks).toBe(1);
    repo.updateTask(t.id, { status: "in_progress" });
    expect(repo.getTask(t.id)!.completedAt).toBeNull();
    expect(repo.getDashboard().completedToday.tasks).toBe(0);
  });

  it("done -> closed KEEPS completedAt (closed is terminal, does not clear history)", () => {
    const { repo } = repoWithDb();
    const c = repo.createSolution({ name: "Acme" });
    const p = repo.createProject({ solutionId: c.id, name: "Web" });
    const m = repo.createMilestone({ projectId: p.id, title: "M1" });
    const t = repo.createTask({ milestoneId: m.id, title: "T" });
    repo.updateTask(t.id, { status: "done" });
    const stamp = repo.getTask(t.id)!.completedAt;
    expect(stamp).not.toBeNull();
    expect(repo.getDashboard().completedToday.tasks).toBe(1);
    // Archiving a completed task (done -> closed) must NOT erase the stamp.
    repo.updateTask(t.id, { status: "closed" });
    expect(repo.getTask(t.id)!.completedAt).toBe(stamp);
    // Still counts toward TODAY (completedToday looks at status='done', so...)
    // - note: completedToday filters by status='done'; after going to 'closed'
    //   the task drops out of the TODAY counter, but the stamp stays for history.
    expect(repo.getTask(t.id)!.completedAt).not.toBeNull();
  });

  it("done -> todo (an open status) still CLEARS completedAt", () => {
    const { repo } = repoWithDb();
    const c = repo.createSolution({ name: "Acme" });
    const p = repo.createProject({ solutionId: c.id, name: "Web" });
    const m = repo.createMilestone({ projectId: p.id, title: "M1" });
    const t = repo.createTask({ milestoneId: m.id, title: "T" });
    repo.updateTask(t.id, { status: "done" });
    expect(repo.getTask(t.id)!.completedAt).not.toBeNull();
    repo.updateTask(t.id, { status: "todo" });
    expect(repo.getTask(t.id)!.completedAt).toBeNull();
    expect(repo.getDashboard().completedToday.tasks).toBe(0);
  });

  it("counts a milestone and project completed TODAY (MAX completedAt of tasks)", () => {
    const { repo } = repoWithDb();
    const c = repo.createSolution({ name: "Acme" });
    const p = repo.createProject({ solutionId: c.id, name: "Web" });
    const m = repo.createMilestone({ projectId: p.id, title: "M1" });
    repo.createTask({ milestoneId: m.id, title: "T1" });
    const t2 = repo.createTask({ milestoneId: m.id, title: "T2" });
    // Milestone/project still open (one todo) -> 0.
    expect(repo.getDashboard().completedToday.milestones).toBe(0);
    repo.updateTasks([
      { id: repo.listTasks({ milestoneId: m.id })[0].id, status: "done" },
      { id: t2.id, status: "done" },
    ]);
    const d = repo.getDashboard();
    expect(d.completedToday.milestones).toBe(1);
    expect(d.completedToday.projects).toBe(1);
  });

  it("a milestone completed YESTERDAY does not count toward TODAY", () => {
    const { repo, db } = repoWithDb();
    const c = repo.createSolution({ name: "Acme" });
    const p = repo.createProject({ solutionId: c.id, name: "Web" });
    const m = repo.createMilestone({ projectId: p.id, title: "M1" });
    const t = repo.createTask({ milestoneId: m.id, title: "T1" });
    repo.updateTask(t.id, { status: "done" });
    // the milestone is closed (100%), but roll completedAt back to yesterday.
    const yesterday = new Date(Date.now() - 36 * 3600 * 1000).toISOString();
    db.prepare(`UPDATE tasks SET completedAt = ? WHERE id = ?`).run(yesterday, t.id);
    const d = repo.getDashboard();
    // completed (cumulative) still sees the closed milestone...
    expect(d.completed.milestonesDone).toBe(1);
    // ...but completedToday no longer does (not closed today).
    expect(d.completedToday.milestones).toBe(0);
    expect(d.completedToday.projects).toBe(0);
  });
});

describe("Repo - dailyByStatus (live daily chart data)", () => {
  // Own db, so we can pin each status transition onto a specific civil date.
  function repoWithDb(): { repo: Repo; db: DatabaseSync } {
    const db = createDatabase(":memory:");
    return { repo: new Repo(db), db };
  }

  /** Move a task to `toStatus`, then stamp the just-recorded status-transition
   *  activity row at midday of `day` so date(at) lands on that civil day
   *  regardless of the runner's timezone. */
  function transitionOn(
    repo: Repo,
    db: DatabaseSync,
    taskId: string,
    toStatus: string,
    day: string,
  ): void {
    repo.updateTask(taskId, {
      status: toStatus as never,
      ...(toStatus === "blocked" ? { reason: "waiting" } : {}),
    });
    db.prepare(
      `UPDATE activity SET at = ?
       WHERE id = (SELECT id FROM activity
                   WHERE entityType = 'task' AND entityId = ? AND action = 'status'
                   ORDER BY at DESC, rowid DESC LIMIT 1)`,
    ).run(`${day}T12:00:00.000Z`, taskId);
  }

  it("groups status transitions by day and target status into a matrix", () => {
    const { repo, db } = repoWithDb();
    const s = repo.createSolution({ name: "Globex" });
    const p = repo.createProject({ solutionId: s.id, name: "Web" });
    const m = repo.createMilestone({ projectId: p.id, title: "M1" }).id;

    const t1 = repo.createTask({ milestoneId: m, title: "T1" });
    const t2 = repo.createTask({ milestoneId: m, title: "T2" });
    const t3 = repo.createTask({ milestoneId: m, title: "T3" });

    // Day 1: two tasks -> in_progress, one task -> blocked.
    transitionOn(repo, db, t1.id, "in_progress", "2026-05-01");
    transitionOn(repo, db, t2.id, "in_progress", "2026-05-01");
    transitionOn(repo, db, t3.id, "blocked", "2026-05-01");
    // Day 2: two tasks -> done (from different prior statuses).
    transitionOn(repo, db, t1.id, "done", "2026-05-02");
    transitionOn(repo, db, t3.id, "done", "2026-05-02");

    const chart = repo.getDashboard().dailyByStatus;
    expect(chart.days).toEqual(["2026-05-01", "2026-05-02"]);
    // Only statuses with transitions appear, ordered by STATUS_ORDER.
    expect(chart.statuses).toEqual(["in_progress", "blocked", "done"]);
    expect(chart.counts.length).toBe(2);
    expect(chart.counts.every((row) => row.length === chart.statuses.length)).toBe(true);

    const ip = chart.statuses.indexOf("in_progress");
    const bl = chart.statuses.indexOf("blocked");
    const dn = chart.statuses.indexOf("done");
    expect(chart.counts[0][ip]).toBe(2); // 2026-05-01 in_progress
    expect(chart.counts[0][bl]).toBe(1); // 2026-05-01 blocked
    expect(chart.counts[0][dn]).toBe(0); // 2026-05-01 done
    expect(chart.counts[1][ip]).toBe(0); // 2026-05-02 in_progress
    expect(chart.counts[1][dn]).toBe(2); // 2026-05-02 done (in_progress->done + blocked->done)
  });

  it("is empty when no status transitions have happened", () => {
    const { repo } = repoWithDb();
    const s = repo.createSolution({ name: "Globex" });
    const p = repo.createProject({ solutionId: s.id, name: "Web" });
    const m = repo.createMilestone({ projectId: p.id, title: "M1" }).id;
    repo.createTask({ milestoneId: m, title: "Open" }); // creation is not a status transition
    const chart = repo.getDashboard().dailyByStatus;
    expect(chart.days).toEqual([]);
    expect(chart.statuses).toEqual([]);
    expect(chart.counts).toEqual([]);
  });

  it("a solution-scoped key only sees its own solution's transitions", () => {
    const { repo, db } = repoWithDb();
    const sA = repo.createSolution({ name: "Globex" });
    const pA = repo.createProject({ solutionId: sA.id, name: "Web" });
    const mA = repo.createMilestone({ projectId: pA.id, title: "M-A" }).id;
    const sB = repo.createSolution({ name: "Acme" });
    const pB = repo.createProject({ solutionId: sB.id, name: "App" });
    const mB = repo.createMilestone({ projectId: pB.id, title: "M-B" }).id;

    const a1 = repo.createTask({ milestoneId: mA, title: "A1" });
    const b1 = repo.createTask({ milestoneId: mB, title: "B1" });
    transitionOn(repo, db, a1.id, "in_progress", "2026-05-01");
    transitionOn(repo, db, b1.id, "done", "2026-05-02");

    // Unscoped (admin) sees both solutions' transitions.
    const all = repo.getDashboard().dailyByStatus;
    expect(all.days).toEqual(["2026-05-01", "2026-05-02"]);
    expect(all.statuses).toEqual(["in_progress", "done"]);

    // A key scoped to solution A sees ONLY A's transitions and days.
    const scoped = runWithContext(
      { keySolutionId: sA.id, keyScope: "read" },
      () => repo.getDashboard().dailyByStatus,
    );
    expect(scoped.days).toEqual(["2026-05-01"]);
    expect(scoped.statuses).toEqual(["in_progress"]);
    expect(scoped.counts).toEqual([[1]]);
  });
});
