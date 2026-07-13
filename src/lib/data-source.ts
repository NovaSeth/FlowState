import { repo } from "./repo";
import { getActiveConnection, remoteBase, type ConnectionWithKey } from "./connections";
import type {
  Actor,
  ApiKey,
  DashboardPayload,
  MilestoneRollup,
  ProjectRollup,
  Solution,
  SolutionRollup,
  Task,
} from "./types";

/* Read-side data source for the SERVER-RENDERED pages: the local repo by
 * default, or - when a remote connection is active - the remote instance over
 * the same REST payloads the API serves. Client components need none of this:
 * they call /api/*, which http.ts proxies transparently. */

async function remoteGet<T>(c: ConnectionWithKey, path: string): Promise<T> {
  const res = await fetch(`${remoteBase(c)}${path}`, {
    headers: c.apiKey ? { "x-api-key": c.apiKey } : undefined,
    cache: "no-store",
    // Never follow a redirect from the remote - it could point this server-side
    // read at an internal URL (SSRF). A genuine remote never redirects /api.
    redirect: "error",
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    throw new Error(`Remote Flow State: ${res.status} on ${path}`);
  }
  return (await res.json()) as T;
}

export async function getDashboard(): Promise<DashboardPayload> {
  const c = getActiveConnection();
  return c ? remoteGet<DashboardPayload>(c, "/api/dashboard") : repo().getDashboard();
}

export async function listSolutions(): Promise<SolutionRollup[]> {
  const c = getActiveConnection();
  return c ? remoteGet<SolutionRollup[]>(c, "/api/solutions") : repo().listSolutions();
}

/** Everything the /projects/[id] page needs; null when the project is gone. */
export async function projectPageData(id: string): Promise<{
  project: ProjectRollup;
  solution: Solution | null;
  milestones: MilestoneRollup[];
  tasks: Task[];
} | null> {
  const c = getActiveConnection();
  if (!c) {
    const r = repo();
    const project = r.getProjectRollup(id);
    if (!project) return null;
    return {
      project,
      solution: r.getSolution(project.solutionId),
      milestones: r.listMilestones(id),
      tasks: r.listTasks({ projectId: id }),
    };
  }
  // The remote REST surface has list endpoints only - fetch and pick.
  const projects = await remoteGet<ProjectRollup[]>(c, "/api/projects");
  const project = projects.find((p) => p.id === id);
  if (!project) return null;
  const [solutions, milestones, tasks] = await Promise.all([
    remoteGet<SolutionRollup[]>(c, "/api/solutions"),
    remoteGet<MilestoneRollup[]>(c, `/api/milestones?projectId=${encodeURIComponent(id)}`),
    remoteGet<Task[]>(c, `/api/tasks?projectId=${encodeURIComponent(id)}`),
  ]);
  return {
    project,
    solution: solutions.find((s) => s.id === project.solutionId) ?? null,
    milestones,
    tasks,
  };
}

/** Everything the /solutions/[id] page needs; null when the solution is gone. */
export async function solutionPageData(id: string): Promise<{
  solution: SolutionRollup;
  projects: ProjectRollup[];
} | null> {
  const c = getActiveConnection();
  if (!c) {
    const solution = repo().getSolutionRollup(id);
    if (!solution) return null;
    return { solution, projects: repo().listProjects(id) };
  }
  const solutions = await remoteGet<SolutionRollup[]>(c, "/api/solutions");
  const solution = solutions.find((s) => s.id === id);
  if (!solution) return null;
  const projects = await remoteGet<ProjectRollup[]>(
    c,
    `/api/projects?solutionId=${encodeURIComponent(id)}`,
  );
  return { solution, projects };
}

/** First-paint data for the /users page. */
export async function usersPageData(): Promise<{
  actors: Actor[];
  keys: ApiKey[];
  solutions: SolutionRollup[];
  projects: ProjectRollup[];
}> {
  const c = getActiveConnection();
  if (!c) {
    const r = repo();
    return {
      actors: r.listActors(),
      keys: r.listApiKeys(),
      solutions: r.listSolutions(),
      projects: r.listProjects(),
    };
  }
  const [actors, keys, solutions, projects] = await Promise.all([
    remoteGet<Actor[]>(c, "/api/actors"),
    remoteGet<ApiKey[]>(c, "/api/keys"),
    remoteGet<SolutionRollup[]>(c, "/api/solutions"),
    remoteGet<ProjectRollup[]>(c, "/api/projects"),
  ]);
  return { actors, keys, solutions, projects };
}
