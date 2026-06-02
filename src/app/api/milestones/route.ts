import { repo } from "@/lib/repo";
import { json, readJson, route } from "@/lib/http";
import { badRequest } from "@/lib/errors";
import type { CreateMilestoneInput, MilestoneBulkUpdate } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async (req) => {
  const projectId = new URL(req.url).searchParams.get("projectId");
  if (!projectId) throw badRequest("projectId query parameter is required");
  return json(repo().listMilestones(projectId));
});

export const POST = route(async (req) => {
  const body = (await readJson(req)) as CreateMilestoneInput;
  return json(repo().createMilestone(body), 201);
});

// Bulk update (atomic): array of {id, ...patch} - e.g. archiving many milestones.
export const PATCH = route(async (req) => {
  const body = await readJson(req);
  if (!Array.isArray(body)) {
    return json({ error: "Expected an array of {id, ...patch}" }, 400);
  }
  return json(repo().updateMilestones(body as MilestoneBulkUpdate[]));
});
