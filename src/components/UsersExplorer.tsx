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
  KeyGrant,
  KeyGrantInput,
  KeyScope,
  ProjectRollup,
  SolutionRollup,
} from "@/lib/types";

type KeyTab = "details" | "activity";

// A key is expired once its expiry timestamp is in the past (ISO strings compare
// lexicographically in chronological order).
const isExpired = (apiKey: ApiKey) =>
  !!apiKey.expiresAt && apiKey.expiresAt <= new Date().toISOString();

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
  initialProjects,
}: {
  initialActors: Actor[];
  initialKeys: ApiKey[];
  initialSolutions: SolutionRollup[];
  initialProjects: ProjectRollup[];
}) {
  const t = useT();
  const narrow = useIsNarrow();
  const solutions = initialSolutions;
  const projects = initialProjects;

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

  // Human summary of one grant: target name + rights, e.g. "Zelda: write".
  const grantLabel = (g: KeyGrant) =>
    `${
      g.projectId
        ? (projects.find((p) => p.id === g.projectId)?.name ?? g.projectId)
        : g.solutionId
          ? (solutions.find((s) => s.id === g.solutionId)?.name ?? g.solutionId)
          : t("users.grantGlobal")
    }: ${g.scope}`;
  const keyCountOf = (id: string) =>
    keys.filter((k) => k.actorId === id && !k.revokedAt).length;

  async function createActor(
    name: string,
    kind: ActorKind,
    grants: KeyGrantInput[],
  ) {
    setError(null);
    try {
      const a = await api.createActor({ name, kind });
      await loadActors();
      await selectActor(a.id);
      // An agent with no key is useless and a footgun: a session would then
      // grab some other key and silently authenticate as the wrong actor. Mint
      // a key right away - with the grants chosen in the form (places + rights
      // are picked at creation, not on a later sub-token) - and surface the
      // token, so an agent is never left keyless. Humans act through the UI
      // and need no key.
      if (kind === "agent") {
        const created = await api.createApiKey({ actorId: a.id, grants });
        setJustCreated(created);
        await loadKeys();
      }
    } catch (e) {
      setError(errMessage(e, t("users.createKeyError")));
    }
  }

  async function createKey(grants: KeyGrantInput[]) {
    if (!actorId) return;
    setError(null);
    try {
      const created = await api.createApiKey({ actorId, grants });
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

  // --- column content (shared between desktop and mobile) ---

  // Flat list: one key = one user. Every actor is a top-level row - there is no
  // sub-key / delegation hierarchy in the model any more.
  const actorsCol = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        {actors.length === 0 ? (
          <ColHint text={t("users.noActors")} />
        ) : (
          withArchivedDivider(
            actors,
            (a) => !!a.archivedAt,
            (a) => (
              <ActorRow
                key={a.id}
                narrow={narrow}
                active={a.id === actorId}
                dimmed={!!a.archivedAt}
                actor={a}
                keyCount={keyCountOf(a.id)}
                onSelect={() => selectActor(a.id)}
              />
            ),
          )
        )}
      </div>
      <AddActorCta
        solutions={solutions}
        projects={projects}
        onCreate={createActor}
      />
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
                grantsLine={k.grants.map(grantLabel).join(" · ")}
                onSelect={() => selectKey(k.id)}
                onRevoke={() => revoke(k.id)}
              />
            ))}
          </div>
        )}
      </div>
      <AddKeyCta solutions={solutions} projects={projects} onCreate={createKey} />
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
          grantLabels={selectedKey ? selectedKey.grants.map(grantLabel) : []}
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
        <Column
          title={t("users.actors")}
          count={actors.length}
          collapseId="users.actors"
        >
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
  onSelect,
}: {
  narrow?: boolean;
  active: boolean;
  dimmed?: boolean;
  actor: Actor;
  keyCount: number;
  onSelect: () => void;
}) {
  const t = useT();
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
          <span
            className={`min-w-0 flex-1 truncate text-fg ${narrow ? "text-[15px]" : "text-sm"}`}
          >
            {actor.name}
          </span>
          {narrow && (
            <Icon name="chevron" size={18} className="-mr-1 shrink-0 text-fg-subtle" />
          )}
        </div>
        {/* The agent/human tag sits UNDER the name, next to the key count. */}
        <div className="flex items-center gap-1.5 text-[11px] text-fg-subtle">
          <KindBadge kind={actor.kind} />
          <span className="font-mono tabular-nums">
            {t("users.keyCount", { n: keyCount })}
          </span>
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
  grantsLine,
  onSelect,
  onRevoke,
}: {
  active: boolean;
  apiKey: ApiKey;
  /** Human summary of the key's grants, e.g. "Zelda: write · global: read". */
  grantsLine: string;
  onSelect: () => void;
  onRevoke: () => void;
}) {
  const t = useT();
  const expired = isExpired(apiKey);
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
        <span>{grantsLine}</span>
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
  grantLabels,
}: {
  apiKey: ApiKey | null;
  /** Human summaries of the key's grants (one entry per grant). */
  grantLabels: string[];
}) {
  const t = useT();
  // undefined = hidden (show button), null = unavailable (legacy key),
  // string = revealed token. Reset during render when the selection changes
  // (the React "derive state from props" pattern - no effect needed).
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [tokenKeyId, setTokenKeyId] = useState(apiKey?.id);
  if (tokenKeyId !== apiKey?.id) {
    setTokenKeyId(apiKey?.id);
    setToken(undefined);
  }

  if (!apiKey) return <ColHint text={t("users.pickKey")} />;
  const expired = isExpired(apiKey);
  const reveal = () =>
    api
      .getKeySecret(apiKey.id)
      .then((r) => setToken(r.token))
      .catch(() => setToken(null));
  const rows: { label: string; value: ReactNode }[] = [
    {
      label: t("users.keyPrefix"),
      value: <code className="font-mono text-fg">{apiKey.prefix}</code>,
    },
    {
      label: t("users.keyToken"),
      value:
        token === undefined ? (
          <button onClick={reveal} className="text-accent hover:underline">
            {t("users.showKey")}
          </button>
        ) : token === null ? (
          <span className="text-fg-subtle">{t("users.keyTokenUnavailable")}</span>
        ) : (
          <code
            title={token}
            className="select-all font-mono text-xs text-fg"
          >
            {token}
          </code>
        ),
    },
    { label: t("users.permissions"), value: apiKey.scope },
    {
      label: t("users.grants"),
      value: (
        <span className="flex flex-col items-end gap-0.5">
          {grantLabels.map((label, i) => (
            <span key={i}>{label}</span>
          ))}
        </span>
      ),
    },
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

/** One editable grant row in the key-creation forms. Target encoding:
 *  "" = global, "s:<id>" = whole solution, "p:<id>" = one project. */
type GrantDraft = { target: string; scope: KeyScope };

const freshDraft = (): GrantDraft => ({ target: "", scope: "write" });

const draftsToGrants = (drafts: GrantDraft[]): KeyGrantInput[] =>
  drafts.map((d) => ({
    ...(d.target.startsWith("s:") ? { solutionId: d.target.slice(2) } : {}),
    ...(d.target.startsWith("p:") ? { projectId: d.target.slice(2) } : {}),
    scope: d.scope,
  }));

/**
 * The grants picker used by BOTH key-creation forms: several rows, each a
 * place (global / whole solution / one project) plus the rights on it. Places
 * and rights are chosen at creation time - no follow-up sub-token needed.
 */
function GrantsEditor({
  drafts,
  onChange,
  solutions,
  projects,
}: {
  drafts: GrantDraft[];
  onChange: (drafts: GrantDraft[]) => void;
  solutions: SolutionRollup[];
  projects: ProjectRollup[];
}) {
  const t = useT();
  const set = (i: number, patch: Partial<GrantDraft>) =>
    onChange(drafts.map((d, di) => (di === i ? { ...d, ...patch } : d)));
  const selectCls =
    "rounded-md border border-edge bg-canvas px-2 py-1.5 text-sm text-fg";
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-[0.5px] text-fg-subtle">
        {t("users.grants")}
      </span>
      {drafts.map((d, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <select
            value={d.target}
            onChange={(e) => set(i, { target: e.target.value })}
            aria-label={t("users.grants")}
            className={`min-w-0 flex-1 ${selectCls}`}
          >
            <option value="">{t("users.grantGlobal")}</option>
            {solutions.map((s) => (
              <optgroup key={s.id} label={s.name}>
                <option value={`s:${s.id}`}>
                  {s.name} - {t("users.wholeSolution")}
                </option>
                {projects
                  .filter((p) => p.solutionId === s.id)
                  .map((p) => (
                    <option key={p.id} value={`p:${p.id}`}>
                      {s.name} › {p.name}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
          <select
            value={d.scope}
            onChange={(e) => set(i, { scope: e.target.value as KeyScope })}
            aria-label={t("users.scope")}
            className={selectCls}
          >
            <option value="write">write</option>
            <option value="read">read</option>
          </select>
          {drafts.length > 1 && (
            <button
              type="button"
              onClick={() => onChange(drafts.filter((_, di) => di !== i))}
              aria-label={t("users.removeGrant")}
              title={t("users.removeGrant")}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-fg-subtle hover:bg-neutral-muted hover:text-danger"
            >
              <Icon name="close" size={13} />
            </button>
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...drafts, freshDraft()])}
        className="flex items-center gap-1 self-start rounded-md px-1.5 py-1 text-xs font-medium text-accent hover:bg-canvas-subtle"
      >
        <Icon name="plus" size={13} />
        {t("users.addGrant")}
      </button>
    </div>
  );
}

function AddActorCta({
  solutions,
  projects,
  onCreate,
}: {
  solutions: SolutionRollup[];
  projects: ProjectRollup[];
  onCreate: (
    name: string,
    kind: ActorKind,
    grants: KeyGrantInput[],
  ) => Promise<void>;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ActorKind>("agent");
  const [drafts, setDrafts] = useState<GrantDraft[]>([freshDraft()]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    await onCreate(name.trim(), kind, draftsToGrants(drafts));
    setName("");
    setKind("agent");
    setDrafts([freshDraft()]);
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
          {/* An agent gets its key minted right away, so the places + rights
              are chosen here - humans act through the UI and need no key. */}
          {kind === "agent" && (
            <GrantsEditor
              drafts={drafts}
              onChange={setDrafts}
              solutions={solutions}
              projects={projects}
            />
          )}
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
  projects,
  onCreate,
}: {
  solutions: SolutionRollup[];
  projects: ProjectRollup[];
  onCreate: (grants: KeyGrantInput[]) => Promise<void>;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [drafts, setDrafts] = useState<GrantDraft[]>([freshDraft()]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    await onCreate(draftsToGrants(drafts));
    setDrafts([freshDraft()]);
    setOpen(false);
  }

  return (
    <div className="shrink-0 border-t border-edge bg-canvas p-2">
      {open ? (
        <form onSubmit={submit} className="flex flex-col gap-2">
          <GrantsEditor
            drafts={drafts}
            onChange={setDrafts}
            solutions={solutions}
            projects={projects}
          />
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

