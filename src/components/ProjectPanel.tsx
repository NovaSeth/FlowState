"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { MilestoneRollup, ProjectRollup } from "@/lib/types";
import {
  MILESTONE_OUTCOME_META,
  PROJECT_STATUS_META,
  STATUS_META,
} from "@/lib/labels";
import { MetaPill, ProgressMeter } from "./ui";
import { Icon } from "./icons";
import { SidePanel } from "./SidePanel";
import { useLiveRefresh } from "@/lib/use-live-refresh";
import { useT } from "@/i18n/provider";

/* The project dashboard as an inspector drawer (opened from the Explorer's
   project kebab), behaving exactly like the task detail panel: name + status +
   progress, description, and stacked milestone cards. The full-width board
   stays on /projects/[id], linked from the footer. */

export function ProjectPanel({
  project,
  solutionName,
  onClose,
}: {
  project: ProjectRollup | null;
  solutionName?: string;
  onClose: () => void;
}) {
  const t = useT();
  return (
    <SidePanel
      open={project !== null}
      ariaLabel={t("project.eyebrow")}
      onClose={onClose}
      wide
    >
      {project && (
        <PanelBody
          key={project.id}
          project={project}
          solutionName={solutionName}
          onClose={onClose}
        />
      )}
    </SidePanel>
  );
}

function PanelBody({
  project,
  solutionName,
  onClose,
}: {
  project: ProjectRollup;
  solutionName?: string;
  onClose: () => void;
}) {
  const t = useT();
  const [milestones, setMilestones] = useState<MilestoneRollup[] | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .listMilestones(project.id)
      .then((m) => alive && setMilestones(m))
      .catch(() => alive && setMilestones([]));
    return () => {
      alive = false;
    };
  }, [project.id]);

  // The project rollup itself stays fresh via the Explorer's own live refetch
  // (the prop re-renders); the milestone list is this panel's private slice.
  useLiveRefresh(() => {
    api
      .listMilestones(project.id)
      .then(setMilestones)
      .catch(() => {});
  });

  return (
    <>
      {/* header */}
      <div className="flex items-start justify-between gap-2 border-b border-edge-muted px-4 py-3">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.5px] text-accent">
            {t("project.eyebrow")}
          </div>
          {solutionName && (
            <div className="mt-0.5 truncate font-mono text-[11px] text-fg-subtle">
              {solutionName}
            </div>
          )}
        </div>
        <button
          onClick={onClose}
          className="-mr-1 rounded-md p-2 text-fg-subtle transition-colors hover:bg-canvas-subtle hover:text-fg active:bg-canvas-subtle"
          aria-label={t("common.close")}
        >
          <Icon name="close" size={20} />
        </button>
      </div>

      <div data-sheet-scroll className="flex-1 overflow-y-auto px-4 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold text-fg">{project.name}</h2>
          <MetaPill meta={PROJECT_STATUS_META[project.status]} size="sm" />
        </div>
        <div className="mt-1 font-mono text-xs text-fg-subtle">
          {project.progress.done}/{project.progress.total}{" "}
          {t("project.tasks").toLowerCase()} - {project.progress.percent}%
        </div>
        <div className="mt-3">
          <ProgressMeter
            progress={project.progress}
            counts={project.statusCounts}
          />
        </div>

        {/* KPI row: the project's own headline figures (mini stat tiles). */}
        <div className="mt-4 grid grid-cols-3 gap-2">
          <PanelStat
            value={String(project.milestoneCount)}
            label={t("project.milestones")}
          />
          <PanelStat
            value={String(project.progress.total)}
            label={t("project.tasks")}
          />
          <PanelStat
            value={`${project.progress.percent}%`}
            label={t("overview.completed")}
            accent
          />
          <PanelStat
            value={String(project.statusCounts.in_progress)}
            label={t(STATUS_META.in_progress.labelKey)}
          />
          <PanelStat
            value={String(project.statusCounts.blocked)}
            label={t(STATUS_META.blocked.labelKey)}
            danger={project.statusCounts.blocked > 0}
          />
          <PanelStat
            value={String(project.statusCounts.done)}
            label={t(STATUS_META.done.labelKey)}
          />
        </div>

        {project.description && (
          <div className="mt-4 flex flex-col gap-1">
            <span className="text-[11px] uppercase tracking-[0.5px] text-fg-subtle">
              {t("entity.description")}
            </span>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-fg">
              {project.description}
            </p>
          </div>
        )}

        {/* milestones */}
        <div className="mt-5">
          <div className="mb-2 flex items-center gap-1.5 text-[11px] uppercase tracking-[0.5px] text-fg-subtle">
            <Icon name="milestone" size={14} />
            {t("project.milestones")}
            {milestones && <span className="font-mono">({milestones.length})</span>}
          </div>
          <div className="flex flex-col gap-2">
            {milestones === null ? (
              <p className="text-xs text-fg-subtle">
                {t("common.loadingEllipsis")}
              </p>
            ) : milestones.length === 0 ? (
              <p className="text-xs text-fg-subtle">
                {t("explorer.noMilestones")}
              </p>
            ) : (
              milestones.map((m) => <MilestoneCard key={m.id} m={m} />)
            )}
          </div>
        </div>
      </div>

      {/* footer: id + the full-width dashboard page */}
      <div className="flex items-center justify-between border-t border-edge-muted px-4 py-2.5">
        <span
          className="truncate font-mono text-[11px] text-fg-subtle"
          title={project.id}
        >
          {project.id}
        </span>
        <Link
          href={`/projects/${project.id}`}
          onClick={onClose}
          className="shrink-0 text-xs text-accent hover:underline"
        >
          {t("project.openFull")}
        </Link>
      </div>
    </>
  );
}

/** Compact stat tile for the panel's KPI row (a small Overview StatTile). */
function PanelStat({
  value,
  label,
  accent = false,
  danger = false,
}: {
  value: string;
  label: string;
  accent?: boolean;
  danger?: boolean;
}) {
  return (
    <div className="rounded-md border border-edge-muted bg-canvas-subtle px-2.5 py-2">
      <div
        className={`font-mono text-lg font-semibold tabular-nums ${
          danger ? "text-danger" : accent ? "text-accent" : "text-fg"
        }`}
      >
        {value}
      </div>
      <div className="text-[11px] text-fg-muted">{label}</div>
    </div>
  );
}

/** Stacked milestone card: title, outcome pill, done/total, progress meter. */
function MilestoneCard({ m }: { m: MilestoneRollup }) {
  return (
    <div
      className={`rounded-md border border-edge-muted bg-canvas-subtle px-3 py-2.5 ${
        m.status === "archived" ? "opacity-60" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 truncate text-sm font-medium text-fg">
          {m.title}
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          {m.outcome && <MetaPill meta={MILESTONE_OUTCOME_META[m.outcome]} />}
          <span className="font-mono text-[11px] text-fg-subtle">
            {m.progress.done}/{m.progress.total}
          </span>
        </span>
      </div>
      <div className="mt-2">
        <ProgressMeter progress={m.progress} counts={m.statusCounts} />
      </div>
    </div>
  );
}
