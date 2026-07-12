import { noContent, route } from "@/lib/http";
import { deleteConnection } from "@/lib/connections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** DELETE /api/connections/:id - forget a saved remote instance. Deleting the
 *  active one falls back to the local database. */
export const DELETE = route(async (_req, ctx) => {
  const { id } = await ctx.params;
  deleteConnection(id);
  return noContent();
});
