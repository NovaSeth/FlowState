import { json, readJson, route } from "@/lib/http";
import { appSettingsPayload, setRequireKey } from "@/lib/connections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/settings - require-key mode, this server's version, the active
 *  data source and ITS version. Never includes stored API keys. */
export const GET = route(async () => json(await appSettingsPayload()));

/** PATCH /api/settings {requireKey: boolean}. Stays reachable keyless (like
 *  the whole management surface) so the mode can always be turned off. */
export const PATCH = route(async (req) => {
  const body = (await readJson(req)) as { requireKey?: unknown };
  if (typeof body.requireKey === "boolean") setRequireKey(body.requireKey);
  return json(await appSettingsPayload());
});
