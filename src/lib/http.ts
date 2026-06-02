import { NextResponse } from "next/server";
import { AppError } from "@/lib/errors";
import { publishChange } from "@/lib/events";
import { repo } from "@/lib/repo";
import { runWithContext, type RequestContext } from "@/lib/context";
import { safeEqual } from "@/lib/auth";

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
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError(400, "Invalid JSON body");
  }
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
function resolveContext(req: Request): RequestContext {
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
    if (mutating && (hasAdmin || strict)) {
      throw new AppError(401, "Missing x-api-key header");
    }
    return {};
  }
  if (hasAdmin && safeEqual(token, admin)) return { admin: true };
  const resolved = repo().resolveApiKey(token);
  if (!resolved) throw new AppError(401, "Invalid API key (x-api-key)");
  // Scope enforcement: a 'read' key cannot perform mutations.
  if (mutating && resolved.scope === "read") {
    throw new AppError(403, "API key has read-only permissions (read)");
  }
  return {
    actorId: resolved.actorId,
    keyId: resolved.keyId,
    keySolutionId: resolved.solutionId ?? undefined,
    keyScope: resolved.scope,
  };
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
      // Run the handler within the identity context - repo reads currentActorId()
      // when writing attribution (activity, ownerActorId).
      const res = await runWithContext(reqCtx, () => fn(req, ctx));
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
