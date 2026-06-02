/* Thin REST client for browser components. Mutations go through the same API
 * that external Claude Code agents use (dogfooding). */
import type {
  Actor,
  Activity,
  ApiKey,
  ApiKeyWithSecret,
  CreateActorInput,
  CreateApiKeyInput,
  Comment,
  CreateCommentInput,
  CreateMilestoneInput,
  CreateProjectInput,
  CreateSolutionInput,
  CreateTaskInput,
  ChangesSincePayload,
  DashboardPayload,
  Milestone,
  MilestoneRollup,
  Project,
  ProjectRollup,
  Solution,
  SolutionRollup,
  Task,
  TaskDetail,
  TaskListItem,
  UpdateMilestoneInput,
  UpdateProjectInput,
  UpdateSolutionInput,
  UpdateTaskInput,
} from "./types";

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { "content-type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(data?.error ?? `Error ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const post = (url: string, body: unknown) =>
  ({ method: "POST", body: JSON.stringify(body) }) satisfies RequestInit;
const patch = (url: string, body: unknown) =>
  ({ method: "PATCH", body: JSON.stringify(body) }) satisfies RequestInit;
const del = { method: "DELETE" } satisfies RequestInit;

// Skips undefined/null/empty values - intentionally identical behavior to the qs()
// in mcp/fs-mcp.mjs (kept in parity by hand because the two run in different runtimes
// and cannot share one module). Returns the bare query string (no leading "?").
const qs = (params: Record<string, string | number | null | undefined>) => {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") sp.set(k, String(v));
  }
  return sp.toString();
};

export const api = {
  // reads (the explorer cascade dogfoods the same API as the agents)
  getDashboard: () => req<DashboardPayload>("/api/dashboard"),
  changesSince: (since: string) =>
    req<ChangesSincePayload>(`/api/changes?${qs({ since })}`),
  listSolutions: () => req<SolutionRollup[]>("/api/solutions"),
  listProjects: (solutionId: string) =>
    req<ProjectRollup[]>(`/api/projects?${qs({ solutionId })}`),
  listMilestones: (projectId: string) =>
    req<MilestoneRollup[]>(`/api/milestones?${qs({ projectId })}`),
  listTasks: (milestoneId: string) =>
    req<TaskListItem[]>(`/api/tasks?${qs({ milestoneId })}`),

  createSolution: (b: CreateSolutionInput) =>
    req<Solution>("/api/solutions", post("", b)),
  updateSolution: (id: string, b: UpdateSolutionInput) =>
    req<Solution>(`/api/solutions/${id}`, patch("", b)),
  deleteSolution: (id: string) => req<void>(`/api/solutions/${id}`, del),

  createProject: (b: CreateProjectInput) =>
    req<Project>("/api/projects", post("", b)),
  updateProject: (id: string, b: UpdateProjectInput) =>
    req<Project>(`/api/projects/${id}`, patch("", b)),
  deleteProject: (id: string) => req<void>(`/api/projects/${id}`, del),

  createMilestone: (b: CreateMilestoneInput) =>
    req<Milestone>("/api/milestones", post("", b)),
  updateMilestone: (id: string, b: UpdateMilestoneInput) =>
    req<Milestone>(`/api/milestones/${id}`, patch("", b)),
  deleteMilestone: (id: string) => req<void>(`/api/milestones/${id}`, del),

  getTaskDetail: (id: string) => req<TaskDetail>(`/api/tasks/${id}`),
  createTask: (b: CreateTaskInput) => req<Task>("/api/tasks", post("", b)),
  updateTask: (id: string, b: UpdateTaskInput) =>
    req<Task>(`/api/tasks/${id}`, patch("", b)),
  deleteTask: (id: string) => req<void>(`/api/tasks/${id}`, del),

  listComments: (taskId: string) =>
    req<Comment[]>(`/api/tasks/${taskId}/comments`),
  createComment: (taskId: string, b: CreateCommentInput) =>
    req<Comment>(`/api/tasks/${taskId}/comments`, post("", b)),

  // identity, keys, audit (Stream C)
  listActors: () => req<Actor[]>("/api/actors"),
  createActor: (b: CreateActorInput) => req<Actor>("/api/actors", post("", b)),
  listApiKeys: (filter: { actorId?: string; solutionId?: string } = {}) =>
    req<ApiKey[]>(
      `/api/keys${Object.keys(filter).length ? `?${qs(filter as Record<string, string>)}` : ""}`,
    ),
  createApiKey: (b: CreateApiKeyInput) =>
    req<ApiKeyWithSecret>("/api/keys", post("", b)),
  revokeApiKey: (id: string) => req<ApiKey>(`/api/keys/${id}`, del),
  listActivity: (
    filter: {
      solutionId?: string;
      entityId?: string;
      actorId?: string;
      limit?: number;
    } = {},
  ) => {
    const p: Record<string, string> = {};
    if (filter.solutionId) p.solutionId = filter.solutionId;
    if (filter.entityId) p.entityId = filter.entityId;
    if (filter.actorId) p.actorId = filter.actorId;
    if (filter.limit) p.limit = String(filter.limit);
    return req<Activity[]>(`/api/activity${Object.keys(p).length ? `?${qs(p)}` : ""}`);
  },
};
