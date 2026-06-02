import { repo } from "@/lib/repo";
import { json, readJson, route } from "@/lib/http";
import type { CreateApiKeyInput } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async (req) => {
  const sp = new URL(req.url).searchParams;
  return json(
    repo().listApiKeys({
      actorId: sp.get("actorId") ?? undefined,
      solutionId: sp.get("solutionId") ?? undefined,
    }),
  );
});

/**
 * POST /api/keys - creates a key. The response contains the full `token` - shown
 * ONCE (only the hash is stored in the DB). When called with a valid x-api-key it
 * records the delegation (createdByKeyId), so an agent can mint keys for sub-agents.
 */
export const POST = route(async (req) => {
  const body = (await readJson(req)) as CreateApiKeyInput;
  return json(repo().createApiKey(body), 201);
});
