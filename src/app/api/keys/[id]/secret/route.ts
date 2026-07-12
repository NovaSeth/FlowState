import { repo } from "@/lib/repo";
import { json, route } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/keys/:id/secret - the full token for the Users panel's "show"
 *  button. `token` is null for keys created before plaintext-secret storage.
 *  Authorization mirrors revoke (admin / local operator / owner / parent). */
export const GET = route(async (_req, ctx) => {
  const { id } = await ctx.params;
  return json({ token: repo().apiKeyToken(id) });
});
