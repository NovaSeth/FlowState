import { repo } from "@/lib/repo";
import { json, route } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/activity?solutionId=&entityId=&actorId=&limit= - audit log (najnowsze pierwsze). */
export const GET = route(async (req) => {
  const sp = new URL(req.url).searchParams;
  const limitRaw = sp.get("limit");
  return json(
    repo().listActivity({
      solutionId: sp.get("solutionId") ?? undefined,
      entityId: sp.get("entityId") ?? undefined,
      actorId: sp.get("actorId") ?? undefined,
      limit: limitRaw ? Number(limitRaw) : undefined,
    }),
  );
});
