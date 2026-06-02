import { repo } from "@/lib/repo";
import { noContent, route } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const DELETE = route(async (req, ctx) => {
  const { id } = await ctx.params;
  repo().deleteComment(id);
  return noContent();
});
