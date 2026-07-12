import { notFound } from "next/navigation";
import { projectPageData } from "@/lib/data-source";
import { ProjectView } from "@/components/ProjectView";
import { LiveRefresher } from "@/components/LiveRefresher";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ task?: string }>;
}) {
  const { id } = await params;
  const { task } = await searchParams;

  const data = await projectPageData(id);
  if (!data) notFound();

  return (
    <>
      <ProjectView
        project={data.project}
        solution={data.solution}
        milestones={data.milestones}
        tasks={data.tasks}
        initialTaskId={task}
      />
      <LiveRefresher />
    </>
  );
}
