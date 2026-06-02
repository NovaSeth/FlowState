import { repo } from "@/lib/repo";
import { json, route } from "@/lib/http";
import { currentActorId } from "@/lib/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/me - who I am per the x-api-key header. `actor: null` when anonymous
 * (no key) or for an admin key (FS_API_KEY) with no assigned actor.
 */
export const GET = route(async () => {
  const id = currentActorId();
  return json({ actor: id ? repo().getActor(id) : null });
});
