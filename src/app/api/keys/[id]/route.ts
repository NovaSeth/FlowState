import { repo } from "@/lib/repo";
import { json, route } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** DELETE /api/keys/:id - revokes the key. Returns the key with revokedAt. */
export const DELETE = route(async (_req, ctx) => {
  const { id } = await ctx.params;
  return json(repo().revokeApiKey(id));
});
