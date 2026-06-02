import { EventEmitter } from "node:events";

/**
 * Simple in-process pub/sub for data changes. API mutations publish "change",
 * and the SSE endpoint (/api/events) streams them to open dashboards - so a state
 * write by any Claude Code agent is visible live.
 * The singleton on globalThis survives Next's hot-reload in dev.
 */
const g = globalThis as unknown as { __fsBus?: EventEmitter };

function bus(): EventEmitter {
  if (!g.__fsBus) {
    g.__fsBus = new EventEmitter();
    g.__fsBus.setMaxListeners(0); // many concurrent SSE subscribers
  }
  return g.__fsBus;
}

export type ChangeEvent = { type: string; at: string };

export function publishChange(type: string): void {
  bus().emit("change", { type, at: new Date().toISOString() } satisfies ChangeEvent);
}

export function subscribeChanges(fn: (e: ChangeEvent) => void): () => void {
  bus().on("change", fn);
  return () => bus().off("change", fn);
}
