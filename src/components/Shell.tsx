"use client";

import { ReactNode } from "react";
import Link from "next/link";
import { NavRail, MobileTabBar } from "./NavRail";
import { Celebrations } from "./Celebrations";
import { OfflineOverlay } from "./OfflineOverlay";
import { BrandMark } from "./BrandMark";
import { Scoreboard } from "./Scoreboard";
import { useIsNarrow } from "@/lib/use-is-narrow";
import { useConnectionStatus } from "@/lib/use-live-refresh";
import { useT } from "@/i18n/provider";

/**
 * Application shell (responsive).
 * - Desktop: header + [left icon rail | content].
 * - Mobile (touch/narrow): header (safe-area top) + content (scroll) + bottom
 *   tab-bar (safe-area bottom) - native iOS layout.
 *
 * Height via `h-dvh` (dynamic viewport): on iOS Safari the browser bar no longer
 * eats the bottom of the view like with 100vh. `children` are server components
 * passed via props - allowed in a client component (App Router).
 */
export function Shell({ children }: { children: ReactNode }) {
  const narrow = useIsNarrow();
  const t = useT();
  const conn = useConnectionStatus();
  const dotColor = {
    live: "var(--color-success)",
    connecting: "var(--color-accent)",
    down: "var(--color-danger)",
  }[conn];
  // Desktop: left rail (full height, all the way up) | [header + content].
  // Mobile: header + content + bottom tab-bar (rail hidden).
  return (
    <div className="flex h-dvh overflow-hidden">
      {!narrow && <NavRail />}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <header className="shrink-0 border-b border-edge bg-canvas pt-[env(safe-area-inset-top)]">
          <div className="flex h-13 items-center px-5">
            <Link
              href="/"
              title={`Flow State - ${conn}`}
              className="flex items-center gap-2 text-base tracking-tight text-fg"
            >
              <BrandMark size={18} className="shrink-0" dotColor={dotColor} />
              <span>
                <span className="font-semibold">{t("app.brandLead")}</span>
                {t("app.brandRest")}
              </span>
            </Link>
            <div className="ml-auto flex items-center gap-3">
              <Scoreboard />
            </div>
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto bg-canvas-subtle">
          {children}
        </main>
        {narrow && <MobileTabBar />}
      </div>

      {/* Gamification: "+1" fly-to-counter + full-screen "YOU WIN". Global,
          because a completion can happen on any screen. */}
      <Celebrations />

      {/* Server-offline curtain (SSE dropped while the app is open). Global so it
          covers any screen; auto-hides when EventSource reconnects. */}
      <OfflineOverlay />
    </div>
  );
}
