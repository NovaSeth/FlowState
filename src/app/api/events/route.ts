import { subscribeChanges } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Server-Sent Events stream. The client (dashboard) opens an EventSource and on
 * every data change receives "data: {...}", then fetches the fresh state.
 * A heartbeat (SSE comment) every 25s keeps the connection alive.
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
      heartbeat = setInterval(() => send(": hb\n\n"), 25000);
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
