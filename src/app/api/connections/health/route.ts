import { json, route } from "@/lib/http";
import { connectionsHealth } from "@/lib/connections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/connections/health - reachability of each saved remote instance
 *  ({id: up?}); drives the status dot on the connections rail. Local is always
 *  up (it is this server) and is not included. */
export const GET = route(async () => json(await connectionsHealth()));
