"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useLiveRefresh } from "@/lib/use-live-refresh";
import type { ScoreKind } from "@/lib/scoreboard";
import type { DashboardPayload } from "@/lib/types";
import { Icon, IconName } from "./icons";
import { useT } from "@/i18n/provider";
import { useReducedMotion } from "@/lib/use-reduced-motion";

/** The dashboard.completedToday field corresponding to a given ScoreKind. */
type TodayKey = keyof DashboardPayload["completedToday"]; // tasks|milestones|projects

// tipKey is resolved through i18n at render time (META lives at module level).
const META: {
  kind: ScoreKind;
  field: TodayKey;
  icon: IconName;
  tipKey: string;
  cls: string;
}[] = [
  { kind: "project", field: "projects", icon: "project", tipKey: "scoreboard.projectsTip", cls: "text-amber-400" },
  { kind: "milestone", field: "milestones", icon: "milestone", tipKey: "scoreboard.milestonesTip", cls: "text-done" },
  { kind: "task", field: "tasks", icon: "check", tipKey: "scoreboard.tasksTip", cls: "text-success" },
];

const EMPTY: DashboardPayload["completedToday"] = { tasks: 0, milestones: 0, projects: 0 };

/**
 * Daily scoreboard (top-right HUD): how many tasks/milestones/projects were
 * closed TODAY. The numbers are AUTHORITATIVE from the server (dashboard.completedToday)
 * - counted per local day in SQLite, shared across sessions/agents, and they
 * survive a refresh. We fetch on startup + refresh LIVE via useLiveRefresh (the
 * same SSE stream as Overview/Explorer). The midnight reset happens on its own,
 * because the server decides what counts as "today".
 *
 * The "+1" animation (fly-plus-one) emits a window 'fs:score' {kind} event on
 * arrival - that ONLY triggers the counter POP (scale), it is NOT the source of
 * the number (zero double counting). Each counter has [data-score=kind] as the
 * target for the "+1" flight.
 */
export function Scoreboard() {
  const t = useT();
  const [today, setToday] = useState<DashboardPayload["completedToday"] | null>(
    null,
  );
  const [popSeq, setPopSeq] = useState<Record<ScoreKind, number>>({
    task: 0,
    milestone: 0,
    project: 0,
  });

  // Authoritative numbers from the server: on startup + on every mutation (SSE).
  const refresh = () => {
    api
      .getDashboard()
      .then((d) => setToday(d.completedToday))
      .catch(() => {
        // transient error (e.g. a UI rebuild) - the next SSE will try again
      });
  };
  useEffect(refresh, []);
  useLiveRefresh(refresh);

  // 'fs:score' on "+1" arrival -> only the counter POP (scale). The number comes
  // from the server; here we just bump the "seq" for a given kind so Counter bounces.
  useEffect(() => {
    const onScore = (e: Event) => {
      const kind = (e as CustomEvent<{ kind: ScoreKind }>).detail?.kind;
      if (!kind) return;
      setPopSeq((prev) => ({ ...prev, [kind]: prev[kind] + 1 }));
    };
    window.addEventListener("fs:score", onScore);
    return () => window.removeEventListener("fs:score", onScore);
  }, []);

  // The HUD is ALWAYS visible (zeros dimmed) - it's a permanent day counter in the
  // top-right corner of every view. That way "+1" always has somewhere to fly (the
  // [data-score] target already exists at the first close). Before the first fetch
  // we show zeros, so the layout doesn't jump.
  const value = today ?? EMPTY;

  // Live "today" counter in the right part of the header (next to the language switcher).
  return (
    <div className="flex items-center gap-1.5">
      <span className="mr-0.5 hidden text-[10px] font-semibold uppercase tracking-[0.5px] text-fg-subtle sm:inline">
        {t("scoreboard.today")}
      </span>
      {META.map((m) => (
        <Counter
          key={m.kind}
          kind={m.kind}
          icon={m.icon}
          cls={m.cls}
          tip={t(m.tipKey)}
          value={value[m.field]}
          popSeq={popSeq[m.kind]}
        />
      ))}
    </div>
  );
}

function Counter({
  kind,
  icon,
  cls,
  tip,
  value,
  popSeq,
}: {
  kind: ScoreKind;
  icon: IconName;
  cls: string;
  tip: string;
  value: number;
  popSeq: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const first = useRef(true);
  const reduced = useReducedMotion();

  // POP on "+1" arrival (popSeq change), except on the first render. The number
  // can change from the server without a "+1" (e.g. another agent) - then there's
  // no pop, just a smooth value swap; the pop is deliberately tied to the flight animation.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const el = ref.current;
    if (!el || reduced) return;
    el.animate(
      [
        { transform: "scale(1)" },
        { transform: "scale(1.5)", offset: 0.4 },
        { transform: "scale(1)" },
      ],
      { duration: 420, easing: "cubic-bezier(.34,1.56,.64,1)" },
    );
    // `reduced` only ever flips false -> true; when it does, the guard above
    // returns early, so it cannot cause a spurious pop on the same popSeq.
  }, [popSeq, reduced]);

  // group + pointer-events-auto: the HUD is pointer-events-none, so we enable
  // events on the counter itself for hover -> tooltip to work. IMPORTANT: the
  // dimming (when 0) is ONLY on the pill, not on the group - otherwise the parent's
  // opacity would multiply into the tooltip and it wouldn't be fully visible on hover.
  return (
    <span className="group pointer-events-auto relative flex items-center">
      <span
        className={`flex items-center gap-1 rounded-full border border-edge bg-canvas px-2 py-0.5 shadow-resting transition-opacity ${
          value === 0 ? "opacity-40" : "opacity-100"
        }`}
      >
        <Icon name={icon} size={13} className={cls} />
        <span
          ref={ref}
          data-score={kind}
          className="inline-block min-w-[0.9rem] text-center font-mono text-[13px] font-bold tabular-nums text-fg"
        >
          {value}
        </span>
      </span>
      {/* Tooltip below the counter (the HUD is at the top of the screen, so it
          expands downward). Anchored to the right edge so it doesn't go off-screen. */}
      <span
        role="tooltip"
        className="pointer-events-none absolute right-0 top-full z-10 mt-1.5 whitespace-nowrap rounded-md border border-edge bg-canvas px-2 py-1 text-[11px] font-medium text-fg-muted opacity-0 shadow-floating transition-opacity duration-150 group-hover:opacity-100"
      >
        {tip}
      </span>
    </span>
  );
}
