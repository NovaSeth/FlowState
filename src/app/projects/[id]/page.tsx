import { notFound } from "next/navigation";
import { repo } from "@/lib/repo";
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
  const r = repo();

  const project = r.getProjectRollup(id);
  if (!project) notFound();

  const solution = r.getSolution(project.solutionId);
  const milestones = r.listMilestones(id);
  const tasks = r.listTasks({ projectId: id });

  return (
    <>
      <ProjectView
        project={project}
        solution={solution}
        milestones={milestones}
        tasks={tasks}
        initialTaskId={task}
      />
      <LiveRefresher />
    </>
  );
}
