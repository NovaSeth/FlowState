import { randomBytes } from "node:crypto";
import { isIP } from "node:net";
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

/** Well-known TLS ports: a connection on one of these speaks https, anything
 *  else is treated as a plain-HTTP LAN instance. Includes 8443 so a TLS remote
 *  on the common alternate port is not silently downgraded to cleartext. */
const HTTPS_PORTS = new Set([443, 8443]);

/** Base URL of a remote instance. 443/8443 -> https (a hosted deployment behind
 *  TLS, e.g. fs.monokoda.com); anything else -> http (a plain LAN instance).
 *  `host` is validated at creation (assertRemoteHostAllowed) to be a bare
 *  hostname / IP literal, so interpolating it here cannot inject a path,
 *  authority, or fragment into the URL. */
export function remoteBase(c: { host: string; port: number }): string {
  const scheme = HTTPS_PORTS.has(c.port) ? "https" : "http";
  const hostPart = c.port === 443 || c.port === 80 ? c.host : `${c.host}:${c.port}`;
  return `${scheme}://${hostPart}`;
}

const linkLocalError = () =>
  new AppError(422, "Connection host is a link-local address, which is not allowed");

/** True for the IPv4 link-local / cloud-metadata range 169.254.0.0/16 (e.g. the
 *  AWS/GCP metadata endpoint 169.254.169.254). Never a legitimate remote. */
function isLinkLocalV4(octets: number[]): boolean {
  return octets.length === 4 && octets[0] === 169 && octets[1] === 254;
}

/** Decodes the embedded IPv4 of an IPv4-mapped IPv6 address (::ffff:a.b.c.d,
 *  which Node normalizes to ::ffff:XXXX:YYYY) so it can't smuggle a blocked v4
 *  address past the range check. Returns the four octets, or null. */
function mappedV4Octets(ipv6: string): number[] | null {
  const m = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(ipv6);
  if (!m) return null;
  const hi = parseInt(m[1], 16);
  const lo = parseInt(m[2], 16);
  return [(hi >> 8) & 255, hi & 255, (lo >> 8) & 255, lo & 255];
}

/**
 * Validates a remote connection host against SSRF abuse. Two guards:
 *  1. FORMAT: a bare hostname or IP literal only. No scheme, path, query,
 *     fragment, userinfo, or embedded port - those let a crafted host inject
 *     into the URL (e.g. "169.254.169.254/latest/meta-data/#" turns the
 *     appended "/api/dashboard" into a fragment, so the request hits the
 *     metadata path). remoteBase interpolates the host raw, so this is the
 *     line of defense.
 *  2. ADDRESS: reject link-local / cloud-metadata addresses. The check runs on
 *     the URL-NORMALIZED host, so alternate IPv4 encodings (decimal 2852039166,
 *     hex 0xA9FEA9FE, octal, and IPv4-mapped IPv6 ::ffff:169.254.169.254) can't
 *     slip a blocked address past it. Loopback and private LAN ranges stay
 *     allowed on purpose - connecting to a LAN instance (192.168.x, 10.x,
 *     localhost) is the primary use case.
 */
function assertRemoteHostAllowed(host: string): void {
  // Allow '.' inside the brackets so a valid dotted IPv4-mapped IPv6 literal
  // (RFC 4291 2.2.3, e.g. [::ffff:192.168.1.10]) is not wrongly rejected; a
  // link-local one (e.g. [::ffff:169.254.169.254]) still normalizes to
  // [::ffff:a9fe:a9fe] and is caught by mappedV4Octets below.
  const bracketed = /^\[[0-9a-fA-F:.]+\]$/.test(host);
  if (!bracketed && !/^[a-zA-Z0-9._-]+$/.test(host)) {
    throw new AppError(
      422,
      "Connection host must be a plain hostname or IP address (no scheme, path, port, or credentials)",
    );
  }
  // Normalize through the same URL parser fetch() uses, so a numeric IP in any
  // encoding collapses to its canonical form before we range-check it.
  let hostname: string;
  try {
    hostname = new URL(`http://${host}`).hostname;
  } catch {
    throw new AppError(422, "Connection host is not a valid hostname or IP address");
  }
  const bare = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const kind = isIP(bare);
  if (kind === 4) {
    if (isLinkLocalV4(bare.split(".").map(Number))) throw linkLocalError();
  } else if (kind === 6) {
    // fe80::/10 (link-local) and any IPv4-mapped link-local address.
    if (/^fe[89ab]/.test(bare)) throw linkLocalError();
    const mapped = mappedV4Octets(bare);
    if (mapped && isLinkLocalV4(mapped)) throw linkLocalError();
  }
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
  // The name is OPTIONAL - when omitted the rail shows the host/IP instead.
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const host =
    typeof input.host === "string" && input.host.trim() ? input.host.trim() : null;
  const port = Number(input.port);
  const apiKey = typeof input.apiKey === "string" ? input.apiKey.trim() : "";
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new AppError(422, "Connection requires a host and a valid port");
  }
  assertRemoteHostAllowed(host);
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
    res = await fetch(`${remoteBase(row)}/api/dashboard`, {
      headers: row.apiKey ? { "x-api-key": row.apiKey } : undefined,
      // A real remote never redirects /api; refusing to follow one closes the
      // redirect-to-internal-host SSRF path.
      redirect: "error",
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

/** Reachability of every saved connection (`id -> up?`), each pinged in
 *  parallel with a short timeout. Local is not listed (it is always this
 *  server). Used for the status dot on the connections rail. */
export async function connectionsHealth(): Promise<Record<string, boolean>> {
  const rows = getDb()
    .prepare(`SELECT id, host, port, apiKey FROM connections`)
    .all() as unknown as ConnectionWithKey[];
  const entries = await Promise.all(
    rows.map(async (r) => {
      try {
        const res = await fetch(`${remoteBase(r)}/api/dashboard`, {
          headers: r.apiKey ? { "x-api-key": r.apiKey } : undefined,
          redirect: "error",
          signal: AbortSignal.timeout(2500),
        });
        return [r.id, res.ok] as const;
      } catch {
        return [r.id, false] as const;
      }
    }),
  );
  return Object.fromEntries(entries);
}

/** Require-key forced by the environment (FS_REQUIRE_KEY=1) - for a hosted /
 *  public deployment. When forced, it cannot be turned off through the API and
 *  even the management endpoints demand a key (see http.ts), so an anonymous
 *  visitor can neither read data nor disable the protection. */
export function requireKeyForced(): boolean {
  const v = (process.env.FS_REQUIRE_KEY ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export function requireKeyEnabled(): boolean {
  return requireKeyForced() || getSetting(REQUIRE_KEY) === "1";
}

export function setRequireKey(on: boolean): void {
  // When forced by the environment the DB toggle is irrelevant (cannot disable).
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
        `${remoteBase(active)}/api/settings`,
        {
          headers: active.apiKey ? { "x-api-key": active.apiKey } : undefined,
          cache: "no-store",
          redirect: "error",
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
