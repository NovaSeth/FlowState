import { NextResponse } from "next/server";
import { AppError } from "@/lib/errors";
import { publishChange } from "@/lib/events";
import { repo } from "@/lib/repo";
import { runWithContext, type RequestContext } from "@/lib/context";
import { safeEqual } from "@/lib/auth";
import {
  getActiveConnection,
  requireKeyEnabled,
  requireKeyForced,
  remoteBase,
  type ConnectionWithKey,
} from "@/lib/connections";

const MUTATING = new Set(["POST", "PATCH", "PUT", "DELETE"]);

// Request body size limit (256 KB). Guards against DoS via a huge payload;
// for normal traffic (JSON mutations) it leaves plenty of headroom.
const MAX_BODY_BYTES = 262144;

// One-time warning about open mode (no API key). Printed once per process and
// skipped in tests so we don't clutter stderr. Open mode is intentional for a
// trusted localhost / single user - see the Security section.
let openModeWarned = false;
function warnOpenModeOnce(): void {
  if (openModeWarned) return;
  openModeWarned = true;
  if (process.env.NODE_ENV === "test" || process.env.VITEST) return;
  const admin = process.env.FS_API_KEY ?? "";
  const strict = process.env.FS_AUTH === "strict";
  if (admin.trim() === "" && !strict) {
    console.warn(
      "[flow-state] Running in OPEN mode (no API key); do not expose to untrusted networks. Set FS_API_KEY or FS_AUTH=strict to require auth.",
    );
  }
}
warnOpenModeOnce();

// --- lightweight in-process rate limiter ---
//
// A token bucket per client (IP first hop + keyId when present). Generous limit so
// it never bites normal interactive/agent traffic, but caps a runaway loop or a
// trivial flood. In-process only (single Node server) - not a distributed limiter.
// Disabled under tests so the suite (which fires many requests fast) is unaffected.
const RATE_LIMIT_MAX = 240; // requests
const RATE_LIMIT_WINDOW_MS = 60_000; // per 60s
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function rateLimitDisabled(): boolean {
  return process.env.NODE_ENV === "test" || !!process.env.VITEST;
}

/** Client key for the limiter: x-forwarded-for first hop (else a constant) plus the
 *  resolved keyId when present, so an authenticated key gets its own budget. */
function rateKey(req: Request, keyId?: string): string {
  const xff = req.headers.get("x-forwarded-for") ?? "";
  const ip = (xff.split(",")[0] ?? "").trim() || "local";
  return keyId ? `${ip}|${keyId}` : ip;
}

/** Returns true when the caller is OVER the limit (should be 429). Records a hit
 *  otherwise. No-op (always allowed) under tests. */
function rateLimited(key: string): boolean {
  if (rateLimitDisabled()) return false;
  const now = Date.now();
  const b = rateBuckets.get(key);
  if (!b || now >= b.resetAt) {
    rateBuckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    // Opportunistic cleanup so the map does not grow unbounded across many clients.
    if (rateBuckets.size > 4096) {
      for (const [k, v] of rateBuckets)
        if (now >= v.resetAt) rateBuckets.delete(k);
    }
    return false;
  }
  b.count++;
  return b.count > RATE_LIMIT_MAX;
}

// API call counter (used to "pulse" the icon in the macOS menu-bar app).
// We count every API request except those marked with the `x-fs-monitor: 1`
// header (i.e. the app's own polling), so the icon does not pulse from polling
// alone. The value is monotonic within the process.
let apiPulse = 0;
export function getApiPulse(): number {
  return apiPulse;
}

/** JSON response with the given status (default 200). */
export function json(data: unknown, status = 200): Response {
  return NextResponse.json(data, { status });
}

/** Empty 204 response. */
export function noContent(): Response {
  return new Response(null, { status: 204 });
}

/**
 * Parse a JSON request body. Throws AppError(400) on invalid/empty body.
 * Use for mutating handlers that require a body.
 */
export async function readJson(req: Request): Promise<unknown> {
  // Body size limit: first a cheap rejection via the Content-Length header (when
  // present), then a hard guard on the actual length of the read text (the header
  // may lie or be missing with chunked transfer).
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    throw new AppError(413, "Request body too large");
  }
  const text = await req.text();
  if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) {
    throw new AppError(413, "Request body too large");
  }
  if (!text || text.trim() === "") {
    throw new AppError(400, "Invalid JSON body");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new AppError(400, "Invalid JSON body");
  }
  // Every handler expects a JSON object (or array for bulk); reject a bare
  // `null`/primitive so downstream `body.foo` access can't crash with a 500.
  if (typeof parsed !== "object" || parsed === null) {
    throw new AppError(400, "Invalid JSON body (expected an object)");
  }
  return parsed;
}

/**
 * A keyless request is trusted only when it comes from the local dashboard or the
 * menu-bar app. Everything else (the MCP server, a CLI, an external/embedded page)
 * must present an API key - without one it sees nothing.
 * - The dashboard's REST client tags every call with `x-fs-dashboard: 1`, and the
 *   menu-bar app marks its polling with `x-fs-monitor: 1`. These explicit markers
 *   are the primary signal - they work regardless of the network (a phone over
 *   plain HTTP/LAN, where Sec-Fetch-* and a trustworthy origin are absent). A
 *   cross-origin page cannot set them without a CORS preflight we never grant.
 * - As a fallback (e.g. a same-origin EventSource / direct navigation that can't
 *   set custom headers): a same-origin browser sends `Sec-Fetch-Site:
 *   same-origin|same-site|none`, or - when Sec-Fetch is absent - an Origin/Referer
 *   whose host matches ours. A node fetch / curl / the MCP server carry none of
 *   these; a foreign page sends `cross-site` or a mismatching host.
 * This is a header heuristic, sufficient for a single-user local trust model (not a
 * security boundary against a determined local attacker - that is what keys are for).
 */
function isTrustedKeylessClient(req: Request): boolean {
  if (req.headers.get("x-fs-dashboard") === "1") return true;
  if (req.headers.get("x-fs-monitor") === "1") return true;
  const site = req.headers.get("sec-fetch-site");
  if (site !== null) return site !== "cross-site";
  // No Sec-Fetch-Site (plain-HTTP/LAN browser): trust only a same-origin request
  // per its Origin/Referer host vs the Host we were reached on; MCP/CLI has none.
  const from = req.headers.get("origin") ?? req.headers.get("referer");
  if (!from) return false;
  const host = req.headers.get("host") ?? new URL(req.url).host;
  try {
    return new URL(from).host === host;
  } catch {
    return false;
  }
}

/**
 * Resolves identity from the x-api-key header:
 * - no token: allowed ONLY for the local dashboard / menu-bar app (see
 *   isTrustedKeylessClient); any other keyless client -> 401. On a mutation in
 *   strict mode or when FS_API_KEY (admin) is set -> 401 even for the dashboard,
 * - token == FS_API_KEY: admin/bootstrap (no specific actor),
 * - token = actor key: returns actorId/keyId (resolveApiKey throws 401 when
 *   revoked/expired, returns null on a bad secret -> 401 here).
 */
export function resolveContext(req: Request): RequestContext {
  const token = req.headers.get("x-api-key");
  // FS_API_KEY: admin/bootstrap key (Flow State).
  const admin = process.env.FS_API_KEY ?? "";
  const hasAdmin = admin.trim() !== "";
  // FS_AUTH=strict => mutations require a key.
  const strict = process.env.FS_AUTH === "strict";
  const mutating = MUTATING.has(req.method);

  if (!token) {
    // No key: only the local dashboard (same-origin browser) and the menu-bar app
    // may proceed keyless. Every other client must authenticate.
    if (!isTrustedKeylessClient(req)) {
      throw new AppError(401, "Missing x-api-key header");
    }
    // Require-key mode: even the trusted local clients must present a key on
    // data routes. When enabled via the Settings TOGGLE (local), the
    // settings/connections endpoints stay reachable keyless so the mode can
    // always be inspected and turned off (no lockout). When FORCED by the
    // environment (FS_REQUIRE_KEY, for a public host) nothing is exempt, so an
    // anonymous visitor can neither read data nor disable the protection.
    if (
      requireKeyEnabled() &&
      !(isManagementPath(req) && !requireKeyForced())
    ) {
      throw new AppError(401, "API key required (require-key mode is on)");
    }
    if (mutating && (hasAdmin || strict)) {
      throw new AppError(401, "Missing x-api-key header");
    }
    return {};
  }
  if (hasAdmin && safeEqual(token, admin)) return { admin: true };
  const resolved = repo().resolveApiKey(token);
  if (!resolved) throw new AppError(401, "Invalid API key (x-api-key)");
  // Scope enforcement: a key with no write grant at all cannot perform any
  // mutation. Per-entity write coverage is enforced deeper, in the repo.
  if (mutating && !resolved.grants.some((g) => g.scope === "write")) {
    throw new AppError(403, "API key has read-only permissions (read)");
  }
  return {
    actorId: resolved.actorId,
    keyId: resolved.keyId,
    keyGrants: resolved.grants,
  };
}

/**
 * Auth gate for the SSE event stream (/api/events). Same trust model as
 * resolveContext, with ONE deliberate difference: a browser EventSource cannot
 * attach an x-api-key header, so a TRUSTED KEYLESS same-origin client (the local
 * dashboard / menu-bar app) is allowed to read the stream even in require-key
 * mode. That keeps live refresh working on a public host - otherwise the
 * header-less EventSource would 401 forever and the dashboard would wedge on its
 * offline overlay. The actual disclosure risk (an anonymous NON-browser client
 * such as curl or the MCP server) is still rejected here exactly as everywhere
 * else, and the stream only ever carries change METADATA ("PATCH /api/tasks/<id>"),
 * never record content or keys. A presented key is validated as usual.
 */
export function authorizeEventStream(req: Request): void {
  const token = req.headers.get("x-api-key");
  if (token) {
    resolveContext(req); // validates the key (throws 401/403 on a bad/unauthorized one)
    return;
  }
  if (!isTrustedKeylessClient(req)) {
    throw new AppError(401, "Missing x-api-key header");
  }
}

/** Map a thrown value to an HTTP Response. */
export function handleError(e: unknown): Response {
  if (e instanceof AppError) {
    return json({ error: e.message }, e.status);
  }
  if (e instanceof SyntaxError) {
    return json({ error: "Invalid JSON body" }, 400);
  }
  // We log only a redacted summary (name + message, possibly stack), NEVER the
  // raw request or the x-api-key header.
  console.error(
    "Unhandled API error:",
    e instanceof Error ? `${e.name}: ${e.message}` : String(e),
  );
  return json({ error: "Internal server error" }, 500);
}

/** Connection/settings management always runs against THIS server, never the
 *  proxied remote (you manage your connections locally, and you must be able
 *  to switch back). */
function isManagementPath(req: Request): boolean {
  const pathname = new URL(req.url).pathname;
  return pathname.startsWith("/api/connections") || pathname === "/api/settings";
}

/**
 * The connection/settings management surface controls the WHOLE server's data
 * plane: a saved connection drives server-side outbound fetches (SSRF-capable),
 * and once one is activated every data route is transparently proxied to that
 * remote. That authority must never be reachable by a narrowly-scoped actor key
 * - a "write one project" grant could otherwise repoint the entire instance at
 * an attacker's host. Only the local OWNER may manage it: the trusted keyless
 * dashboard / menu-bar (an empty context that already cleared resolveContext) or
 * the admin key (FS_API_KEY). A resolved actor key - even with a write grant -
 * is rejected with 403.
 */
export function requireManagementAuthority(ctx: RequestContext): void {
  if (ctx.admin === true) return;
  // Trusted keyless local owner: resolveContext returned {} (no actor, no key).
  if (ctx.actorId === undefined && ctx.keyId === undefined) return;
  throw new AppError(
    403,
    "Managing connections and settings requires admin authority",
  );
}

/**
 * Transparent proxy for the active remote source: same method/path/query/body,
 * with the connection's stored key attached. The remote instance does its own
 * authorization; its JSON (including errors) is passed through verbatim.
 */
async function proxyToRemote(
  req: Request,
  c: ConnectionWithKey,
): Promise<Response> {
  const url = new URL(req.url);
  const target = `${remoteBase(c)}${url.pathname}${url.search}`;
  const headers: Record<string, string> = {
    "content-type": req.headers.get("content-type") ?? "application/json",
  };
  if (c.apiKey) headers["x-api-key"] = c.apiKey;
  // redirect:"error" - a legitimate Flow State /api never 3xx-redirects, and
  // following one would let a malicious remote bounce this fetch to an internal
  // URL (e.g. cloud metadata) whose body we would then hand back to the caller.
  const init: RequestInit = { method: req.method, headers, redirect: "error" };
  if (req.method !== "GET" && req.method !== "HEAD") {
    const body = await req.text();
    // Same body-size guard as readJson, so a huge payload can't be relayed to
    // the remote through the proxy path (which bypasses readJson).
    if (Buffer.byteLength(body, "utf8") > MAX_BODY_BYTES) {
      throw new AppError(413, "Request body too large");
    }
    init.body = body;
  }
  let res: Response;
  try {
    res = await fetch(target, init);
  } catch {
    throw new AppError(502, `Remote Flow State unreachable (${c.host}:${c.port})`);
  }
  return new Response(await res.text(), {
    status: res.status,
    headers: {
      "content-type": res.headers.get("content-type") ?? "application/json",
    },
  });
}

type RouteContext = { params: Promise<Record<string, string>> };

type Handler = (
  req: Request,
  ctx: RouteContext,
) => Response | Promise<Response>;

/**
 * Wraps a route handler so thrown AppError/SyntaxError/unknown errors become
 * proper HTTP responses. Usage: `export const GET = route(async (req, ctx) => {...})`.
 */
export function route(fn: Handler) {
  return async (req: Request, ctx: RouteContext): Promise<Response> => {
    try {
      // Pulse: count real API traffic, skipping the app's own polling.
      if (req.headers.get("x-fs-monitor") !== "1") apiPulse++;
      const reqCtx = resolveContext(req);
      // Rate limit AFTER identity resolution so an authenticated key gets its own
      // budget (and so a bad key still costs the IP a 401, not a 429). Disabled
      // under tests. Admin (FS_API_KEY) is not exempt - the limit is generous.
      if (rateLimited(rateKey(req, reqCtx.keyId))) {
        return json({ error: "Too many requests" }, 429);
      }
      // Owner-only management surface: registering/activating a connection or
      // flipping settings controls the whole data plane, so a scoped actor key
      // must not reach it (only admin or the trusted keyless local owner).
      if (MUTATING.has(req.method) && isManagementPath(req)) {
        requireManagementAuthority(reqCtx);
      }
      // Remote source active: every data route becomes a transparent proxy to
      // the connected instance (management endpoints stay local). The local
      // identity gate above still applies - who may TALK to this server is a
      // local decision; what they see is the remote's.
      const active = isManagementPath(req) ? null : getActiveConnection();
      const res = active
        ? await proxyToRemote(req, active)
        : // Run the handler within the identity context - repo reads
          // currentActorId() when writing attribution (activity, ownerActorId).
          await runWithContext(reqCtx, () => fn(req, ctx));
      // Successful mutation -> broadcast the change so open dashboards refresh live.
      if (MUTATING.has(req.method) && res.status < 400) {
        publishChange(`${req.method} ${new URL(req.url).pathname}`);
      }
      return res;
    } catch (e) {
      return handleError(e);
    }
  };
}
