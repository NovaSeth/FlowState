"use client";

import { ReactNode, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { Icon } from "./icons";
import { useIsNarrow } from "@/lib/use-is-narrow";
import { useLiveRefresh } from "@/lib/use-live-refresh";
import { useT } from "@/i18n/provider";
import { errMessage, formatTimestamp } from "@/lib/format";
import { CountPill } from "./ui";
import {
  ColHint,
  ColLoading,
  Column,
  DrillHeader,
  Placeholder,
  useDrillNavigation,
  withArchivedDivider,
} from "./miller";
import type {
  Actor,
  ActorKind,
  Activity,
  ApiKey,
  ApiKeyWithSecret,
  KeyScope,
  SolutionRollup,
} from "@/lib/types";

type KeyTab = "details" | "activity";

/**
 * Cascading users explorer (Miller columns): Actors -> Keys / actor activity ->
 * Details / key activity. A mirror of Explorer.tsx, but for identities (who acts
 * and with what). Each level is fetched on demand via the REST API.
 *
 * Wide screen: columns side by side (horizontal scroll). Narrow screen: one
 * level at full width plus a Back button (drill-down like in the Explorer).
 */
export function UsersExplorer({
  initialActors,
  initialKeys,
  initialSolutions,
}: {
  initialActors: Actor[];
  initialKeys: ApiKey[];
  initialSolutions: SolutionRollup[];
}) {
  const t = useT();
  const narrow = useIsNarrow();
  const solutions = initialSolutions;

  const [actors, setActors] = useState<Actor[]>(initialActors);
  // All keys (for the counters in the actors column); the keys column filters
  // by the current actor. Kept globally, since they are needed on column 0 anyway.
  const [keys, setKeys] = useState<ApiKey[]>(initialKeys);
  const [keyActivity, setKeyActivity] = useState<Activity[]>([]);

  const [actorId, setActorId] = useState<string | null>(null);
  const [keyId, setKeyId] = useState<string | null>(null);
  const [keyTab, setKeyTab] = useState<KeyTab>("details");

  const [loadingKeyActivity, setLoadingKeyActivity] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [justCreated, setJustCreated] = useState<ApiKeyWithSecret | null>(null);
  // Which parent actors have their sub-APIs expanded (collapsed by default).
  const [expandedSubs, setExpandedSubs] = useState<Set<string>>(new Set());

  const loadActors = async () => setActors(await api.listActors());
  const loadKeys = async () => setKeys(await api.listApiKeys());
  const loadKeyActivity = async (id: string) => {
    setLoadingKeyActivity(true);
    try {
      setKeyActivity(await api.listActivity({ entityId: id, limit: 100 }));
    } finally {
      setLoadingKeyActivity(false);
    }
  };

  async function selectActor(id: string) {
    pushNav();
    setActorId(id);
    setKeyId(null);
    setKeyActivity([]);
  }
  async function selectKey(id: string) {
    pushNav();
    setKeyId(id);
    setKeyTab("details");
    await loadKeyActivity(id);
  }

  // Step back one level (directly on desktop, through history on mobile).
  const sel = useRef({ actorId, keyId });
  useEffect(() => {
    sel.current = { actorId, keyId };
  }, [actorId, keyId]);

  function stepBack() {
    const s = sel.current;
    if (s.keyId) {
      setKeyId(null);
      setKeyActivity([]);
    } else if (s.actorId) {
      setActorId(null);
    }
  }
  const { pushNav, goBack } = useDrillNavigation({ narrow, stepBack });

  // Live: SSE triggers a refetch of the visible levels (the same hook as Explorer).
  useLiveRefresh(() => {
    const s = sel.current;
    api.listActors().then(setActors);
    api.listApiKeys().then(setKeys);
    if (s.keyId) api.listActivity({ entityId: s.keyId, limit: 100 }).then(setKeyActivity);
  });

  const selectedActor = actors.find((a) => a.id === actorId) ?? null;
  const selectedKey = keys.find((k) => k.id === keyId) ?? null;
  const actorKeys = actorId ? keys.filter((k) => k.actorId === actorId) : [];

  const solutionName = (id: string | null) =>
    id ? (solutions.find((s) => s.id === id)?.name ?? id) : t("users.globalScope");
  const keyCountOf = (id: string) =>
    keys.filter((k) => k.actorId === id && !k.revokedAt).length;

  async function createActor(name: string, kind: ActorKind) {
    setError(null);
    try {
      const a = await api.createActor({ name, kind });
      await loadActors();
      await selectActor(a.id);
      // An agent with no key is useless and a footgun: a session would then
      // grab some other key and silently authenticate as the wrong actor. Mint
      // a write key right away and surface the token, so an agent is never left
      // keyless. Humans act through the UI and need no key.
      if (kind === "agent") {
        const created = await api.createApiKey({ actorId: a.id, scope: "write" });
        setJustCreated(created);
        await loadKeys();
      }
    } catch (e) {
      setError(errMessage(e, t("users.createKeyError")));
    }
  }

  async function createKey(scope: KeyScope, solutionId: string | undefined) {
    if (!actorId) return;
    setError(null);
    try {
      const created = await api.createApiKey({ actorId, solutionId, scope });
      setJustCreated(created);
      await loadKeys();
    } catch (e) {
      setError(errMessage(e, t("users.createKeyError")));
    }
  }

  async function revoke(id: string) {
    setError(null);
    try {
      await api.revokeApiKey(id);
      await loadKeys();
    } catch (e) {
      setError(errMessage(e, t("users.revokeError")));
    }
  }

  // Parent actor of a delegated actor: actor.createdByKeyId -> key -> its actorId.
  // (Sub-API = an actor minted with another actor's key.)
  const parentActorIdOf = (a: Actor): string | null => {
    if (!a.createdByKeyId) return null;
    const k = keys.find((kk) => kk.id === a.createdByKeyId);
    return k && k.actorId !== a.id ? k.actorId : null;
  };
  const childrenByParent = new Map<string, Actor[]>();
  for (const a of actors) {
    const p = parentActorIdOf(a);
    if (p && actors.some((x) => x.id === p)) {
      const arr = childrenByParent.get(p) ?? [];
      arr.push(a);
      childrenByParent.set(p, arr);
    }
  }
  // Roots: actors without a (known) parent - sub-APIs collapse underneath them.
  const rootActors = actors.filter((a) => {
    const p = parentActorIdOf(a);
    return !p || !actors.some((x) => x.id === p);
  });
  const toggleSub = (id: string) =>
    setExpandedSubs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const renderActorNode = (a: Actor): React.ReactNode => {
    const kids = childrenByParent.get(a.id) ?? [];
    const open = expandedSubs.has(a.id);
    return (
      <div key={a.id}>
        <ActorRow
          narrow={narrow}
          active={a.id === actorId}
          dimmed={!!a.archivedAt}
          actor={a}
          keyCount={keyCountOf(a.id)}
          childCount={kids.length}
          expanded={open}
          onToggle={() => toggleSub(a.id)}
          onSelect={() => selectActor(a.id)}
        />
        {open && kids.length > 0 && (
          // Guide line connecting the sub-API to its parent (readable hierarchy).
          <div className="ml-[1.55rem] border-l border-edge">
            {kids.map((c) => renderActorNode(c))}
          </div>
        )}
      </div>
    );
  };

  // --- column content (shared between desktop and mobile) ---

  const actorsCol = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        {actors.length === 0 ? (
          <ColHint text={t("users.noActors")} />
        ) : (
          withArchivedDivider(
            rootActors,
            (a) => !!a.archivedAt,
            (a) => renderActorNode(a),
          )
        )}
      </div>
      <AddActorCta onCreate={createActor} />
    </div>
  );

  const keysList = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {actorKeys.length === 0 ? (
          <ColHint text={t("users.noKeysActor")} />
        ) : (
          <div className="flex flex-col gap-1.5">
            {actorKeys.map((k) => (
              <KeyRow
                key={k.id}
                active={k.id === keyId}
                apiKey={k}
                solutionName={solutionName(k.solutionId)}
                onSelect={() => selectKey(k.id)}
                onRevoke={() => revoke(k.id)}
              />
            ))}
          </div>
        )}
      </div>
      <AddKeyCta solutions={solutions} onCreate={createKey} />
    </div>
  );

  // No tabs: selecting an actor shows its API keys right away.
  // (Activity lives on a specific key, after clicking into it.)
  const actorPaneInner = (
    <>
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-edge-muted px-3">
        <span className="truncate text-sm font-medium text-fg">
          {selectedActor?.name ?? t("users.keys")}
        </span>
        {selectedActor && <CountPill className="shrink-0">{actorKeys.length}</CountPill>}
      </div>
      {keysList}
    </>
  );

  const keyPaneInner = (
    <>
      <TabBar
        title={selectedKey?.prefix ?? t("users.details")}
        mono
        tabs={[
          { value: "details", label: t("users.details") },
          { value: "activity", label: t("users.activity") },
        ]}
        value={keyTab}
        onChange={(v) => setKeyTab(v as KeyTab)}
      />
      {keyTab === "details" ? (
        <KeyDetails
          apiKey={selectedKey}
          solutionName={selectedKey ? solutionName(selectedKey.solutionId) : "-"}
          mintedCount={
            selectedKey
              ? keys.filter((k) => k.createdByKeyId === selectedKey.id).length
              : 0
          }
        />
      ) : (
        <ActivityFeed
          loading={loadingKeyActivity}
          events={keyActivity}
          actors={actors}
          emptyText={t("users.noKeyActivity")}
        />
      )}
    </>
  );

  const banner = (
    <>
      {error && (
        <div className="border-b border-danger bg-danger-muted px-3 py-2 text-sm text-danger">
          {error}
        </div>
      )}
      {justCreated && (
        <div className="border-b border-success bg-success-muted px-3 py-3 text-sm">
          <div className="font-semibold text-fg">{t("users.keyCreated")}</div>
          <code className="mt-1 block break-all rounded bg-canvas px-2 py-1 font-mono text-xs text-fg">
            {justCreated.token}
          </code>
          <button
            onClick={() => setJustCreated(null)}
            className="mt-2 text-xs text-accent hover:underline"
          >
            {t("users.hide")}
          </button>
        </div>
      )}
    </>
  );

  // --- mobile view: one level at full width ---
  if (narrow) {
    const level = keyId ? 2 : actorId ? 1 : 0;
    const titles = [t("users.actors"), t("users.keys"), t("users.details")];
    const subs = [undefined, selectedActor?.name, selectedKey?.prefix];
    const counts = [actors.length, actorKeys.length, undefined];

    const body =
      level === 0 ? (
        <div className="min-h-0 flex-1 bg-canvas">{actorsCol}</div>
      ) : level === 1 ? (
        <div className="flex min-h-0 flex-1 flex-col bg-canvas">{actorPaneInner}</div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col bg-canvas">{keyPaneInner}</div>
      );

    return (
      <div className="flex h-full min-h-0 flex-col">
        <DrillHeader
          level={level}
          title={titles[level]}
          count={counts[level]}
          sub={subs[level]}
          onBack={goBack}
        />
        {banner}
        {body}
      </div>
    );
  }

  // --- desktop view: Miller columns board ---
  return (
    <div className="flex h-full min-h-0 flex-col">
      {banner}
      <div className="flex min-h-0 flex-1 overflow-x-auto">
        <Column title={t("users.actors")} count={actors.length}>
          {actorsCol}
        </Column>

        {actorId ? (
          <div className="flex w-80 shrink-0 flex-col border-r border-edge bg-canvas">
            {actorPaneInner}
          </div>
        ) : (
          <Placeholder hint={t("users.pickActor")} />
        )}

        {actorId &&
          (keyId ? (
            <div className="flex w-96 shrink-0 flex-col border-r border-edge bg-canvas">
              {keyPaneInner}
            </div>
          ) : (
            <Placeholder hint={t("users.pickKey")} />
          ))}
      </div>
    </div>
  );
}

// --- sub-components ---

function ActorRow({
  narrow,
  active,
  dimmed,
  actor,
  keyCount,
  childCount = 0,
  expanded = false,
  onToggle,
  onSelect,
}: {
  narrow?: boolean;
  active: boolean;
  dimmed?: boolean;
  actor: Actor;
  keyCount: number;
  childCount?: number;
  expanded?: boolean;
  onToggle?: () => void;
  onSelect: () => void;
}) {
  const t = useT();
  const hasKids = childCount > 0;
  return (
    <div
      className={`group relative ${dimmed ? "opacity-50 transition-opacity hover:opacity-100" : ""}`}
    >
      <button
        onClick={onSelect}
        className={`flex w-full flex-col gap-1 px-2.5 text-left transition-colors ${
          narrow ? "py-3 active:bg-canvas-subtle" : "py-2.5"
        } ${active ? "bg-accent-muted" : narrow ? "" : "hover:bg-canvas-subtle"}`}
      >
        <div className="flex w-full items-center gap-2">
          {hasKids ? (
            <span
              role="button"
              tabIndex={0}
              aria-label={t("users.toggleSubAgents")}
              onClick={(e) => {
                e.stopPropagation();
                onToggle?.();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  onToggle?.();
                }
              }}
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-fg-subtle hover:bg-neutral-muted hover:text-fg"
            >
              <Icon
                name="chevron"
                size={15}
                className={`transition-transform ${expanded ? "rotate-90" : ""}`}
              />
            </span>
          ) : (
            <span className="h-5 w-5 shrink-0" />
          )}
          <KindBadge kind={actor.kind} />
          <span
            className={`min-w-0 flex-1 truncate text-fg ${narrow ? "text-[15px]" : "text-sm"} ${
              hasKids ? "font-medium" : ""
            }`}
          >
            {actor.name}
          </span>
          {narrow && (
            <Icon name="chevron" size={18} className="-mr-1 shrink-0 text-fg-subtle" />
          )}
        </div>
        <div className="flex items-center gap-1.5 pl-7 text-[11px] text-fg-subtle">
          <span className="font-mono tabular-nums">
            {t("users.keyCount", { n: keyCount })}
          </span>
          {hasKids && (
            <>
              <span aria-hidden>&middot;</span>
              <span className="text-accent">{t("users.subAgents", { n: childCount })}</span>
            </>
          )}
          {actor.archivedAt && (
            <>
              <span aria-hidden>&middot;</span>
              <span>{t("users.archivedActor")}</span>
            </>
          )}
        </div>
      </button>
    </div>
  );
}

function KeyRow({
  active,
  apiKey,
  solutionName,
  onSelect,
  onRevoke,
}: {
  active: boolean;
  apiKey: ApiKey;
  solutionName: string;
  onSelect: () => void;
  onRevoke: () => void;
}) {
  const t = useT();
  const expired = !!apiKey.expiresAt && apiKey.expiresAt <= new Date().toISOString();
  return (
    <button
      onClick={onSelect}
      className={`flex w-full flex-col gap-1.5 rounded-md border px-3 py-2 text-left transition-all ${
        active
          ? "border-accent bg-canvas shadow-hover"
          : "border-edge bg-canvas hover:-translate-y-px hover:border-accent hover:shadow-hover"
      }`}
    >
      <div className="flex items-center gap-2.5">
        <code className="font-mono text-sm text-fg">{apiKey.prefix}</code>
        <span className="rounded-full bg-neutral-muted px-1.5 py-0.5 text-[10px] font-medium text-fg-muted">
          {apiKey.scope}
        </span>
        {apiKey.revokedAt ? (
          <span className="ml-auto text-xs font-medium text-danger">
            {t("users.revoked")}
          </span>
        ) : (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onRevoke();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                onRevoke();
              }
            }}
            className="ml-auto text-xs text-danger hover:underline"
          >
            {t("users.revoke")}
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-fg-subtle">
        <span>{solutionName}</span>
        {apiKey.expiresAt && (
          <span className={expired ? "text-danger" : ""}>
            {expired ? t("users.expired") : t("users.expiresAt", { when: formatTimestamp(apiKey.expiresAt) })}
          </span>
        )}
        <span>
          {apiKey.lastUsedAt
            ? t("users.usedAt", { when: formatTimestamp(apiKey.lastUsedAt) })
            : t("users.neverUsed")}
        </span>
      </div>
    </button>
  );
}

function KeyDetails({
  apiKey,
  solutionName,
  mintedCount,
}: {
  apiKey: ApiKey | null;
  solutionName: string;
  mintedCount: number;
}) {
  const t = useT();
  if (!apiKey) return <ColHint text={t("users.pickKey")} />;
  const expired = !!apiKey.expiresAt && apiKey.expiresAt <= new Date().toISOString();
  const rows: { label: string; value: ReactNode }[] = [
    {
      label: t("users.keyPrefix"),
      value: <code className="font-mono text-fg">{apiKey.prefix}</code>,
    },
    { label: t("users.permissions"), value: apiKey.scope },
    { label: t("users.solutionScope"), value: solutionName },
    {
      label: t("users.keyExpiry"),
      value: apiKey.expiresAt ? (
        <span className={expired ? "text-danger" : undefined}>
          {expired ? t("users.expired") : formatTimestamp(apiKey.expiresAt)}
        </span>
      ) : (
        t("users.noExpiry")
      ),
    },
    {
      label: t("users.keyLastUsed"),
      value: apiKey.lastUsedAt ? formatTimestamp(apiKey.lastUsedAt) : t("users.neverUsed"),
    },
    { label: t("users.keyCreatedAt"), value: formatTimestamp(apiKey.createdAt) },
    {
      label: t("users.keyRevoked"),
      value: apiKey.revokedAt ? (
        <span className="text-danger">{formatTimestamp(apiKey.revokedAt)}</span>
      ) : (
        "-"
      ),
    },
    { label: t("users.keyMinted"), value: String(mintedCount) },
  ];
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-3">
      <dl className="flex flex-col gap-2">
        {rows.map((r) => (
          <div
            key={r.label}
            className="flex items-baseline justify-between gap-3 border-b border-edge-muted pb-2 text-sm"
          >
            <dt className="shrink-0 text-fg-subtle">{r.label}</dt>
            <dd className="min-w-0 truncate text-right text-fg">{r.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function ActivityFeed({
  loading,
  events,
  actors,
  emptyText,
}: {
  loading: boolean;
  events: Activity[];
  actors: Actor[];
  emptyText: string;
}) {
  if (loading) return <ColLoading />;
  if (events.length === 0) return <ColHint text={emptyText} />;
  const actorName = (id: string | null) =>
    id ? (actors.find((a) => a.id === id)?.name ?? id) : "-";
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-3">
      <ul className="flex flex-col gap-1">
        {events.map((ev) => (
          <li
            key={ev.id}
            className="flex flex-wrap items-center gap-x-2 border-b border-edge-muted py-1 text-xs"
          >
            <span className="font-mono text-fg-subtle">{formatTimestamp(ev.at)}</span>
            <span className="font-medium text-fg">{actorName(ev.actorId)}</span>
            <span className="text-fg-muted">
              {ev.entityType}.{ev.action}
            </span>
            {ev.summary && <span className="text-fg-muted">{ev.summary}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function AddActorCta({
  onCreate,
}: {
  onCreate: (name: string, kind: ActorKind) => Promise<void>;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ActorKind>("agent");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    await onCreate(name.trim(), kind);
    setName("");
    setKind("agent");
    setOpen(false);
  }

  return (
    <div className="shrink-0 border-t border-edge bg-canvas p-2">
      {open ? (
        <form onSubmit={submit} className="flex flex-col gap-2">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("users.addActorNamePlaceholder")}
            aria-label={t("users.addActorName")}
            className="rounded-md border border-edge bg-canvas px-2 py-1.5 text-sm text-fg"
          />
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as ActorKind)}
            aria-label={t("users.addActorKind")}
            className="rounded-md border border-edge bg-canvas px-2 py-1.5 text-sm text-fg"
          >
            <option value="agent">{t("users.kindAgent")}</option>
            <option value="human">{t("users.kindHuman")}</option>
          </select>
          <div className="flex gap-2">
            <button
              type="submit"
              className="flex-1 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
            >
              {t("users.create")}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md border border-edge px-3 py-1.5 text-sm text-fg-muted hover:bg-canvas-subtle"
            >
              {t("users.cancel")}
            </button>
          </div>
        </form>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-edge px-3 py-2 text-sm font-medium text-accent hover:border-accent hover:bg-canvas-subtle"
        >
          <Icon name="plus" size={16} />
          {t("users.addActor")}
        </button>
      )}
    </div>
  );
}

function AddKeyCta({
  solutions,
  onCreate,
}: {
  solutions: SolutionRollup[];
  onCreate: (scope: KeyScope, solutionId: string | undefined) => Promise<void>;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<KeyScope>("write");
  const [solutionId, setSolutionId] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    await onCreate(scope, solutionId || undefined);
    setScope("write");
    setSolutionId("");
    setOpen(false);
  }

  return (
    <div className="shrink-0 border-t border-edge bg-canvas p-2">
      {open ? (
        <form onSubmit={submit} className="flex flex-col gap-2">
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value as KeyScope)}
            aria-label={t("users.scope")}
            className="rounded-md border border-edge bg-canvas px-2 py-1.5 text-sm text-fg"
          >
            <option value="write">write</option>
            <option value="read">read</option>
          </select>
          <select
            value={solutionId}
            onChange={(e) => setSolutionId(e.target.value)}
            aria-label={t("users.solutionScope")}
            className="rounded-md border border-edge bg-canvas px-2 py-1.5 text-sm text-fg"
          >
            <option value="">{t("users.globalScope")}</option>
            {solutions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <div className="flex gap-2">
            <button
              type="submit"
              className="flex-1 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
            >
              {t("users.createKey")}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md border border-edge px-3 py-1.5 text-sm text-fg-muted hover:bg-canvas-subtle"
            >
              {t("users.cancel")}
            </button>
          </div>
        </form>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-edge px-3 py-2 text-sm font-medium text-accent hover:border-accent hover:bg-canvas-subtle"
        >
          <Icon name="plus" size={16} />
          {t("users.addKey")}
        </button>
      )}
    </div>
  );
}

function KindBadge({ kind }: { kind: ActorKind }) {
  const t = useT();
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
        kind === "human" ? "bg-accent-muted text-accent" : "bg-done-muted text-done"
      }`}
    >
      {kind === "human" ? t("users.kindHuman") : t("users.kindAgent")}
    </span>
  );
}

/**
 * Tab bar for the key detail panel (Details / Activity). Style consistent with
 * the column headers (border-b, accent under the active tab).
 */
function TabBar<V extends string>({
  title,
  mono,
  tabs,
  value,
  onChange,
}: {
  title: string;
  mono?: boolean;
  tabs: { value: V; label: string }[];
  value: V;
  onChange: (v: V) => void;
}) {
  return (
    <div className="flex h-11 shrink-0 items-center gap-4 border-b border-edge-muted px-3">
      <span
        className={`min-w-0 max-w-[45%] truncate text-[11px] font-semibold uppercase tracking-[0.5px] text-fg-subtle ${
          mono ? "font-mono normal-case" : ""
        }`}
      >
        {title}
      </span>
      {tabs.map((tab) => (
        <button
          key={tab.value}
          onClick={() => onChange(tab.value)}
          aria-current={value === tab.value ? "page" : undefined}
          className={`-mb-px self-stretch border-b-2 text-[11px] font-semibold uppercase tracking-[0.5px] transition-colors ${
            value === tab.value
              ? "border-accent text-fg"
              : "border-transparent text-fg-subtle hover:text-fg"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

