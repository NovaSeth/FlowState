"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useT } from "@/i18n/provider";

type State =
  | "loading"
  | "running"
  | "stopped"
  | "starting"
  | "stopping"
  | "unknown"
  | "unreachable";

/**
 * Server control from Settings: Start / Stop / Restart. Talks DIRECTLY to the
 * local control port of the macOS app (server port + 1), not through Next - so
 * it still works after Stop, when Next no longer responds (the page is already
 * loaded). The control port listens only on loopback, so it's unreachable
 * remotely (a phone over LAN) -> we show the "local only" hint.
 */
export function ServerControl() {
  const t = useT();
  const [state, setState] = useState<State>("loading");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const base = useMemo(() => {
    if (typeof window === "undefined") return "";
    const { protocol, hostname, port } = window.location;
    const cport = port ? Number(port) + 1 : 3001;
    return `${protocol}//${hostname}:${cport}`;
  }, []);

  const busyRef = useRef(false);
  const poll = useCallback(async () => {
    if (busyRef.current) return; // don't overwrite the optimistic state mid-action
    try {
      const r = await fetch(`${base}/status`, { cache: "no-store" });
      const j = (await r.json()) as { state?: State };
      setState(j.state ?? "unknown");
    } catch {
      setState("unreachable");
    }
  }, [base]);

  useEffect(() => {
    const first = setTimeout(poll, 0); // deferred, to avoid setState synchronously in the effect
    const id = setInterval(poll, 3000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [poll]);

  const send = useCallback(
    async (cmd: "start" | "stop" | "restart") => {
      setBusy(true);
      busyRef.current = true;
      setConfirming(false);
      setState(cmd === "stop" ? "stopping" : "starting");
      try {
        // X-Flow-Control forces a CORS preflight - protection against CSRF from a foreign site.
        await fetch(`${base}/${cmd}`, {
          method: "POST",
          headers: { "X-Flow-Control": "1" },
        });
      } catch {
        // restart/stop kills Next mid-flight - a fetch error is expected
      }
      // let the transition settle, then resume polling
      setTimeout(() => {
        busyRef.current = false;
        setBusy(false);
        poll();
      }, 1200);
    },
    [base, poll],
  );

  const label = t(`settings.server.state.${state}`);
  const dot =
    state === "running"
      ? "bg-success"
      : state === "starting" || state === "stopping"
        ? "bg-accent"
        : "bg-fg-subtle";

  return (
    <div className="px-3 py-3">
      <div className="flex items-center justify-between gap-4">
        <span className="text-fg-muted">{t("settings.server.title")}</span>
        <span className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 font-mono text-sm text-fg">
            <span className={`inline-block h-2 w-2 rounded-full ${dot}`} />
            {label}
          </span>
        </span>
      </div>

      {state !== "unreachable" && state !== "loading" && (
        <div className="mt-2.5 flex items-center justify-end gap-2">
          {confirming ? (
            <>
              <span className="mr-auto text-xs text-fg-muted">
                {t("settings.server.confirmStop")}
              </span>
              <Btn onClick={() => send("stop")} tone="danger" disabled={busy}>
                {t("settings.server.stop")}
              </Btn>
              <Btn onClick={() => setConfirming(false)} disabled={busy}>
                {t("settings.server.cancel")}
              </Btn>
            </>
          ) : state === "running" ? (
            <>
              <Btn onClick={() => send("restart")} disabled={busy}>
                {t("settings.server.restart")}
              </Btn>
              <Btn onClick={() => setConfirming(true)} tone="danger" disabled={busy}>
                {t("settings.server.stop")}
              </Btn>
            </>
          ) : state === "stopped" || state === "unknown" ? (
            <Btn onClick={() => send("start")} tone="accent" disabled={busy}>
              {t("settings.server.start")}
            </Btn>
          ) : null}
        </div>
      )}

      {state === "unreachable" && (
        <p className="mt-2 text-xs text-fg-subtle">
          {t("settings.server.localOnly")}
        </p>
      )}
    </div>
  );
}

function Btn({
  children,
  onClick,
  tone,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  tone?: "danger" | "accent";
  disabled?: boolean;
}) {
  const cls =
    tone === "danger"
      ? "border-danger/40 text-danger hover:bg-danger-muted"
      : tone === "accent"
        ? "border-accent/40 text-accent hover:bg-accent-muted"
        : "border-edge text-fg-muted hover:bg-canvas-subtle";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${cls}`}
    >
      {children}
    </button>
  );
}
