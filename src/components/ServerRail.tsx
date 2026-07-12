"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { api } from "@/lib/api";
import { Connection } from "@/lib/types";
import { Icon } from "./icons";
import { BrandMark } from "./BrandMark";
import { errMessage } from "@/lib/format";
import { useT } from "@/i18n/provider";

// three.js water-wormhole effect - only loaded while a switch is in flight.
const SwitchFX = dynamic(() => import("./SwitchFX"), { ssr: false });

/* The connections rail: a slim WHITE strip on the far left (the visual inverse
   of the blue nav rail - white background, blue active element) listing the
   data sources this dashboard can show: "local" on top, saved remote Flow
   State instances below it (initials + host), and a "+" at the bottom to add
   one. Clicking an entry switches the ACTIVE source server-side (the whole
   /api surface starts proxying) and reloads the page; added servers can be
   removed with the hover "x". */

export function ServerRail() {
  const t = useT();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Full-screen switch transition: the source name being connected to + phase.
  const [switchTarget, setSwitchTarget] = useState<string>("");
  const [switchPhase, setSwitchPhase] = useState<
    null | "connecting" | "arriving" | "failed"
  >(null);
  // Reachability per remote connection ({id: up?}) for the status dot.
  const [health, setHealth] = useState<Record<string, boolean>>({});
  // Vortex direction seed - bumped on every (re)target so the wormhole visibly
  // changes course when you click a different server mid-switch.
  const [switchSeed, setSwitchSeed] = useState(0);
  // The content area's screen box, captured when a switch starts, so the
  // wormhole covers ONLY the content - both blue rails stay fully intact.
  const [contentBox, setContentBox] = useState<{
    left: number;
    top: number;
  } | null>(null);
  // Invalidates a still-running switch when it is re-targeted (last click wins).
  const switchToken = useRef(0);

  const load = () =>
    api
      .listConnections()
      .then((p) => {
        setConnections(p.connections);
        setActiveId(p.activeId);
      })
      .catch(() => {});
  const loadHealth = () =>
    api
      .getConnectionsHealth()
      .then(setHealth)
      .catch(() => {});
  useEffect(() => {
    load();
    loadHealth();
    // Re-check reachability periodically so a dot flips when a server goes
    // up/down without a manual refresh.
    const timer = setInterval(loadHealth, 15000);
    return () => clearInterval(timer);
  }, []);

  async function activate(id: string | null, label: string) {
    // Idle click on the already-active source is a no-op; but during a switch a
    // click on a DIFFERENT server re-targets the wormhole (change of mind).
    if (id === activeId && switchPhase === null) return;
    const token = ++switchToken.current;
    setBusy(true);
    setError(null);
    // Cover only the content area (both blue rails stay visible + clickable).
    const main = document.getElementById("fs-content");
    if (main) {
      const r = main.getBoundingClientRect();
      setContentBox({ left: r.left, top: r.top });
    }
    setSwitchTarget(label);
    // New random direction each (re)target so the vortex turns toward the new one.
    setSwitchSeed((s) => s + Math.PI * (0.6 + Math.random() * 1.4));
    setSwitchPhase("connecting");
    // The wormhole always plays for at least 2s (even a snappy local switch or
    // an instant refusal), then transitions smoothly into arrival or collapse.
    const minHold = new Promise((r) => setTimeout(r, 2000));
    try {
      await Promise.all([api.setActiveConnection(id), minHold]);
      if (switchToken.current !== token) return; // re-targeted - abandon this one
      // Arrival: fly through the wormhole (~550ms), then reload so the SSR
      // pages + SSE stream re-read from the new source. The flag makes the fresh
      // interface zoom in and settle (as if it rushed toward us out of the
      // wormhole) - read + cleared once on the next load.
      setSwitchPhase("arriving");
      try {
        sessionStorage.setItem("fs.justSwitched", "1");
      } catch {
        /* storage unavailable - the reload just skips the zoom-in */
      }
      await new Promise((r) => setTimeout(r, 550));
      if (switchToken.current !== token) return;
      window.location.reload();
    } catch {
      await minHold;
      if (switchToken.current !== token) return; // a newer switch owns the overlay
      // Failure: collapse the wormhole and show the message in place (no reload).
      setSwitchPhase("failed");
      setBusy(false);
    }
  }

  function dismissSwitch() {
    setSwitchPhase(null);
    setBusy(false);
  }

  async function remove(id: string) {
    setBusy(true);
    setError(null);
    try {
      const wasActive = id === activeId;
      await api.deleteConnection(id);
      if (wasActive) window.location.reload();
      else await load();
    } catch (e) {
      setError(errMessage(e, t("servers.switchError")));
    } finally {
      setBusy(false);
    }
  }

  // The rail width tracks the IP/host lengths (in ch): entries showing a host
  // set the baseline; a longer custom NAME is capped to it and fades out.
  const ipWidth = Math.max(
    9,
    "local".length,
    ...connections.map((c) => c.host.length),
  );

  return (
    <nav
      aria-label={t("servers.rail")}
      // w-fit: the rail hugs its widest chip, so it grows to fit the longest
      // host/IP (+ its status dot) and stays compact for short lists. The switch
      // overlay covers only the content area, so the rail stays visible and
      // clickable (re-target a switch by clicking another server).
      className="relative flex w-fit min-w-[4.5rem] shrink-0 flex-col bg-brand"
    >
      {/* Scrollable list; the divider below sits on the non-scrolling nav. */}
      <div className="flex flex-1 flex-col items-stretch gap-1.5 overflow-y-auto px-2.5 pb-3 pt-2.5">
        {/* "local" on top, then the saved hosts - a workspace-switcher list
            (Discord/Slack style: rounded chips, host + reachability dot). */}
        <RailEntry
          label={t("servers.local")}
          text="local"
          width={ipWidth}
          active={activeId === null}
          status="up"
          onClick={() => activate(null, t("servers.local"))}
        />

        {connections.length > 0 && (
          <span
            aria-hidden="true"
            className="mx-auto my-0.5 h-px w-8 rounded bg-white/20"
          />
        )}

        {connections.map((c) => (
          <RailEntry
            key={c.id}
            label={
              c.name ? `${c.name} - ${c.host}:${c.port}` : `${c.host}:${c.port}`
            }
            // Show the custom name if given, else the host/IP.
            text={c.name || c.host}
            width={ipWidth}
            active={c.id === activeId}
            status={c.id in health ? (health[c.id] ? "up" : "down") : null}
            onClick={() => activate(c.id, c.name || c.host)}
            onRemove={() => remove(c.id)}
            removeLabel={t("servers.remove")}
          />
        ))}

        <button
          onClick={() => setAdding(true)}
          aria-label={t("servers.add")}
          title={t("servers.add")}
          className="mt-0.5 flex items-center justify-center rounded-2xl border border-dashed border-white/30 py-2 font-mono text-base leading-none text-white/60 transition-colors hover:border-white/60 hover:bg-white/10 hover:text-white"
        >
          +
        </button>
      </div>

      {/* Delicate divider between the two rails, inset 10px top and bottom. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-[10px] right-0 w-px bg-white/40"
      />

      {adding && (
        <AddConnectionDialog
          busy={busy}
          error={error}
          onClose={() => {
            setAdding(false);
            setError(null);
          }}
          onSubmit={async (input) => {
            setBusy(true);
            setError(null);
            try {
              await api.createConnection(input);
              setAdding(false);
              await load();
            } catch (e) {
              setError(errMessage(e, t("servers.addError")));
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
      {error && !adding && (
        <p className="absolute bottom-0 left-full z-50 w-48 rounded bg-danger-muted p-2 text-[11px] text-danger">
          {error}
        </p>
      )}
      {switchPhase !== null && (
        <ServerSwitchOverlay
          target={switchTarget}
          phase={switchPhase}
          seed={switchSeed}
          box={contentBox}
          onDismiss={dismissSwitch}
        />
      )}
    </nav>
  );
}

function RailEntry({
  label,
  text,
  width,
  active,
  status,
  onClick,
  onRemove,
  removeLabel,
}: {
  label: string;
  /** What the entry shows: the custom name if given, else the host/IP. */
  text: string;
  /** Baseline width in ch (from the IPs); a longer name is capped + faded. */
  width: number;
  active: boolean;
  /** Reachability: "up" = green dot, "down" = red dot, null = still checking. */
  status?: "up" | "down" | null;
  onClick: () => void;
  onRemove?: () => void;
  removeLabel?: string;
}) {
  // A name longer than the IP baseline is clipped to it with a trailing fade,
  // then the dot; anything that fits shows in full (no fade, dot right after).
  const faded = text.length > width;
  return (
    <span className="group relative flex w-full items-center justify-center">
      <button
        onClick={onClick}
        aria-label={label}
        aria-pressed={active}
        title={label}
        className={`flex w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-2xl px-3 py-2 font-mono text-[10px] leading-none transition-all duration-200 ${
          active
            ? "bg-white text-brand shadow-sm"
            : "bg-white/10 text-white/70 hover:bg-white/20 hover:text-white"
        }`}
      >
        <span
          className={
            faded
              ? "block overflow-hidden text-left [mask-image:linear-gradient(to_right,#000_0,#000_calc(100%-14px),transparent)]"
              : "block"
          }
          style={faded ? { maxWidth: `${width}ch` } : undefined}
        >
          {text}
        </span>
        {/* Reachability dot, to the right of the host / name. */}
        {status && (
          <span
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${
              status === "up" ? "bg-emerald-400" : "bg-red-400"
            }`}
          />
        )}
      </button>
      {onRemove && (
        <button
          onClick={onRemove}
          aria-label={removeLabel}
          title={removeLabel}
          className="absolute -right-0.5 -top-0.5 hidden h-4 w-4 items-center justify-center rounded-full bg-white text-brand shadow hover:bg-danger hover:text-white group-hover:flex"
        >
          <Icon name="close" size={10} />
        </button>
      )}
    </span>
  );
}

/** Small modal to register a remote instance: name, host, port, API key. */
function AddConnectionDialog({
  busy,
  error,
  onClose,
  onSubmit,
}: {
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (input: {
    name: string;
    host: string;
    port: number;
    apiKey?: string;
  }) => void;
}) {
  const t = useT();
  const [name, setName] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("3000");
  const [apiKey, setApiKey] = useState("");

  function submit(e: FormEvent) {
    e.preventDefault();
    // Name is optional (the rail falls back to the host/IP); host + port required.
    if (!host.trim() || !Number(port)) return;
    onSubmit({
      name: name.trim(),
      host: host.trim(),
      port: Number(port),
      apiKey: apiKey.trim() || undefined,
    });
  }

  const inputCls =
    "w-full rounded-md border border-edge bg-canvas px-2 py-1.5 text-sm text-fg outline-none focus:border-accent";
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-md"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={t("servers.add")}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-sm flex-col gap-3 rounded-lg border border-edge bg-canvas p-4 shadow-hover"
      >
        <h2 className="text-sm font-semibold text-fg">{t("servers.add")}</h2>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("servers.nameOptionalPlaceholder")}
          className={inputCls}
        />
        <div className="flex gap-2">
          <input
            value={host}
            autoFocus
            onChange={(e) => setHost(e.target.value)}
            placeholder={t("servers.hostPlaceholder")}
            className={inputCls}
          />
          <input
            value={port}
            onChange={(e) => setPort(e.target.value)}
            placeholder="3000"
            className={`${inputCls} w-24`}
          />
        </div>
        <input
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={t("servers.keyPlaceholder")}
          className={`${inputCls} font-mono text-xs`}
        />
        <p className="text-[11px] text-fg-subtle">{t("servers.addHint")}</p>
        {error && <p className="text-xs text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm text-fg-muted hover:bg-canvas-subtle"
          >
            {t("forms.cancel")}
          </button>
          <button
            type="submit"
            disabled={busy || !host.trim() || !Number(port)}
            className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {t("forms.add")}
          </button>
        </div>
      </form>
    </div>
  );
}

/** The data-source switch transition. It covers ONLY the content area (`box`) so
 *  both blue rails stay fully visible - and the server rail stays clickable, so
 *  you can re-target the wormhole to a different server mid-switch. An
 *  Interstellar-style hyperspace tunnel plays with the connection status in the
 *  centre; on arrival it flies through into the new screens, on failure it
 *  collapses to a plain "could not reach" message with a Back button. */
function ServerSwitchOverlay({
  target,
  phase,
  seed,
  box,
  onDismiss,
}: {
  target: string;
  phase: "connecting" | "arriving" | "failed";
  /** Vortex direction seed (changes on re-target). */
  seed: number;
  /** Content-area box; the overlay covers exactly this (rails stay visible). */
  box: { left: number; top: number } | null;
  onDismiss: () => void;
}) {
  const t = useT();
  const failed = phase === "failed";
  return (
    <div
      style={{ left: box?.left ?? 0, top: box?.top ?? 0 }}
      className="fixed bottom-0 right-0 z-[100] flex flex-col items-center justify-center gap-5 overflow-hidden bg-canvas [animation:fs-switch-fade_250ms_ease-out]"
    >
      {/* Interstellar hyperspace tunnel: radial light streaks, a warm accretion
          mouth, violet/blue dispersion; grows from small to fill the content. */}
      <SwitchFX collapsing={failed} arriving={phase === "arriving"} seed={seed} />

      {failed ? (
        <div className="relative flex flex-col items-center gap-4 [animation:fs-switch-fade_400ms_ease-out]">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-danger-muted text-danger">
            <Icon name="alert" size={24} />
          </span>
          <div className="flex flex-col items-center gap-1">
            <span className="text-sm font-medium text-fg">
              {t("servers.connectFailed")}
            </span>
            <span className="font-mono text-xs text-fg-subtle">{target}</span>
          </div>
          <button
            onClick={onDismiss}
            className="rounded-md border border-edge bg-canvas-subtle px-4 py-1.5 text-sm text-fg transition-colors hover:bg-neutral-muted"
          >
            {t("common.back")}
          </button>
        </div>
      ) : (
        // The centre content fades out on arrival as we fly through the wormhole.
        <div
          className={`flex flex-col items-center gap-5 transition-opacity duration-500 ${
            phase === "arriving" ? "opacity-0" : "opacity-100"
          }`}
        >
          <span className="relative text-accent [animation:fs-switch-breathe_1.2s_ease-in-out_infinite]">
            <BrandMark size={52} />
          </span>
          <div className="relative flex flex-col items-center gap-1">
            <span className="text-sm font-medium text-fg">
              {t("servers.switching")}
            </span>
            <span className="font-mono text-xs text-accent">{target}</span>
          </div>
          <span className="relative flex gap-1.5">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="h-2 w-2 rounded-full bg-accent [animation:fs-switch-dot_1s_ease-in-out_infinite]"
                style={{ animationDelay: `${i * 0.15}s` }}
              />
            ))}
          </span>
        </div>
      )}
      <style>{`
        @keyframes fs-switch-fade { from { opacity: 0 } to { opacity: 1 } }
        @keyframes fs-switch-breathe {
          0%, 100% { transform: scale(1); opacity: 0.8 }
          50% { transform: scale(1.1); opacity: 1 }
        }
        @keyframes fs-switch-dot {
          0%, 80%, 100% { transform: translateY(0); opacity: 0.4 }
          40% { transform: translateY(-5px); opacity: 1 }
        }
      `}</style>
    </div>
  );
}

/** "local" / remote-name pill next to the brand in the header. */
export function ConnectionBadge() {
  const t = useT();
  const [active, setActive] = useState<
    { name: string; host: string; port: number } | null | undefined
  >(undefined);
  useEffect(() => {
    api
      .getAppSettings()
      .then((s) => setActive(s.activeConnection))
      .catch(() => setActive(null));
  }, []);
  if (active === undefined) return null;
  return active ? (
    <span
      title={`${active.host}:${active.port}`}
      className="rounded-full bg-accent-muted px-2 py-0.5 text-[11px] font-medium text-accent"
    >
      {active.name}
    </span>
  ) : (
    <span className="rounded-full bg-neutral-muted px-2 py-0.5 text-[11px] font-medium text-fg-muted">
      {t("servers.local")}
    </span>
  );
}
