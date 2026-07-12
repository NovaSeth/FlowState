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
 * POST /api/keys - creates a key for one actor. The response contains the full
 * `token` - shown ONCE (only the hash is stored in the DB). One key = one user;
 * there is no sub-key hierarchy. A non-admin caller may not grant access it does
 * not itself hold (privilege containment); its keyId is stamped as an audit
 * breadcrumb (createdByKeyId) but confers no special rights.
 */
export const POST = route(async (req) => {
  const body = (await readJson(req)) as CreateApiKeyInput;
  return json(repo().createApiKey(body), 201);
});
