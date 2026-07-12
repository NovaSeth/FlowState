"use client";

import { FormEvent, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Connection } from "@/lib/types";
import { Icon } from "./icons";
import { errMessage } from "@/lib/format";
import { useT } from "@/i18n/provider";

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

  const load = () =>
    api
      .listConnections()
      .then((p) => {
        setConnections(p.connections);
        setActiveId(p.activeId);
      })
      .catch(() => {});
  useEffect(() => {
    load();
  }, []);

  async function activate(id: string | null) {
    if (busy || id === activeId) return;
    setBusy(true);
    setError(null);
    try {
      await api.setActiveConnection(id);
      // Full reload: SSR pages, the SSE stream and every client cache must
      // re-read from the new source - a clean restart beats partial refetches.
      window.location.reload();
    } catch (e) {
      setError(errMessage(e, t("servers.switchError")));
      setBusy(false);
    }
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

  return (
    <nav
      aria-label={t("servers.rail")}
      className="relative flex w-16 shrink-0 flex-col items-center gap-1 overflow-y-auto border-r-2 border-white bg-brand pb-3 pt-2"
    >
      {/* Plain text list (no icons): "local" on top, then the saved hosts. */}
      <RailEntry
        label={t("servers.local")}
        text="local"
        active={activeId === null}
        onClick={() => activate(null)}
      />

      {connections.map((c) => (
        <RailEntry
          key={c.id}
          label={`${c.name} - ${c.host}:${c.port}`}
          text={c.host}
          active={c.id === activeId}
          onClick={() => activate(c.id)}
          onRemove={() => remove(c.id)}
          removeLabel={t("servers.remove")}
        />
      ))}

      <button
        onClick={() => setAdding(true)}
        aria-label={t("servers.add")}
        title={t("servers.add")}
        className="mt-1 w-14 rounded-md py-1.5 text-center font-mono text-sm leading-none text-white/70 transition-colors hover:bg-white/15 hover:text-white"
      >
        +
      </button>

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
    </nav>
  );
}

function RailEntry({
  label,
  text,
  active,
  onClick,
  onRemove,
  removeLabel,
}: {
  label: string;
  /** What the entry shows: "local" or the server's host/IP. */
  text: string;
  active: boolean;
  onClick: () => void;
  onRemove?: () => void;
  removeLabel?: string;
}) {
  return (
    <span className="group relative flex w-14 flex-col items-center">
      <button
        onClick={onClick}
        aria-label={label}
        aria-pressed={active}
        title={label}
        className={`w-14 break-all rounded-md px-1 py-1.5 text-center font-mono text-[9px] leading-tight transition-colors ${
          active
            ? "bg-white text-brand"
            : "text-white/80 hover:bg-white/15 hover:text-white"
        }`}
      >
        {text}
      </button>
      {onRemove && (
        <button
          onClick={onRemove}
          aria-label={removeLabel}
          title={removeLabel}
          className="absolute -right-1 -top-1 hidden h-4 w-4 items-center justify-center rounded-full bg-white/30 text-white hover:bg-danger hover:text-white group-hover:flex"
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
    if (!name.trim() || !host.trim() || !Number(port)) return;
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
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("servers.namePlaceholder")}
          className={inputCls}
        />
        <div className="flex gap-2">
          <input
            value={host}
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
            disabled={busy || !name.trim() || !host.trim()}
            className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {t("forms.add")}
          </button>
        </div>
      </form>
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
