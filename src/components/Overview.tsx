"use client";

import { useState } from "react";
import { DashboardPayload } from "@/lib/types";
import { api } from "@/lib/api";
import { useLiveRefresh } from "@/lib/use-live-refresh";
import {
  AttentionFeed,
  RecentFeed,
  SolutionBlock,
  StatTile,
} from "./dashboard";
import { Eyebrow } from "./ui";
import { DailyChart } from "./DailyChart";
import { useT } from "@/i18n/provider";

/**
 * Overview screen (home). Shared memory for the human and the agent: what NEEDS
 * attention (blocked + urgent across all projects), what RECENTLY happened (timeline),
 * and an index of solutions with their progress. Live via SSE - every mutation
 * (agent or UI) refreshes the payload. Every row is a <Link>, so the screen is
 * navigable even without hydration (important for iOS under next dev).
 */
export function Overview({ initial }: { initial: DashboardPayload }) {
  const [d, setD] = useState(initial);
  const t = useT();
  useLiveRefresh(() => {
    api.getDashboard().then(setD).catch(() => {});
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-5 py-6 sm:px-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatTile
          label={t("overview.solutions")}
          value={d.totals.solutions}
          prev={d.totalsPrev?.solutions}
        />
        <StatTile
          label={t("overview.projects")}
          value={d.totals.projects}
          prev={d.totalsPrev?.projects}
        />
        <StatTile
          label={t("overview.milestones")}
          value={d.totals.milestones}
          prev={d.totalsPrev?.milestones}
        />
        <StatTile
          label={t("overview.tasks")}
          value={d.totals.tasks}
          prev={d.totalsPrev?.tasks}
        />
        <StatTile
          label={t("overview.completed")}
          value={d.progress.percent}
          suffix="%"
          accent
          prev={d.totalsPrev?.percent}
        />
      </div>

      <section className="space-y-3">
        <Eyebrow>{t("overview.dailyChartTitle")}</Eyebrow>
        <DailyChart data={d.dailyByStatus} />
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <AttentionFeed tasks={d.attention} />
        <RecentFeed tasks={d.recent} />
      </div>

      <section className="space-y-3">
        <Eyebrow>{t("overview.solutions")}</Eyebrow>
        <div className="grid items-start gap-4 lg:grid-cols-2">
          {d.solutions.map((s) => (
            <SolutionBlock key={s.id} solution={s} />
          ))}
        </div>
      </section>
    </div>
  );
}
