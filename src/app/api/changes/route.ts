import { repo } from "@/lib/repo";
import { json, route } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/changes?since=<ISO timestamp>
 *
 * Polling delta sync for agents: returns entities changed (updatedAt) or created
 * (comments - createdAt) AFTER `since`. A stateless client calls without `since`
 * (full snapshot + serverTime), and subsequent calls pass `serverTime` from the
 * previous response. This lets the agent see dashboard changes made manually or
 * by another agent between its own calls.
 *
 * An invalid / empty `since` is treated as the epoch (full snapshot).
 */
export const GET = route(async (req) => {
  const url = new URL(req.url);
  const since = url.searchParams.get("since") ?? "";
  return json(repo().changesSince(since));
});
