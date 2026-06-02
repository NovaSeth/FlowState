import { repo } from "@/lib/repo";
import { json, readJson, route } from "@/lib/http";
import type { CreateTaskInput, TaskBulkUpdate } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async (req) => {
  const sp = new URL(req.url).searchParams;
  const limitRaw = sp.get("limit");
  return json(
    repo().listTasksWithMeta({
      milestoneId: sp.get("milestoneId") ?? undefined,
      projectId: sp.get("projectId") ?? undefined,
      solutionId: sp.get("solutionId") ?? undefined,
      status: sp.get("status") ?? undefined,
      priority: sp.get("priority") ?? undefined,
      parentTaskId: sp.get("parentTaskId") ?? undefined,
      label: sp.get("label") ?? undefined,
      ownerActorId: sp.get("ownerActorId") ?? undefined,
      // Bound: the repo clamps this to [1, MAX]; default applies when absent.
      limit: limitRaw ? Number(limitRaw) : undefined,
    }),
  );
});

export const POST = route(async (req) => {
  const body = await readJson(req);
  const r = repo();
  if (Array.isArray(body)) {
    // Atomic: an error on any element rolls back the whole batch.
    const created = r.createTasks(body as CreateTaskInput[]);
    return json(created, 201);
  }
  return json(r.createTask(body as CreateTaskInput), 201);
});

// Bulk update (atomic): array of {id, ...patch} - e.g. archiving many tasks.
export const PATCH = route(async (req) => {
  const body = await readJson(req);
  if (!Array.isArray(body)) {
    return json({ error: "Expected an array of {id, ...patch}" }, 400);
  }
  return json(repo().updateTasks(body as TaskBulkUpdate[]));
});
