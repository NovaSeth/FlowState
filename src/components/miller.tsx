"use client";

import { ReactNode, useEffect, useState } from "react";
import { Icon } from "./icons";
import { useT } from "@/i18n/provider";

/**
 * Shared Miller-column primitives for the cascading explorers (Explorer.tsx and
 * UsersExplorer.tsx). These are pure layout/structure components - the same
 * markup, classes and behavior previously duplicated near-verbatim in both files.
 */

export function ColHeader({ title, count }: { title: string; count: number }) {
  return (
    <div className="flex items-center gap-2 border-b border-edge-muted px-3 py-2.5">
      <span className="text-[11px] font-semibold uppercase tracking-[0.5px] text-fg-subtle">
        {title}
      </span>
      <span className="rounded-full bg-neutral-muted px-1.5 py-0.5 font-mono text-[10px] text-fg-muted">
        {count}
      </span>
    </div>
  );
}

/**
 * A single Miller column: header plus a scrollable body. `scroll` adds the
 * vertical-scroll + bottom padding the Explorer uses on its columns;
 * UsersExplorer keeps the bare body (its children manage their own scroll).
 */
export function Column({
  title,
  count,
  scroll = false,
  children,
}: {
  title: string;
  count: number;
  scroll?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex w-72 shrink-0 flex-col border-r border-edge bg-canvas">
      <ColHeader title={title} count={count} />
      <div className={`min-h-0 flex-1${scroll ? " overflow-y-auto pb-2" : ""}`}>
        {children}
      </div>
    </div>
  );
}

export function ColHint({ text }: { text: string }) {
  return <p className="px-3 py-4 text-xs text-fg-subtle">{text}</p>;
}

export function Placeholder({ hint }: { hint: string }) {
  return (
    <div className="flex flex-1 items-center justify-center bg-canvas-subtle p-8">
      <p className="max-w-xs text-center text-sm text-fg-subtle">{hint}</p>
    </div>
  );
}

/** Column skeleton while fetching - distinguishes "loading" from "empty". */
export function ColLoading() {
  const t = useT();
  return (
    <div
      className="flex flex-col gap-2 p-3"
      aria-busy="true"
      aria-label={t("common.loading")}
    >
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="space-y-2 rounded-md border border-edge-muted px-3 py-2.5"
        >
          <div className="h-3 w-3/4 animate-pulse rounded bg-neutral-muted" />
          <div className="h-2 w-full animate-pulse rounded bg-neutral-muted" />
        </div>
      ))}
    </div>
  );
}

/**
 * Splits a list into active and archived: active first, then a collapsible
 * "Archived" section (collapsed by default) with a count of how many items it hides.
 */
export function withArchivedDivider<T>(
  items: T[],
  isArchived: (x: T) => boolean,
  render: (x: T) => ReactNode,
) {
  const live = items.filter((x) => !isArchived(x));
  const archived = items.filter(isArchived);
  return (
    <>
      {live.map(render)}
      {archived.length > 0 && (
        <ArchivedSection count={archived.length}>
          {archived.map(render)}
        </ArchivedSection>
      )}
    </>
  );
}

/** Collapsible section of archived items (collapsed by default). */
export function ArchivedSection({
  count,
  children,
}: {
  count: number;
  children: ReactNode;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 pb-1 pt-3 text-left active:bg-canvas-subtle"
      >
        <Icon
          name="chevron"
          size={14}
          className={`shrink-0 text-fg-subtle transition-transform ${open ? "rotate-90" : ""}`}
        />
        <span className="text-[11px] font-semibold uppercase tracking-[0.5px] text-fg-subtle">
          {t("common.archived")}
        </span>
        <span className="rounded-full bg-neutral-muted px-1.5 py-0.5 font-mono text-[10px] text-fg-muted">
          {count}
        </span>
        <span className="h-px flex-1 bg-edge" />
      </button>
      {open && children}
    </div>
  );
}

/**
 * Narrow-screen drill-down navigation. Each drill-down pushes an entry onto the
 * browser history; going back (iOS swipe-back gesture / back button) is caught
 * via popstate -> stepBack, so swipe-back navigates WITHIN Flow State instead of
 * leaving the app. On desktop (Miller columns) history is left alone.
 *
 * Returns `pushNav` (call before drilling in) and `goBack` (back-button handler:
 * history.back() on mobile so it goes through popstate, stepBack() on desktop).
 */
export function useDrillNavigation({
  narrow,
  stepBack,
}: {
  narrow: boolean;
  stepBack: () => void;
}) {
  // Mobile: swipe-back gesture / browser back button -> step back one level.
  useEffect(() => {
    if (!narrow) return;
    const onPop = () => stepBack();
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
    // stepBack reads its current selection from a ref, so it is stable across
    // renders; we intentionally only re-bind when narrow changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [narrow]);

  const pushNav = () => {
    if (narrow) window.history.pushState({ fs: true }, "");
  };
  const goBack = () => {
    if (narrow) window.history.back();
    else stepBack();
  };
  return { pushNav, goBack };
}

/**
 * Narrow-screen header for the drill-down view: a Back button (shown when not at
 * the root level) plus a breadcrumb showing the current level title, an optional
 * count pill, and an optional sub-title.
 */
export function DrillHeader({
  level,
  title,
  count,
  sub,
  crumbs,
  onBack,
}: {
  level: number;
  title: string;
  count?: number;
  sub?: ReactNode;
  // Breadcrumb trail kept on the left across deeper levels (e.g. solution ->
  // project -> milestone). When set, the level label + count move to the right.
  crumbs?: string[];
  onBack: () => void;
}) {
  const t = useT();
  const levelLabel = (
    <span className="flex shrink-0 items-center gap-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-[0.5px] text-fg-subtle">
        {title}
      </span>
      {count !== undefined && (
        <span className="rounded-full bg-neutral-muted px-1.5 py-0.5 font-mono text-[10px] text-fg-muted">
          {count}
        </span>
      )}
    </span>
  );
  return (
    <div className="flex shrink-0 items-center gap-1 border-b border-edge bg-canvas px-2 py-2">
      {level > 0 && (
        <button
          onClick={onBack}
          className="-ml-1 flex shrink-0 items-center rounded-md p-2 text-accent active:bg-canvas-subtle"
          aria-label={t("common.back")}
        >
          <Icon name="chevron" size={20} className="rotate-180" />
        </button>
      )}
      {crumbs && crumbs.length > 0 ? (
        // Breadcrumb (solution / project / milestone) on the left; level label
        // + count pushed right.
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="flex min-w-0 flex-1 items-center truncate text-sm">
            {crumbs.map((c, i) => (
              <span key={i} className="flex min-w-0 items-center">
                {i > 0 && (
                  <span className="shrink-0 px-1 text-fg-subtle">/</span>
                )}
                <span
                  className={`truncate ${i === 0 ? "font-semibold text-fg" : "text-fg-muted"}`}
                >
                  {c}
                </span>
              </span>
            ))}
          </div>
          {levelLabel}
        </div>
      ) : (
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">{levelLabel}</div>
          {sub && (
            <div className="truncate text-sm font-medium text-fg">{sub}</div>
          )}
        </div>
      )}
    </div>
  );
}
