import { subscribeChanges } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
export async function GET(): Promise<Response> {
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

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
