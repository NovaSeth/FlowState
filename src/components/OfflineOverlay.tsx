"use client";

import { useEffect, useState } from "react";
import { BrandMark } from "./BrandMark";
import { useConnectionStatus } from "@/lib/use-live-refresh";
import { useT } from "@/i18n/provider";

/**
 * Full-screen "server offline" curtain.
 *
 * When the SSE stream drops (server stopped/crashed while the app is open) the
 * only previous signal was the logo dot turning red - easy to miss. This mounts a
 * blocking overlay explaining the app lost the server and is auto-reconnecting, so
 * the user knows the stale data is stale (and not a frozen UI).
 *
 * Note: this CANNOT help a hard refresh against a dead server - then nothing serves
 * the page and the browser shows its own ERR_CONNECTION_REFUSED. It only covers the
 * "was open, server died" case; EventSource keeps retrying and flips us back to
 * "live" (overlay disappears) once the server returns.
 *
 * A short delay before showing avoids a flash on momentary reconnect blips.
 */
const SHOW_DELAY_MS = 900;

export function OfflineOverlay() {
  const conn = useConnectionStatus();
  const t = useT();
  // Flips true once we've been "down" for SHOW_DELAY_MS (set from the timeout, not
  // the effect body). The cleanup resets it on any status change, so reconnecting
  // both hides the curtain and re-arms the anti-flicker delay for the next outage.
  const [downSettled, setDownSettled] = useState(false);

  useEffect(() => {
    if (conn !== "down") return;
    const id = setTimeout(() => setDownSettled(true), SHOW_DELAY_MS);
    return () => {
      clearTimeout(id);
      setDownSettled(false);
    };
  }, [conn]);

  const visible = conn === "down" && downSettled;
  if (!visible) return null;

  return (
    <div
      role="alertdialog"
      aria-live="assertive"
      aria-label={t("conn.offlineTitle")}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-canvas/80 backdrop-blur-sm pt-[env(safe-area-inset-top)]"
    >
      <div className="mx-6 flex max-w-sm flex-col items-center gap-4 rounded-2xl border border-edge bg-canvas-subtle px-8 py-9 text-center shadow-2xl">
        <BrandMark size={56} dotColor="var(--color-danger)" className="animate-pulse" />
        <h2 className="text-lg font-semibold text-fg">{t("conn.offlineTitle")}</h2>
        <p className="text-sm leading-relaxed text-fg-muted">
          {t("conn.offlineHint")}
        </p>
        <div
          className="mt-1 flex items-center gap-1.5"
          aria-label={t("conn.reconnecting")}
        >
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="h-1.5 w-1.5 animate-bounce rounded-full bg-danger"
              style={{ animationDelay: `${i * 160}ms` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
