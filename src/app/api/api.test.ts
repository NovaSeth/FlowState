import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Isolated temp file DB so the singleton repo writes somewhere disposable.
// IMPORTANT: env must be set BEFORE the route modules (which bind the singleton
// via getDb()) are imported, so we use dynamic import inside beforeAll.
const dir = mkdtempSync(join(tmpdir(), "fs-api-"));
process.env.FS_DB_PATH = join(dir, "test.db");
delete process.env.FS_API_KEY; // open mode for tests

type Mod = Record<string, (req: Request, ctx?: unknown) => Promise<Response>>;
type Ctx = { params: Promise<{ id: string }> };

let solutions: Mod;
let clientById: Mod;
let projects: Mod;
let milestones: Mod;
let milestonesById: Mod;
let tasks: Mod;
let taskById: Mod;
let taskComments: Mod;
let dashboard: Mod;
let changes: Mod;
let tasksSearch: Mod;
let actors: Mod;
let keys: Mod;
let keyById: Mod;
let activityMod: Mod;
let me: Mod;

const ctx = (id: string): Ctx => ({ params: Promise.resolve({ id }) });
const post = (url: string, body: unknown) =>
  new Request(url, { method: "POST", body: JSON.stringify(body) });
const patch = (url: string, body: unknown) =>
  new Request(url, { method: "PATCH", body: JSON.stringify(body) });

beforeAll(async () => {
  solutions = (await import("@/app/api/solutions/route")) as unknown as Mod;
  clientById = (await import("@/app/api/solutions/[id]/route")) as unknown as Mod;
  projects = (await import("@/app/api/projects/route")) as unknown as Mod;
  milestones = (await import("@/app/api/milestones/route")) as unknown as Mod;
  milestonesById = (await import("@/app/api/milestones/[id]/route")) as unknown as Mod;
  tasks = (await import("@/app/api/tasks/route")) as unknown as Mod;
  taskById = (await import("@/app/api/tasks/[id]/route")) as unknown as Mod;
  taskComments = (await import(
    "@/app/api/tasks/[id]/comments/route"
  )) as unknown as Mod;
  dashboard = (await import("@/app/api/dashboard/route")) as unknown as Mod;
  changes = (await import("@/app/api/changes/route")) as unknown as Mod;
  tasksSearch = (await import("@/app/api/tasks/search/route")) as unknown as Mod;
  actors = (await import("@/app/api/actors/route")) as unknown as Mod;
  keys = (await import("@/app/api/keys/route")) as unknown as Mod;
  keyById = (await import("@/app/api/keys/[id]/route")) as unknown as Mod;
  activityMod = (await import("@/app/api/activity/route")) as unknown as Mod;
  me = (await import("@/app/api/me/route")) as unknown as Mod;
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("API routes", () => {
  // Shared ids built up across ordered tests.
  let solutionId = "";
  let projectId = "";
  let milestoneId = "";
  let taskId = "";

  it("POST /api/solutions -> 201, GET -> 200 includes it", async () => {
    const res = await solutions.POST(post("http://t/api/solutions", { name: "Acme" }));
    expect(res.status).toBe(201);
    const solution = await res.json();
    expect(solution.name).toBe("Acme");
    solutionId = solution.id;

    const listRes = await solutions.GET(new Request("http://t/api/solutions"));
    expect(listRes.status).toBe(200);
    const list = await listRes.json();
    expect(Array.isArray(list)).toBe(true);
    expect(list.some((c: { id: string }) => c.id === solutionId)).toBe(true);
  });

  it("POST /api/projects -> 201 (no default milestone)", async () => {
    const res = await projects.POST(
      post("http://t/api/projects", { solutionId, name: "Website" }),
    );
    expect(res.status).toBe(201);
    const project = await res.json();
    expect(project.solutionId).toBe(solutionId);
    projectId = project.id;

    // The project starts empty - no milestone is created automatically.
    const msRes = await milestones.GET(
      new Request(`http://t/api/milestones?projectId=${projectId}`),
    );
    expect(msRes.status).toBe(200);
    const ms = await msRes.json();
    expect(ms).toHaveLength(0);
  });

  it("POST /api/milestones -> 201 (milestone created deliberately)", async () => {
    const res = await milestones.POST(
      post("http://t/api/milestones", {
        projectId,
        title: "REST API with task CRUD",
      }),
    );
    expect(res.status).toBe(201);
    const milestone = await res.json();
    expect(milestone.projectId).toBe(projectId);
    milestoneId = milestone.id;
  });

  it("GET /api/milestones without projectId -> 400", async () => {
    const res = await milestones.GET(new Request("http://t/api/milestones"));
    expect(res.status).toBe(400);
  });

  it("POST /api/tasks with an array -> 201 bulk create", async () => {
    const res = await tasks.POST(
      post("http://t/api/tasks", [
        { milestoneId, title: "Task A" },
        { milestoneId, title: "Task B" },
        { milestoneId, title: "Task C" },
      ]),
    );
    expect(res.status).toBe(201);
    const created = await res.json();
    expect(Array.isArray(created)).toBe(true);
    expect(created).toHaveLength(3);
    taskId = created[0].id;
  });

  it("POST /api/tasks with a single object -> 201 Task", async () => {
    const res = await tasks.POST(
      post("http://t/api/tasks", { milestoneId, title: "Solo" }),
    );
    expect(res.status).toBe(201);
    const task = await res.json();
    expect(task.title).toBe("Solo");
    expect(Array.isArray(task)).toBe(false);
  });

  it("PATCH /api/tasks/[id] flips status -> 200 and reflects", async () => {
    const res = await taskById.PATCH(
      patch(`http://t/api/tasks/${taskId}`, { status: "in_progress" }),
      ctx(taskId),
    );
    expect(res.status).toBe(200);
    const task = await res.json();
    expect(task.status).toBe("in_progress");
  });

  it("GET /api/tasks/[id]?expand=comments includes comments array", async () => {
    const addRes = await taskComments.POST(
      post(`http://t/api/tasks/${taskId}/comments`, { body: "first note" }),
      ctx(taskId),
    );
    expect(addRes.status).toBe(201);

    const res = await taskById.GET(
      new Request(`http://t/api/tasks/${taskId}?expand=comments`),
      ctx(taskId),
    );
    expect(res.status).toBe(200);
    const task = await res.json();
    expect(Array.isArray(task.comments)).toBe(true);
    expect(task.comments).toHaveLength(1);
    expect(task.comments[0].body).toBe("first note");
  });

  it("GET /api/solutions/[id] missing -> 404", async () => {
    const res = await clientById.GET(
      new Request("http://t/api/solutions/cl_does_not_exist"),
      ctx("cl_does_not_exist"),
    );
    expect(res.status).toBe(404);
  });

  it("GET /api/tasks/[id] missing -> 404", async () => {
    const res = await taskById.GET(
      new Request("http://t/api/tasks/ta_nope"),
      ctx("ta_nope"),
    );
    expect(res.status).toBe(404);
  });

  it("POST /api/tasks with invalid enum -> 422", async () => {
    const res = await tasks.POST(
      post("http://t/api/tasks", {
        milestoneId,
        title: "Bad",
        status: "not_a_status",
      }),
    );
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  it("POST /api/solutions with invalid JSON -> 400", async () => {
    const res = await solutions.POST(
      new Request("http://t/api/solutions", { method: "POST", body: "{not json" }),
    );
    expect(res.status).toBe(400);
  });

  it("GET /api/dashboard -> 200 with totals", async () => {
    const res = await dashboard.GET(new Request("http://t/api/dashboard"));
    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.totals.solutions).toBeGreaterThanOrEqual(1);
    expect(payload.totals.projects).toBeGreaterThanOrEqual(1);
    expect(payload.totals.tasks).toBeGreaterThanOrEqual(4);
    expect(Array.isArray(payload.solutions)).toBe(true);
  });

  it("GET /api/changes returns serverTime + full snapshot when since is empty", async () => {
    const res = await changes.GET(new Request("http://t/api/changes"));
    expect(res.status).toBe(200);
    const p = await res.json();
    expect(typeof p.serverTime).toBe("string");
    expect(typeof p.since).toBe("string");
    expect(Array.isArray(p.solutions)).toBe(true);
    expect(Array.isArray(p.tasks)).toBe(true);
    expect(p.solutions.length).toBeGreaterThanOrEqual(1);
    expect(p.tasks.length).toBeGreaterThanOrEqual(1);
  });

  it("GET /api/changes?since=futureFar returns empty buckets", async () => {
    const res = await changes.GET(
      new Request("http://t/api/changes?since=9999-12-31T23:59:59.999Z"),
    );
    expect(res.status).toBe(200);
    const p = await res.json();
    expect(p.solutions).toEqual([]);
    expect(p.projects).toEqual([]);
    expect(p.milestones).toEqual([]);
    expect(p.tasks).toEqual([]);
    expect(p.comments).toEqual([]);
  });

  it("GET /api/tasks?solutionId= returns tasks of the whole solution", async () => {
    const res = await tasks.GET(
      new Request(`http://t/api/tasks?solutionId=${solutionId}`),
    );
    expect(res.status).toBe(200);
    const list = await res.json();
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBeGreaterThanOrEqual(1);
  });

  it("GET /api/tasks/search?q= finds by title, with context", async () => {
    const res = await tasksSearch.GET(
      new Request("http://t/api/tasks/search?q=solo"),
    );
    expect(res.status).toBe(200);
    const hits = await res.json();
    expect(hits.some((h: { title: string }) => h.title === "Solo")).toBe(true);
    expect(hits[0].context.solutionId).toBe(solutionId);
  });

  it("GET /api/tasks/search without q -> 422", async () => {
    const res = await tasksSearch.GET(new Request("http://t/api/tasks/search?q="));
    expect(res.status).toBe(422);
  });

  it("PATCH status=blocked without a reason -> 422; with a reason -> 200 + comment", async () => {
    const created = await (
      await tasks.POST(post("http://t/api/tasks", { milestoneId, title: "To be blocked" }))
    ).json();
    const id = created.id;

    const bad = await taskById.PATCH(
      patch(`http://t/api/tasks/${id}`, { status: "blocked" }),
      ctx(id),
    );
    expect(bad.status).toBe(422);

    const ok = await taskById.PATCH(
      patch(`http://t/api/tasks/${id}`, { status: "blocked", reason: "waiting for a decision" }),
      ctx(id),
    );
    expect(ok.status).toBe(200);
    expect((await ok.json()).status).toBe("blocked");

    const withComments = await taskById.GET(
      new Request(`http://t/api/tasks/${id}?expand=comments`),
      ctx(id),
    );
    const task = await withComments.json();
    expect(task.comments.some((c: { body: string }) => c.body === "waiting for a decision")).toBe(true);
  });

  it("special characters in description pass through raw (no HTML escaping)", async () => {
    const raw = 'a < b & c > d transformers<5';
    const created = await (
      await tasks.POST(post("http://t/api/tasks", { milestoneId, title: "Escape", description: raw }))
    ).json();
    expect(created.description).toBe(raw);

    const fetched = await (
      await taskById.GET(new Request(`http://t/api/tasks/${created.id}`), ctx(created.id))
    ).json();
    expect(fetched.description).toBe(raw);
  });

  // --- Stream C: identity, keys, audit ---

  it("POST /api/actors -> 201 (human)", async () => {
    const res = await actors.POST(post("http://t/api/actors", { kind: "human", name: "Operator" }));
    expect(res.status).toBe(201);
    expect((await res.json()).kind).toBe("human");
  });

  it("POST /api/keys -> token once; GET /api/keys does not expose the secret", async () => {
    const res = await keys.POST(post("http://t/api/keys", { actorName: "ci-agent", scope: "write" }));
    expect(res.status).toBe(201);
    const created = await res.json();
    expect(typeof created.token).toBe("string");
    expect(created.token).toContain(".");

    const listRes = await keys.GET(new Request("http://t/api/keys"));
    const list = await listRes.json();
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list[0].secretHash).toBeUndefined();
    expect(list[0].token).toBeUndefined();
  });

  it("DELETE /api/keys/:id revokes", async () => {
    const created = await (
      await keys.POST(post("http://t/api/keys", { actorName: "tmp" }))
    ).json();
    const res = await keyById.DELETE(
      new Request(`http://t/api/keys/${created.id}`, { method: "DELETE" }),
      ctx(created.id),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).revokedAt).toBeTruthy();
  });

  it("GET /api/me without a key -> actor null", async () => {
    const res = await me.GET(new Request("http://t/api/me"));
    expect((await res.json()).actor).toBeNull();
  });

  it("attribution via x-api-key: owner + whoami + activity", async () => {
    const key = await (
      await keys.POST(post("http://t/api/keys", { actorName: "attrib-agent" }))
    ).json();
    const auth = { "content-type": "application/json", "x-api-key": key.token };

    const tRes = await tasks.POST(
      new Request("http://t/api/tasks", {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ milestoneId, title: "Owned by agent" }),
      }),
    );
    const task = await tRes.json();
    expect(task.ownerActorId).toBe(key.actorId);

    const meRes = await me.GET(
      new Request("http://t/api/me", { headers: { "x-api-key": key.token } }),
    );
    expect((await meRes.json()).actor.id).toBe(key.actorId);

    const actRes = await activityMod.GET(
      new Request(`http://t/api/activity?entityId=${task.id}`),
    );
    const acts = await actRes.json();
    expect(
      acts.some((a: { action: string; actorId: string }) => a.action === "create" && a.actorId === key.actorId),
    ).toBe(true);
  });

  it("bad x-api-key -> 401", async () => {
    const res = await tasks.POST(
      new Request("http://t/api/tasks", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": "fsk_dead.beef" },
        body: JSON.stringify({ milestoneId, title: "X" }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("a read key cannot mutate (403)", async () => {
    const readKey = await (
      await keys.POST(post("http://t/api/keys", { actorName: "ro", scope: "read" }))
    ).json();
    const res = await tasks.POST(
      new Request("http://t/api/tasks", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": readKey.token },
        body: JSON.stringify({ milestoneId, title: "x" }),
      }),
    );
    expect(res.status).toBe(403);
  });

  it("delegation does not widen the solution scope (403)", async () => {
    const scoped = await (
      await keys.POST(post("http://t/api/keys", { actorName: "scoped", solutionId }))
    ).json();
    // a solution-scoped key mints a global child -> 403
    const res = await keys.POST(
      new Request("http://t/api/keys", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": scoped.token },
        body: JSON.stringify({ actorName: "child" }),
      }),
    );
    expect(res.status).toBe(403);
  });

  it("a key can revoke itself", async () => {
    const self = await (
      await keys.POST(post("http://t/api/keys", { actorName: "selfrev" }))
    ).json();
    const res = await keyById.DELETE(
      new Request(`http://t/api/keys/${self.id}`, {
        method: "DELETE",
        headers: { "x-api-key": self.token },
      }),
      ctx(self.id),
    );
    expect(res.status).toBe(200);
  });

  it("bulk POST /api/tasks with a bad element rolls back the whole batch (atomic)", async () => {
    const ms = await (
      await milestones.POST(
        post("http://t/api/milestones", { projectId, title: "Bulk atomic" }),
      )
    ).json();
    const res = await tasks.POST(
      post("http://t/api/tasks", [
        { milestoneId: ms.id, title: "OK1" },
        { milestoneId: ms.id, title: "BAD", status: "not_a_status" },
        { milestoneId: ms.id, title: "OK2" },
      ]),
    );
    expect(res.status).toBe(422);
    // None of the elements should be created.
    const listRes = await tasks.GET(
      new Request(`http://t/api/tasks?milestoneId=${ms.id}`),
    );
    expect(await listRes.json()).toHaveLength(0);
  });

  it("bulk PATCH /api/tasks updates many tasks in a single call", async () => {
    const ms = await (
      await milestones.POST(post("http://t/api/milestones", { projectId, title: "Bulk patch" }))
    ).json();
    const created = await (
      await tasks.POST(
        post("http://t/api/tasks", [
          { milestoneId: ms.id, title: "X" },
          { milestoneId: ms.id, title: "Y" },
        ]),
      )
    ).json();
    const res = await tasks.PATCH(
      patch("http://t/api/tasks", [
        { id: created[0].id, status: "done" },
        { id: created[1].id, status: "done" },
      ]),
    );
    expect(res.status).toBe(200);
    const updated = await res.json();
    expect(updated.every((t: { status: string }) => t.status === "done")).toBe(true);
  });

  it("PATCH /api/tasks/[id] passes through verified + artifacts + milestone outcome", async () => {
    const ms = await (
      await milestones.POST(post("http://t/api/milestones", { projectId, title: "Enrichments" }))
    ).json();
    const t = await (
      await tasks.POST(post("http://t/api/tasks", { milestoneId: ms.id, title: "Code" }))
    ).json();
    const upd = await (
      await taskById.PATCH(
        patch(`http://t/api/tasks/${t.id}`, {
          verified: true,
          artifacts: [{ kind: "commit", value: "deadbeef", label: "fix" }],
        }),
        ctx(t.id),
      )
    ).json();
    expect(upd.verified).toBe(true);
    // detail returns the artifacts
    const detail = await (
      await taskById.GET(new Request(`http://t/api/tasks/${t.id}`), ctx(t.id))
    ).json();
    expect(detail.artifacts).toHaveLength(1);
    expect(detail.artifacts[0].value).toBe("deadbeef");
    // milestone outcome via a single PATCH
    const mUpd = await milestones.PATCH(
      patch("http://t/api/milestones", [{ id: ms.id, outcome: "shipped" }]),
    );
    expect((await mUpd.json())[0].outcome).toBe("shipped");
  });

  it("GET /api/tasks?limit= is clamped (does not throw; respects an explicit small limit)", async () => {
    // explicit small limit returns at most that many
    const small = await tasks.GET(
      new Request(`http://t/api/tasks?solutionId=${solutionId}&limit=1`),
    );
    expect(small.status).toBe(200);
    expect((await small.json()).length).toBeLessThanOrEqual(1);
    // an absurd limit is clamped (no error, still returns)
    const huge = await tasks.GET(
      new Request(`http://t/api/tasks?solutionId=${solutionId}&limit=999999`),
    );
    expect(huge.status).toBe(200);
    expect(Array.isArray(await huge.json())).toBe(true);
    // a garbage limit falls back to the default (no error)
    const bad = await tasks.GET(
      new Request(`http://t/api/tasks?solutionId=${solutionId}&limit=abc`),
    );
    expect(bad.status).toBe(200);
  });

  // --- API-key solution scope enforcement ---
  describe("solution-scoped key", () => {
    // Two solutions, each with a project/milestone/task. A WRITE key scoped to A
    // must be confined to A: 200 in A, 403 in B; reads of B enumerate empty / 403.
    let solA = "";
    let solB = "";
    let msA = "";
    let msB = "";
    let taskB = "";
    let scopedTokenA = "";

    const auth = (token: string) => ({
      "content-type": "application/json",
      "x-api-key": token,
    });
    const postAs = (token: string, url: string, body: unknown) =>
      new Request(url, { method: "POST", headers: auth(token), body: JSON.stringify(body) });
    const patchAs = (token: string, url: string, body: unknown) =>
      new Request(url, { method: "PATCH", headers: auth(token), body: JSON.stringify(body) });
    const getAs = (token: string, url: string) =>
      new Request(url, { headers: { "x-api-key": token } });

    beforeAll(async () => {
      solA = (await (await solutions.POST(post("http://t/api/solutions", { name: "ScopeA" }))).json()).id;
      solB = (await (await solutions.POST(post("http://t/api/solutions", { name: "ScopeB" }))).json()).id;
      const pA = (await (await projects.POST(post("http://t/api/projects", { solutionId: solA, name: "PA" }))).json()).id;
      const pB = (await (await projects.POST(post("http://t/api/projects", { solutionId: solB, name: "PB" }))).json()).id;
      msA = (await (await milestones.POST(post("http://t/api/milestones", { projectId: pA, title: "MA" }))).json()).id;
      msB = (await (await milestones.POST(post("http://t/api/milestones", { projectId: pB, title: "MB" }))).json()).id;
      taskB = (await (await tasks.POST(post("http://t/api/tasks", { milestoneId: msB, title: "secret B" }))).json()).id;
      // A write key scoped to solution A (default scope = write).
      const k = await (await keys.POST(post("http://t/api/keys", { actorName: "scopeA-agent", solutionId: solA }))).json();
      scopedTokenA = k.token;
    });

    it("can create a task in its own solution (201)", async () => {
      const res = await tasks.POST(postAs(scopedTokenA, "http://t/api/tasks", { milestoneId: msA, title: "in A" }));
      expect(res.status).toBe(201);
    });

    it("cannot create a task in another solution (403)", async () => {
      const res = await tasks.POST(postAs(scopedTokenA, "http://t/api/tasks", { milestoneId: msB, title: "into B" }));
      expect(res.status).toBe(403);
      // and B did not gain the task
      const listB = await tasks.GET(new Request(`http://t/api/tasks?milestoneId=${msB}`));
      expect((await listB.json()).every((t: { title: string }) => t.title !== "into B")).toBe(true);
    });

    it("cannot update a task in another solution (403)", async () => {
      const res = await taskById.PATCH(
        patchAs(scopedTokenA, `http://t/api/tasks/${taskB}`, { status: "in_progress" }),
        ctx(taskB),
      );
      expect(res.status).toBe(403);
    });

    it("cannot read a single task in another solution (403)", async () => {
      const res = await taskById.GET(getAs(scopedTokenA, `http://t/api/tasks/${taskB}`), ctx(taskB));
      expect(res.status).toBe(403);
    });

    it("cannot read a milestone rollup in another solution (403)", async () => {
      const res = await milestonesById.GET(
        getAs(scopedTokenA, `http://t/api/milestones/${msB}`),
        ctx(msB),
      );
      expect(res.status).toBe(403);
    });

    it("list/search are forced to its own solution (cannot enumerate B)", async () => {
      // listTasks with a B filter is overridden to A -> no B tasks
      const list = await tasks.GET(getAs(scopedTokenA, `http://t/api/tasks?solutionId=${solB}`));
      expect(list.status).toBe(200);
      const items = await list.json();
      expect(items.every((t: { id: string }) => t.id !== taskB)).toBe(true);
      // search is forced to A as well
      const search = await tasksSearch.GET(getAs(scopedTokenA, "http://t/api/tasks/search?q=secret"));
      expect(search.status).toBe(200);
      expect((await search.json()).every((t: { id: string }) => t.id !== taskB)).toBe(true);
      // listSolutions returns only A
      const sols = await solutions.GET(getAs(scopedTokenA, "http://t/api/solutions"));
      const solIds = (await sols.json()).map((s: { id: string }) => s.id);
      expect(solIds).toContain(solA);
      expect(solIds).not.toContain(solB);
    });

    it("cannot create or mutate another solution; can update its own", async () => {
      // create another solution -> 403
      const create = await solutions.POST(postAs(scopedTokenA, "http://t/api/solutions", { name: "Nope" }));
      expect(create.status).toBe(403);
      // mutate B -> 403
      const mutB = await clientById.PATCH(patchAs(scopedTokenA, `http://t/api/solutions/${solB}`, { name: "hijack" }), ctx(solB));
      expect(mutB.status).toBe(403);
      // mutate its own A -> 200
      const mutA = await clientById.PATCH(patchAs(scopedTokenA, `http://t/api/solutions/${solA}`, { description: "owned" }), ctx(solA));
      expect(mutA.status).toBe(200);
    });

    it("GET /api/keys only returns the scoped solution's keys", async () => {
      const res = await keys.GET(getAs(scopedTokenA, "http://t/api/keys"));
      expect(res.status).toBe(200);
      const list = await res.json();
      expect(list.length).toBeGreaterThanOrEqual(1);
      expect(list.every((k: { solutionId: string | null }) => k.solutionId === solA)).toBe(true);
    });

    it("GET /api/dashboard is confined to the scoped solution; admin sees both", async () => {
      // Give B an urgent task so it would normally surface in attention/recent.
      const urgentB = await (
        await tasks.POST(
          post("http://t/api/tasks", {
            milestoneId: msB,
            title: "URGENT B leak probe",
            priority: "urgent",
          }),
        )
      ).json();

      // Scoped dashboard: only solution A, no B titles anywhere.
      const scopedRes = await dashboard.GET(
        getAs(scopedTokenA, "http://t/api/dashboard"),
      );
      expect(scopedRes.status).toBe(200);
      const scopedPayload = await scopedRes.json();

      const scopedSolIds = scopedPayload.solutions.map(
        (s: { id: string }) => s.id,
      );
      expect(scopedSolIds).toContain(solA);
      expect(scopedSolIds).not.toContain(solB);
      expect(scopedPayload.totals.solutions).toBe(1);

      const scopedTitles = JSON.stringify([
        scopedPayload.attention,
        scopedPayload.recent,
        scopedPayload.solutions,
      ]);
      expect(scopedTitles).not.toContain("secret B");
      expect(scopedTitles).not.toContain("URGENT B leak probe");
      expect(
        scopedPayload.attention.every((t: { id: string }) => t.id !== urgentB.id),
      ).toBe(true);
      expect(
        scopedPayload.recent.every((t: { id: string }) => t.id !== taskB),
      ).toBe(true);
      expect(scopedPayload.completedIds.solutions).not.toContain(solB);

      // Admin/unscoped dashboard: both solutions, B titles present.
      const adminRes = await dashboard.GET(
        new Request("http://t/api/dashboard"),
      );
      const adminPayload = await adminRes.json();
      const adminSolIds = adminPayload.solutions.map((s: { id: string }) => s.id);
      expect(adminSolIds).toContain(solA);
      expect(adminSolIds).toContain(solB);
      expect(adminPayload.totals.solutions).toBeGreaterThanOrEqual(2);
      expect(
        adminPayload.attention.some((t: { id: string }) => t.id === urgentB.id),
      ).toBe(true);
    });

    it("an admin/unscoped key is unaffected (can read across solutions)", async () => {
      // unscoped write key created in open mode
      const unscoped = await (await keys.POST(post("http://t/api/keys", { actorName: "global-agent" }))).json();
      const res = await taskById.GET(getAs(unscoped.token, `http://t/api/tasks/${taskB}`), ctx(taskB));
      expect(res.status).toBe(200);
      // and anonymous (open mode) too
      const anon = await taskById.GET(new Request(`http://t/api/tasks/${taskB}`), ctx(taskB));
      expect(anon.status).toBe(200);
    });
  });

  it("a non-owner cannot revoke someone else's key (403)", async () => {
    const victim = await (
      await keys.POST(post("http://t/api/keys", { actorName: "victim" }))
    ).json();
    const attacker = await (
      await keys.POST(post("http://t/api/keys", { actorName: "attacker" }))
    ).json();
    const res = await keyById.DELETE(
      new Request(`http://t/api/keys/${victim.id}`, {
        method: "DELETE",
        headers: { "x-api-key": attacker.token },
      }),
      ctx(victim.id),
    );
    expect(res.status).toBe(403);
  });
});
