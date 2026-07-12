import Link from "next/link";
import { notFound } from "next/navigation";
import { solutionPageData } from "@/lib/data-source";
import { SolutionBlock } from "@/components/dashboard";
import { DeleteSolutionButton } from "@/components/SolutionActions";
import { LiveRefresher } from "@/components/LiveRefresher";
import { Icon } from "@/components/icons";
import { serverT } from "@/i18n/server";
import { solutionColor } from "@/lib/solution-color";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function SolutionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const data = await solutionPageData(id);
  if (!data) notFound();
  const { solution, projects } = data;
  // Server component: translation via serverT (reads the fs_locale cookie).
  const t = await serverT();

  return (
    <div className="mx-auto max-w-6xl space-y-5 px-6 py-6">
      <div>
        <nav className="flex items-center gap-1.5 font-mono text-[11px] text-fg-subtle">
          <Link href="/" className="hover:text-accent">
            {t("nav.overview")}
          </Link>
          <Icon name="chevron" size={11} />
          <span className="text-fg-muted">{solution.name}</span>
        </nav>
        <div className="mt-1.5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span
              className="inline-block h-3 w-3 shrink-0 rounded-full"
              style={{ backgroundColor: solutionColor(solution.id) }}
            />
            <h1 className="text-xl font-semibold tracking-tight text-fg">
              {solution.name}
            </h1>
            <span className="font-mono text-xs text-fg-subtle">
              {solution.progress.percent}% - {t("units.projShort", { n: solution.projectCount })}
            </span>
          </div>
          <DeleteSolutionButton id={solution.id} />
        </div>
        {solution.description && (
          <p className="mt-1 max-w-2xl text-sm text-fg-muted">
            {solution.description}
          </p>
        )}
      </div>

      {/* recentTasks empty: on the detail page what matters is the full project
          breakdown, while "recently" lives on the Overview screen. */}
      <SolutionBlock solution={{ ...solution, projects, recentTasks: [] }} />
      <LiveRefresher />
    </div>
  );
}
