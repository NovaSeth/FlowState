"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useT } from "@/i18n/provider";

/* Security rows of the Settings screen, split by what they configure:
   - RequireKeyToggle (SERVER section): when on, the trusted keyless heuristics
     stop being enough on data routes and EVERY client (dashboard, menu-bar,
     agents) must present a key. Settings/connections stay reachable so the
     mode can always be turned off again.
   - DashboardKeyField (APPLICATION section): the key THIS browser attaches to
     its calls (localStorage); needed while require-key mode is on. */

export function RequireKeyToggle({
  initialRequireKey,
}: {
  initialRequireKey: boolean;
}) {
  const t = useT();
  const [requireKey, setRequireKeyState] = useState(initialRequireKey);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setBusy(true);
    try {
      const s = await api.setRequireKey(!requireKey);
      setRequireKeyState(s.requireKey);
    } catch {
      // leave the switch as-is; the row is not worth an error banner
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center justify-between gap-4 px-3 py-3">
      <span className="min-w-0">
        <span className="block text-fg-muted">{t("settings.requireKey")}</span>
        <span className="block text-[11px] text-fg-subtle">
          {t("settings.requireKeyHint")}
        </span>
      </span>
      <button
        onClick={toggle}
        disabled={busy}
        role="switch"
        aria-checked={requireKey}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
          requireKey ? "bg-brand" : "bg-neutral-muted"
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
            requireKey ? "left-[22px]" : "left-0.5"
          }`}
        />
      </button>
    </div>
  );
}

export function DashboardKeyField() {
  const t = useT();
  // Lazy init reads localStorage on the client; the SSR pass renders "" (the
  // input carries suppressHydrationWarning for that first-paint difference).
  const [key, setKey] = useState(() => {
    if (typeof window === "undefined") return "";
    try {
      return window.localStorage.getItem("fs.dashboardKey") ?? "";
    } catch {
      return "";
    }
  });
  const [savedTick, setSavedTick] = useState(false);

  function saveKey() {
    try {
      if (key.trim()) window.localStorage.setItem("fs.dashboardKey", key.trim());
      else window.localStorage.removeItem("fs.dashboardKey");
      setSavedTick(true);
      setTimeout(() => setSavedTick(false), 1500);
    } catch {
      // storage unavailable - nothing to persist
    }
  }

  return (
    <div className="flex items-center justify-between gap-4 px-3 py-3">
      <span className="min-w-0">
        <span className="block text-fg-muted">{t("settings.dashboardKey")}</span>
        <span className="block text-[11px] text-fg-subtle">
          {t("settings.dashboardKeyHint")}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <input
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="fsk_..."
          suppressHydrationWarning
          className="w-44 rounded-md border border-edge bg-canvas px-2 py-1 font-mono text-xs text-fg outline-none focus:border-accent"
        />
        <button
          onClick={saveKey}
          className="rounded-md bg-canvas-subtle px-2.5 py-1 text-xs text-fg hover:bg-neutral-muted"
        >
          {savedTick ? t("settings.savedTick") : t("entity.save")}
        </button>
      </span>
    </div>
  );
}
