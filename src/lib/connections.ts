import { randomBytes } from "node:crypto";
import { getDb } from "./db";
import { AppError } from "./errors";

/* Multi-instance data sources. The dashboard can register other Flow State
 * instances (host + port + API key) and ACTIVATE one of them: from that moment
 * the whole /api surface of THIS server proxies to the remote instance
 * (http.ts), SSE is piped through (api/events), and the server-rendered pages
 * read over REST (data-source.ts). No active connection = the local SQLite,
 * which stays the default. The remote server cannot be process-controlled from
 * here, so the UI hides its server start/stop controls while remote is active.
 *
 * app_settings also holds the "require API key" switch: when on, the trusted
 * keyless heuristics (local dashboard / menu-bar headers) stop being enough
 * for data routes - every client must present a key. The settings/connections
 * endpoints stay reachable keyless so the mode can always be turned off again
 * (no lockout).
 */

export interface Connection {
  id: string;
  name: string;
  host: string;
  port: number;
  createdAt: string;
}

/** Full row - the stored key never leaves the server (proxy auth only). */
export interface ConnectionWithKey extends Connection {
  apiKey: string;
}

const ACTIVE_KEY = "activeConnectionId";
const REQUIRE_KEY = "requireKey";

const now = () => new Date().toISOString();

function getSetting(key: string): string | null {
  const row = getDb()
    .prepare(`SELECT value FROM app_settings WHERE key = ?`)
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

function putSetting(key: string, value: string | null): void {
  if (value === null) {
    getDb().prepare(`DELETE FROM app_settings WHERE key = ?`).run(key);
  } else {
    getDb()
      .prepare(
        `INSERT INTO app_settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(key, value);
  }
}

export function listConnections(): Connection[] {
  return getDb()
    .prepare(
      `SELECT id, name, host, port, createdAt FROM connections ORDER BY createdAt`,
    )
    .all() as unknown as Connection[];
}

export function createConnection(input: {
  name?: unknown;
  host?: unknown;
  port?: unknown;
  apiKey?: unknown;
}): Connection {
  const name =
    typeof input.name === "string" && input.name.trim() ? input.name.trim() : null;
  const host =
    typeof input.host === "string" && input.host.trim() ? input.host.trim() : null;
  const port = Number(input.port);
  const apiKey = typeof input.apiKey === "string" ? input.apiKey.trim() : "";
  if (!name || !host || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new AppError(422, "Connection requires a name, host and a valid port");
  }
  const id = "cn_" + randomBytes(9).toString("base64url");
  getDb()
    .prepare(
      `INSERT INTO connections (id, name, host, port, apiKey, createdAt)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(id, name, host, port, apiKey, now());
  return { id, name, host, port, createdAt: now() };
}

export function deleteConnection(id: string): void {
  if (getActiveConnectionId() === id) putSetting(ACTIVE_KEY, null);
  const res = getDb().prepare(`DELETE FROM connections WHERE id = ?`).run(id);
  if (Number(res.changes) === 0) throw new AppError(404, "Connection not found");
}

export function getActiveConnectionId(): string | null {
  return getSetting(ACTIVE_KEY);
}

/** The active remote source, or null when running on the local database. */
export function getActiveConnection(): ConnectionWithKey | null {
  const id = getActiveConnectionId();
  if (!id) return null;
  const row = getDb()
    .prepare(
      `SELECT id, name, host, port, apiKey, createdAt FROM connections WHERE id = ?`,
    )
    .get(id) as unknown as ConnectionWithKey | undefined;
  // A dangling active id (row deleted out of band) falls back to local.
  return row ?? null;
}

/**
 * Switch the data source. `id = null` returns to local. A remote target is
 * health-checked first (its /api/dashboard must answer with the stored key)
 * so a typo'd host/port/key fails the switch instead of bricking the UI.
 */
export async function setActiveConnection(id: string | null): Promise<void> {
  if (id === null) {
    putSetting(ACTIVE_KEY, null);
    return;
  }
  const row = getDb()
    .prepare(`SELECT id, host, port, apiKey FROM connections WHERE id = ?`)
    .get(id) as unknown as ConnectionWithKey | undefined;
  if (!row) throw new AppError(404, "Connection not found");
  let res: Response;
  try {
    res = await fetch(`http://${row.host}:${row.port}/api/dashboard`, {
      headers: row.apiKey ? { "x-api-key": row.apiKey } : undefined,
      signal: AbortSignal.timeout(4000),
    });
  } catch {
    throw new AppError(502, `Remote Flow State unreachable (${row.host}:${row.port})`);
  }
  if (!res.ok) {
    throw new AppError(
      502,
      `Remote Flow State rejected the connection (${res.status}) - check the API key`,
    );
  }
  putSetting(ACTIVE_KEY, id);
}

export function requireKeyEnabled(): boolean {
  return getSetting(REQUIRE_KEY) === "1";
}

export function setRequireKey(on: boolean): void {
  putSetting(REQUIRE_KEY, on ? "1" : null);
}

/**
 * The settings payload shared by /api/settings and the Settings page:
 * `version` is THIS server's build; `sourceVersion` is the ACTIVE data
 * source's build (equal when local, fetched from the remote instance when
 * connected, null when the remote does not expose it - an older build).
 */
export async function appSettingsPayload(): Promise<{
  requireKey: boolean;
  version: string;
  sourceVersion: string | null;
  activeConnection: { id: string; name: string; host: string; port: number } | null;
}> {
  const { UI_VERSION } = await import("./version");
  const active = getActiveConnection();
  let sourceVersion: string | null = UI_VERSION;
  if (active) {
    sourceVersion = null;
    try {
      const res = await fetch(
        `http://${active.host}:${active.port}/api/settings`,
        {
          headers: active.apiKey ? { "x-api-key": active.apiKey } : undefined,
          cache: "no-store",
          signal: AbortSignal.timeout(3000),
        },
      );
      if (res.ok) {
        sourceVersion =
          ((await res.json()) as { version?: string }).version ?? null;
      }
    } catch {
      // remote unreachable / older build: no source version to show
    }
  }
  return {
    requireKey: requireKeyEnabled(),
    version: UI_VERSION,
    sourceVersion,
    activeConnection: active
      ? { id: active.id, name: active.name, host: active.host, port: active.port }
      : null,
  };
}
