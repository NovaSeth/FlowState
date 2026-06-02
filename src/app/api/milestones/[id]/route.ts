import { repo } from "@/lib/repo";
import { json, noContent, readJson, route } from "@/lib/http";
import { notFound } from "@/lib/errors";
import type { UpdateMilestoneInput } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async (_req, ctx) => {
  const { id } = await ctx.params;
  const rollup = repo().getMilestoneRollup(id);
  if (!rollup) throw notFound("milestone");
  return json(rollup);
});

export const PATCH = route(async (req, ctx) => {
  const { id } = await ctx.params;
  const body = (await readJson(req)) as UpdateMilestoneInput;
  return json(repo().updateMilestone(id, body));
});

export const DELETE = route(async (req, ctx) => {
  const { id } = await ctx.params;
  repo().deleteMilestone(id);
  return noContent();
});
