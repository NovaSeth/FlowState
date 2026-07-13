import { subscribeChanges } from "@/lib/events";
import { getActiveConnection, remoteBase } from "@/lib/connections";
import { authorizeEventStream, handleError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SSE_HEADERS = {
  "content-type": "text/event-stream",
  "cache-control": "no-cache, no-transform",
  connection: "keep-alive",
} as const;

/**
 * Server-Sent Events stream. The client (dashboard) opens an EventSource and on
 * every data change receives "data: {...}", then fetches the fresh state.
 *
 * A heartbeat ("event: ping") every 5s does double duty: it keeps the connection
 * alive AND gives the client a regular signal to watch. The client treats a gap in
 * pings as "server offline" - because EventSource.onerror is unreliable (a killed
 * localhost server can leave the browser's connection looking open for a long time,
 * so onerror never fires). It is a NAMED event so it does not trigger onmessage
 * (which is reserved for real data changes -> refetch).
 */
export async function GET(req: Request): Promise<Response> {
  // This handler cannot be wrapped in route() (route() would buffer the whole
  // SSE stream via proxyToRemote), so it runs an identity gate by hand. It uses
  // the SSE-specific gate (authorizeEventStream): an anonymous non-browser
  // client is rejected, but the header-less same-origin EventSource is allowed
  // even in require-key mode, so the dashboard's live refresh keeps working on a
  // public host. Without any gate this would be the one route an anonymous
  // client could read on a keyed host.
  try {
    authorizeEventStream(req);
  } catch (e) {
    return handleError(e);
  }

  // Remote source active: pipe the remote instance's SSE stream through, so
  // dashboards and the native app refresh on REMOTE changes (their own
  // EventSource keeps pointing at this server). If the remote is unreachable
  // we fall through to the local stream - its pings keep the connection dot
  // honest and the switch back to local stays reachable.
  const active = getActiveConnection();
  if (active) {
    // Bound the upstream fetch: abort it when the client disconnects, and cap
    // the time we wait for RESPONSE HEADERS (a host that accepts the TCP
    // connection then stalls would otherwise pin a socket forever, so repeated
    // EventSource reconnects could exhaust file descriptors). The header timer
    // is cleared once the stream starts - the stream itself is meant to be
    // long-lived. redirect:"error" refuses an SSRF bounce to an internal host.
    const ac = new AbortController();
    if (req.signal.aborted) ac.abort();
    else req.signal.addEventListener("abort", () => ac.abort(), { once: true });
    const headerTimer = setTimeout(() => ac.abort(), 6000);
    try {
      const upstream = await fetch(`${remoteBase(active)}/api/events`, {
        headers: active.apiKey ? { "x-api-key": active.apiKey } : undefined,
        redirect: "error",
        signal: ac.signal,
      });
      clearTimeout(headerTimer);
      if (upstream.ok && upstream.body) {
        return new Response(upstream.body, { headers: SSE_HEADERS });
      }
      ac.abort();
    } catch {
      clearTimeout(headerTimer);
      // fall through to the local stream
    }
  }

  const encoder = new TextEncoder();
  let unsubscribe = () => {};
  let heartbeat: ReturnType<typeof setInterval>;

  const stream = new ReadableStream({
    start(controller) {
      const send = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // stream closed - ignore
        }
      };
      send("retry: 3000\n: connected\n\n");
      unsubscribe = subscribeChanges((e) => send(`data: ${JSON.stringify(e)}\n\n`));
      heartbeat = setInterval(() => send("event: ping\ndata: 1\n\n"), 5000);
    },
    cancel() {
      clearInterval(heartbeat);
      unsubscribe();
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
