"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useLiveRefresh } from "@/lib/use-live-refresh";
import { newIds } from "@/lib/scoreboard";
import { flyPlusOne } from "@/lib/fly-plus-one";
import { TaskStatus } from "@/lib/types";

// three.js (WinOverlay) only loads on the first project/solution win.
const WinOverlay = dynamic(
  () => import("./WinOverlay").then((m) => m.WinOverlay),
  { ssr: false },
);

interface WinItem {
  id: number;
  tier: "project" | "solution";
}

const isTerminal = (s?: TaskStatus) => s === "done" || s === "closed";

/** Rectangle of the element with the given data-cid (for the "+1" animation from its source). */
function rectFor(id?: string | null): DOMRect | null {
  if (!id || typeof document === "undefined") return null;
  const el = document.querySelector<HTMLElement>(`[data-cid="${id}"]`);
  return el ? el.getBoundingClientRect() : null;
}

/**
 * Orchestrator of the "scoreboard" gamification. On SSE:
 *  - changesSince -> which TASKS just completed (by id) -> "+1" flies from their
 *    row (or from the parent milestone, or the center) to the task counter,
 *  - dashboard.completedIds -> which MILESTONES/PROJECTS/SOLUTIONS just completed ->
 *    milestone: "+1" with a ribbon to the milestone counter; project/solution: a
 *    full-screen "YOU WIN" (three.js), and after a project closes a "+1" flies to the project counter.
 * The first load only SEEDS (zero celebrations for history).
 */
export function Celebrations() {
  const seeded = useRef(false);
  const since = useRef("");
  const taskStatus = useRef<Map<string, TaskStatus>>(new Map());
  // Hierarchy for anchoring "+1" on the deepest VISIBLE container card
  // (task -> milestone -> project -> solution). Full snapshot at seed
  // (changesSince("")), refreshed from every delta.
  const msToProj = useRef<Map<string, string>>(new Map());
  const projToSol = useRef<Map<string, string>>(new Map());
  const doneMs = useRef<Set<string>>(new Set());
  const doneProj = useRef<Set<string>>(new Set());
  const doneSol = useRef<Set<string>>(new Set());

  const [wins, setWins] = useState<WinItem[]>([]);
  const winSeq = useRef(0);

  // Serialization: during a burst of agent mutations SSE may call onChange many
  // times in parallel; the shared refs (since, the done sets) must not race.
  // running = in progress; pending = a request arrived mid-flight -> run once more.
  const running = useRef(false);
  const pending = useRef(false);

  // Anchor that GROUPS completions: the deepest VISIBLE container card (milestone ->
  // project -> solution), SKIPPING the task level. This makes completions in the
  // same view add up together (on the task list: by milestone), rather than each
  // one separately by its own row. `id` = group key; `rect` = anchor of the aggregate "+N".
  const groupAnchor = useCallback((milestoneId: string) => {
    const projectId = msToProj.current.get(milestoneId);
    const solutionId = projectId ? projToSol.current.get(projectId) : undefined;
    for (const id of [milestoneId, projectId, solutionId]) {
      if (!id) continue;
      const rect = rectFor(id);
      if (rect) return { id, rect };
    }
    return { id: null as string | null, rect: null as DOMRect | null };
  }, []);

  const seed = useCallback(async () => {
    try {
      const ch = await api.changesSince("");
      taskStatus.current = new Map(ch.tasks.map((t) => [t.id, t.status]));
      msToProj.current = new Map(ch.milestones.map((m) => [m.id, m.projectId]));
      projToSol.current = new Map(ch.projects.map((p) => [p.id, p.solutionId]));
      since.current = ch.serverTime;
      const d = await api.getDashboard();
      doneMs.current = new Set(d.completedIds.milestones);
      doneProj.current = new Set(d.completedIds.projects);
      doneSol.current = new Set(d.completedIds.solutions);
      seeded.current = true;
    } catch {
      // we'll try again on the next SSE
    }
  }, []);

  const runOnce = useCallback(async () => {
    if (!seeded.current) {
      await seed();
      return;
    }
    try {
      // 1) TASKS - by id (changesSince), source = the deepest VISIBLE container
      // card (task row / milestone / project / solution), or the center.
      const ch = await api.changesSince(since.current);
      since.current = ch.serverTime;
      // Pull the hierarchy from the delta (new/changed milestones and projects).
      for (const m of ch.milestones) msToProj.current.set(m.id, m.projectId);
      for (const p of ch.projects) projToSol.current.set(p.id, p.solutionId);
      // Collect this delta's completions and group them by container card (milestone/
      // project/solution). Each completion also carries the rect of ITS OWN row (when the
      // task list is visible) - for a scatter from real positions; null when the row is not visible.
      const groups = new Map<
        string,
        { anchorRect: DOMRect | null; rows: (DOMRect | null)[] }
      >();
      for (const t of ch.tasks) {
        const prev = taskStatus.current.get(t.id);
        if (isTerminal(t.status) && !isTerminal(prev)) {
          const a = groupAnchor(t.milestoneId);
          const key = a.id ?? "center";
          const g = groups.get(key);
          if (g) g.rows.push(rectFor(t.id));
          else groups.set(key, { anchorRect: a.rect, rows: [rectFor(t.id)] });
        }
        taskStatus.current.set(t.id, t.status);
      }
      // Per group: 1-3 completions -> separate "+1" in a fan (stagger + spread,
      // from real rows when visible), 4+ -> a single aggregate "+N" from the container card.
      // The HUD count comes from the server anyway, so the emit does not double-count.
      for (const { anchorRect, rows } of groups.values()) {
        const n = rows.length;
        if (n >= 4) {
          flyPlusOne({ kind: "task", tier: "task", sourceRect: anchorRect, count: n });
        } else {
          const mid = (n - 1) / 2;
          for (let i = 0; i < n; i++) {
            const d = i - mid;
            flyPlusOne({
              kind: "task",
              tier: "task",
              sourceRect: rows[i] ?? anchorRect,
              delay: i * 120,
              offset: { x: d * 56, y: -Math.abs(d) * 26 },
            });
          }
        }
      }

      // 2) MILESTONES / PROJECTS / SOLUTIONS - by diffing the completedIds sets
      const d = await api.getDashboard();
      const ci = d.completedIds;

      // Milestones: same rule as tasks (1-3 fan, 4+ "+N"), but with a BASE
      // delay - a milestone completes AFTER its task, so its "+1" flies a moment
      // later (scattered relative to the task's green "+1" so they don't overlap).
      const freshMs = newIds(doneMs.current, ci.milestones);
      doneMs.current = new Set(ci.milestones);
      // The base offset (sideways + below the center) MOVES the milestone "+1" away from
      // the task "+1", which culminates dead center - otherwise they overlap pixel for pixel.
      if (freshMs.length >= 4) {
        flyPlusOne({
          kind: "milestone",
          tier: "milestone",
          sourceRect: rectFor(freshMs[0]),
          count: freshMs.length,
          delay: 280,
          offset: { x: 84, y: 16 },
        });
      } else {
        const center = (freshMs.length - 1) / 2;
        freshMs.forEach((id, i) => {
          const d = i - center;
          flyPlusOne({
            kind: "milestone",
            tier: "milestone",
            sourceRect: rectFor(id),
            delay: 280 + i * 130,
            offset: { x: 84 + d * 56, y: 16 - Math.abs(d) * 26 },
          });
        });
      }

      const freshProjects = newIds(doneProj.current, ci.projects);
      doneProj.current = new Set(ci.projects);
      const freshSolutions = newIds(doneSol.current, ci.solutions);
      doneSol.current = new Set(ci.solutions);

      // Queue a full-screen "YOU WIN" per freshly completed project/solution.
      const newWins: WinItem[] = [
        ...freshProjects.map(() => ({ id: ++winSeq.current, tier: "project" as const })),
        ...freshSolutions.map(() => ({ id: ++winSeq.current, tier: "solution" as const })),
      ];
      if (newWins.length > 0) setWins((q) => [...q, ...newWins]);
    } catch {
      // transient error (e.g. UI rebuild) - the next SSE will try again
    }
  }, [seed, groupAnchor]);

  // Serializing wrapper: when onChange is already running, mark pending and exit;
  // after it finishes, run once more (without concurrent mixing in the refs).
  const onChange = useCallback(async () => {
    if (running.current) {
      pending.current = true;
      return;
    }
    running.current = true;
    try {
      await runOnce();
      while (pending.current) {
        pending.current = false;
        await runOnce();
      }
    } finally {
      running.current = false;
    }
  }, [runOnce]);

  useEffect(() => {
    seed();
  }, [seed]);
  useLiveRefresh(() => {
    onChange();
  });

  const currentWin = wins[0] ?? null;

  return (
    <>
      {currentWin && (
        <WinOverlay
          key={currentWin.id}
          tier={currentWin.tier}
          count={1}
          onClose={() => {
            setWins((q) => q.slice(1));
            // after a project closes, "+1" flies to the project counter
            if (currentWin.tier === "project") {
              flyPlusOne({ kind: "project", tier: "project", sourceRect: null });
            }
          }}
        />
      )}
    </>
  );
}
