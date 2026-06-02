import { repo } from "@/lib/repo";
import { json, noContent, readJson, route } from "@/lib/http";
import { notFound } from "@/lib/errors";
import type { UpdateTaskInput } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async (req, ctx) => {
  const { id } = await ctx.params;
  // Detail = task + blockedBy + subtasks + rollup of subtask progress.
  const detail = repo().getTaskDetail(id);
  if (!detail) throw notFound("task");
  const expand = new URL(req.url).searchParams.get("expand") ?? "";
  if (expand.split(",").includes("comments")) {
    return json({ ...detail, comments: repo().listComments(id) });
  }
  return json(detail);
});

export const PATCH = route(async (req, ctx) => {
  const { id } = await ctx.params;
  const body = (await readJson(req)) as UpdateTaskInput;
  return json(repo().updateTask(id, body));
});

export const DELETE = route(async (req, ctx) => {
  const { id } = await ctx.params;
  repo().deleteTask(id);
  return noContent();
});
