import { json, readJson, route } from "@/lib/http";
import {
  createConnection,
  getActiveConnectionId,
  listConnections,
  setActiveConnection,
} from "@/lib/connections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/connections - saved remote instances + which one is active
 *  (null = the local database). Stored API keys never leave the server. */
export const GET = route(async () =>
  json({ connections: listConnections(), activeId: getActiveConnectionId() }),
);

/** POST /api/connections - register a remote instance {name, host, port, apiKey}. */
export const POST = route(async (req) =>
  json(createConnection((await readJson(req)) as Record<string, unknown>), 201),
);

/** PATCH /api/connections {activeId: string|null} - switch the data source.
 *  A remote target is health-checked before the switch (502 on failure). */
export const PATCH = route(async (req) => {
  const body = (await readJson(req)) as { activeId?: unknown };
  const id = body.activeId === null ? null : String(body.activeId ?? "");
  await setActiveConnection(id === "" ? null : id);
  return json({ activeId: getActiveConnectionId() });
});
