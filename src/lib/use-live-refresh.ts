"use client";

import {
  createContext,
  createElement,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type ConnStatus = "connecting" | "live" | "down";

/**
 * SHARED SSE multiplexer.
 *
 * Previously every consumer (useConnectionStatus + each useLiveRefresh caller)
 * opened its OWN EventSource('/api/events'), so a single page held 4-5 parallel
 * streams and one mutation fanned out into several parallel refetches.
 *
 * Now there is ONE EventSource per tab. A ref-counted singleton opens the stream
 * on the first subscriber and closes it on the last unsubscribe; EventSource's
 * built-in auto-reconnect is preserved (we never close on error, only on the last
 * unsubscribe), so behavior matches the old per-hook code. Messages are fanned out
 * to all registered callbacks; connection status is fanned out to status listeners.
 *
 * SSR-safe: the EventSource is created lazily inside subscribe/subscribeStatus,
 * which only run from client effects - never at module load or during SSR.
 */

type MessageCallback = () => void;
type StatusCallback = (status: ConnStatus) => void;

let es: EventSource | null = null;
let refCount = 0;
let currentStatus: ConnStatus = "connecting";
const messageListeners = new Set<MessageCallback>();
const statusListeners = new Set<StatusCallback>();

function setStatus(status: ConnStatus): void {
  currentStatus = status;
  for (const l of statusListeners) l(status);
}

function ensureConnection(): void {
  if (es) return;
  // Created only on the client (callers are effects); guard SSR just in case.
  if (typeof window === "undefined") return;
  setStatus("connecting");
  const source = new EventSource("/api/events");
  source.onopen = () => setStatus("live");
  source.onmessage = () => {
    setStatus("live");
    for (const l of messageListeners) l();
  };
  // EventSource retries on its own; we surface "down" but keep the stream open so
  // onopen flips us back to "live" once the server is back. We never close here.
  source.onerror = () => setStatus("down");
  es = source;
}

function maybeCloseConnection(): void {
  if (refCount > 0) return;
  if (es) {
    es.close();
    es = null;
  }
  // Reset so a future re-subscribe starts from "connecting" again, matching the
  // fresh-EventSource behavior of the old per-hook code.
  currentStatus = "connecting";
}

/** Register a message callback; opens the shared stream on first subscriber. */
function subscribe(cb: MessageCallback): () => void {
  messageListeners.add(cb);
  refCount += 1;
  ensureConnection();
  return () => {
    messageListeners.delete(cb);
    refCount -= 1;
    maybeCloseConnection();
  };
}

/**
 * Register a status callback; opens the shared stream on first subscriber. Pushes
 * the current status immediately so the subscriber renders the right state at once.
 */
function subscribeStatus(cb: StatusCallback): () => void {
  statusListeners.add(cb);
  refCount += 1;
  ensureConnection();
  cb(currentStatus);
  return () => {
    statusListeners.delete(cb);
    refCount -= 1;
    maybeCloseConnection();
  };
}

/**
 * Optional context provider. With a single shared EventSource the hooks work on
 * their own (module-level singleton), but the provider keeps an extra ref on the
 * connection so the stream stays open across route transitions even if every
 * other subscriber briefly unmounts/remounts - avoiding a close/reopen flap. Mount
 * once near the top of the tree (Shell). It renders children unchanged.
 */
const LiveContext = createContext<null>(null);

export function LiveProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    // Keep one ref so the singleton stays alive for the app's lifetime.
    const unsubscribe = subscribe(() => {});
    return unsubscribe;
  }, []);
  return createElement(LiveContext.Provider, { value: null }, children);
}

/**
 * Live connection status (SSE /api/events) - for the "server is up" indicator in
 * the UI (the dot in the logo). Reads from the SHARED stream (no second
 * EventSource). onopen/onmessage -> live; onerror -> down; EventSource retries on
 * its own, so once the server is back onopen sets live again.
 */
export function useConnectionStatus(): ConnStatus {
  const [status, setStatus] = useState<ConnStatus>("connecting");
  useEffect(() => subscribeStatus(setStatus), []);
  return status;
}

/**
 * Subscribes to the SSE stream (/api/events) and calls `onChange` (debounced) after
 * every data mutation - so any view refreshes LIVE when a Claude Code agent or the UI
 * changes something. Registers its (debounced) callback with the SHARED stream
 * instead of opening its own EventSource.
 *
 * `onChange` may change between renders - we keep it in a ref, so the subscription
 * is not torn down and re-created on every callback change.
 */
export function useLiveRefresh(onChange: () => void, debounceMs = 250): void {
  const cb = useRef(onChange);
  useEffect(() => {
    cb.current = onChange;
  }, [onChange]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = subscribe(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => cb.current(), debounceMs);
    });
    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, [debounceMs]);
}
