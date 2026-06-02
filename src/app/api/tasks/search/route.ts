import { repo } from "@/lib/repo";
import { json, route } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/tasks/search?q=<text>&solutionId=<optional>
 *
 * Global full-text search (plain case-insensitive LIKE) over title+description,
 * optionally scoped to a single solution. Returns tasks with their context
 * (solution/project/milestone) so the agent does not have to list per project.
 * Empty `q` -> 422.
 */
export const GET = route(async (req) => {
  const sp = new URL(req.url).searchParams;
  const q = sp.get("q") ?? "";
  const solutionId = sp.get("solutionId") ?? undefined;
  return json(repo().searchTasks(q, { solutionId }));
});
