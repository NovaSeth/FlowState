import { repo } from "@/lib/repo";
import { json, noContent, readJson, route } from "@/lib/http";
import { notFound } from "@/lib/errors";
import type { UpdateSolutionInput } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async (_req, ctx) => {
  const { id } = await ctx.params;
  const rollup = repo().getSolutionRollup(id);
  if (!rollup) throw notFound("solution");
  return json(rollup);
});

export const PATCH = route(async (req, ctx) => {
  const { id } = await ctx.params;
  const body = (await readJson(req)) as UpdateSolutionInput;
  return json(repo().updateSolution(id, body));
});

export const DELETE = route(async (req, ctx) => {
  const { id } = await ctx.params;
  repo().deleteSolution(id);
  return noContent();
});
