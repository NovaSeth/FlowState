import { repo } from "@/lib/repo";
import { json, readJson, route } from "@/lib/http";
import { notFound } from "@/lib/errors";
import type { CreateCommentInput } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async (_req, ctx) => {
  const { id } = await ctx.params;
  if (!repo().getTask(id)) throw notFound("task");
  return json(repo().listComments(id));
});

export const POST = route(async (req, ctx) => {
  const { id } = await ctx.params;
  const body = (await readJson(req)) as CreateCommentInput;
  return json(repo().createComment(id, body), 201);
});
