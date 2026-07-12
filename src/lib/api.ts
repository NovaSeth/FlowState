/* Thin REST client for browser components. Mutations go through the same API
 * that external Claude Code agents use (dogfooding). */
import type {
  Actor,
  Activity,
  ApiKey,
  ApiKeyWithSecret,
  AppSettingsPayload,
  Connection,
  ConnectionsPayload,
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

/** Optional dashboard key (Settings): required when the server runs in
 *  require-key mode; attached to every call when set. */
function dashboardKey(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem("fs.dashboardKey");
  } catch {
    return null;
  }
}

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const key = dashboardKey();
  const res = await fetch(url, {
    // x-fs-dashboard marks this as the local dashboard so the API trusts it
    // keyless even over plain HTTP/LAN (a phone), where Sec-Fetch-* is absent.
    headers: {
      "content-type": "application/json",
      "x-fs-dashboard": "1",
      ...(key ? { "x-api-key": key } : {}),
    },
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

const post = (body: unknown) =>
  ({ method: "POST", body: JSON.stringify(body) }) satisfies RequestInit;
const patch = (body: unknown) =>
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
  listProjects: (solutionId?: string) =>
    req<ProjectRollup[]>(
      solutionId ? `/api/projects?${qs({ solutionId })}` : "/api/projects",
    ),
  listMilestones: (projectId: string) =>
    req<MilestoneRollup[]>(`/api/milestones?${qs({ projectId })}`),
  listTasks: (milestoneId: string) =>
    req<TaskListItem[]>(`/api/tasks?${qs({ milestoneId })}`),

  createSolution: (b: CreateSolutionInput) =>
    req<Solution>("/api/solutions", post(b)),
  updateSolution: (id: string, b: UpdateSolutionInput) =>
    req<Solution>(`/api/solutions/${id}`, patch(b)),
  deleteSolution: (id: string) => req<void>(`/api/solutions/${id}`, del),

  createProject: (b: CreateProjectInput) =>
    req<Project>("/api/projects", post(b)),
  updateProject: (id: string, b: UpdateProjectInput) =>
    req<Project>(`/api/projects/${id}`, patch(b)),
  deleteProject: (id: string) => req<void>(`/api/projects/${id}`, del),

  createMilestone: (b: CreateMilestoneInput) =>
    req<Milestone>("/api/milestones", post(b)),
  updateMilestone: (id: string, b: UpdateMilestoneInput) =>
    req<Milestone>(`/api/milestones/${id}`, patch(b)),
  deleteMilestone: (id: string) => req<void>(`/api/milestones/${id}`, del),

  getTaskDetail: (id: string) => req<TaskDetail>(`/api/tasks/${id}`),
  createTask: (b: CreateTaskInput) => req<Task>("/api/tasks", post(b)),
  updateTask: (id: string, b: UpdateTaskInput) =>
    req<Task>(`/api/tasks/${id}`, patch(b)),
  deleteTask: (id: string) => req<void>(`/api/tasks/${id}`, del),

  listComments: (taskId: string) =>
    req<Comment[]>(`/api/tasks/${taskId}/comments`),
  createComment: (taskId: string, b: CreateCommentInput) =>
    req<Comment>(`/api/tasks/${taskId}/comments`, post(b)),

  // identity, keys, audit (Stream C)
  listActors: () => req<Actor[]>("/api/actors"),
  createActor: (b: CreateActorInput) => req<Actor>("/api/actors", post(b)),
  listApiKeys: (filter: { actorId?: string; solutionId?: string } = {}) =>
    req<ApiKey[]>(
      `/api/keys${Object.keys(filter).length ? `?${qs(filter as Record<string, string>)}` : ""}`,
    ),
  createApiKey: (b: CreateApiKeyInput) =>
    req<ApiKeyWithSecret>("/api/keys", post(b)),
  revokeApiKey: (id: string) => req<ApiKey>(`/api/keys/${id}`, del),
  /** Full token for the "show" reveal (null: key predates secret storage). */
  getKeySecret: (id: string) =>
    req<{ token: string | null }>(`/api/keys/${id}/secret`),
  // multi-instance connections + app settings
  listConnections: () => req<ConnectionsPayload>("/api/connections"),
  createConnection: (b: {
    name: string;
    host: string;
    port: number;
    apiKey?: string;
  }) => req<Connection>("/api/connections", post(b)),
  deleteConnection: (id: string) => req<void>(`/api/connections/${id}`, del),
  /** Switch the data source (null = back to local). Health-checked server-side. */
  setActiveConnection: (activeId: string | null) =>
    req<{ activeId: string | null }>("/api/connections", patch({ activeId })),
  getAppSettings: () => req<AppSettingsPayload>("/api/settings"),
  setRequireKey: (requireKey: boolean) =>
    req<AppSettingsPayload>("/api/settings", patch({ requireKey })),

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
