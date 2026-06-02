/**
 * Example: an external Claude Code agent driving the Flow State REST API.
 *
 * Run via `tsx examples/agent-solution.ts` (assumes `npm run dev` is running on
 * http://localhost:3000). Uses the global `fetch` (Node 18+).
 *
 * Demonstrates the full agent flow: creating a solution and project, creating a
 * Backlog milestone, bulk-creating tasks with idempotency, changing status,
 * commenting, and reading the dashboard.
 */

const BASE_URL = process.env.FS_BASE_URL ?? "http://localhost:3000";
const API_KEY = process.env.FS_API_KEY;

/**
 * Thin fetch helper. Adds the X-API-Key header if FS_API_KEY is set (mutations
 * only require it when the server started with the same FS_API_KEY env var).
 */
async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };
  if (API_KEY) {
    headers["x-api-key"] = API_KEY;
  }
  const res = await fetch(`${BASE_URL}${path}`, { ...init, headers });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${init.method ?? "GET"} ${path} -> ${res.status}: ${text}`);
  }
  return (text ? JSON.parse(text) : undefined) as T;
}

async function main() {
  // 1. Create a solution (RootProject).
  const solution = await api<{ id: string; name: string }>("/api/solutions", {
    method: "POST",
    body: JSON.stringify({
      name: "Demo Agent Solution",
      description: "Created by examples/agent-solution.ts",
      color: "#0EA5E9",
    }),
  });
  console.log(`Solution created: ${solution.id} (${solution.name})`);

  // 2. Create a project under the solution. A new project has no milestones.
  const project = await api<{ id: string; name: string }>("/api/projects", {
    method: "POST",
    body: JSON.stringify({
      solutionId: solution.id,
      name: "Demo - agent flow",
      description: "Demo project driven via the REST API.",
      status: "active",
    }),
  });
  console.log(`Project created: ${project.id} (${project.name})`);

  // 3. Create a "Backlog" milestone for the tasks below.
  const backlog = await api<{ id: string; title: string }>("/api/milestones", {
    method: "POST",
    body: JSON.stringify({ projectId: project.id, title: "Backlog" }),
  });
  console.log(`Backlog milestone: ${backlog.id}`);

  // 4. Bulk-create tasks - POST /api/tasks accepts an array.
  //    The first task has a clientRequestId to demonstrate idempotency.
  const REQ_ID = "demo-req-import-api";
  const created = await api<{ id: string; title: string }[]>("/api/tasks", {
    method: "POST",
    body: JSON.stringify([
      {
        milestoneId: backlog.id,
        title: "Add API input validation",
        priority: "high",
        clientRequestId: REQ_ID,
      },
      {
        milestoneId: backlog.id,
        title: "Fix the race in SSE",
        status: "blocked",
        priority: "urgent",
      },
      {
        milestoneId: backlog.id,
        title: "Add test coverage for the repo",
        priority: "medium",
      },
    ]),
  });
  console.log(`Bulk: created ${created.length} tasks.`);
  const firstId = created[0].id;

  // Idempotency: the same clientRequestId returns the same task instead of a duplicate.
  const repeat = await api<{ id: string }[]>("/api/tasks", {
    method: "POST",
    body: JSON.stringify([
      {
        milestoneId: backlog.id,
        title: "Add API input validation (retry)",
        clientRequestId: REQ_ID,
      },
    ]),
  });
  console.log(
    `Idempotency: the retry returned id ${repeat[0].id} (expected ${firstId}) -> ` +
      (repeat[0].id === firstId ? "same task, no duplicate" : "ERROR: different ids"),
  );

  // 5. Change the task status to done with a single PATCH.
  const done = await api<{ id: string; status: string }>(
    `/api/tasks/${firstId}`,
    {
      method: "PATCH",
      body: JSON.stringify({ status: "done" }),
    },
  );
  console.log(`PATCH: task ${done.id} -> status ${done.status}`);

  // 6. Add a comment to the task (author = agent name).
  const comment = await api<{ id: string }>(
    `/api/tasks/${firstId}/comments`,
    {
      method: "POST",
      body: JSON.stringify({
        author: "claude-code",
        body: "Validation is ready, marking as done.",
      }),
    },
  );
  console.log(`Comment added: ${comment.id}`);

  // 7. Read the dashboard and print a one-line progress summary.
  const dash = await api<{
    totals: { solutions: number; projects: number; tasks: number };
    progress: { done: number; total: number; percent: number };
  }>("/api/dashboard");
  console.log(
    `Dashboard: ${dash.totals.solutions} solutions, ${dash.totals.projects} projects, ` +
      `${dash.totals.tasks} tasks -> progress ${dash.progress.done}/${dash.progress.total} (${dash.progress.percent}%)`,
  );
}

main().catch((err) => {
  console.error("Agent error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
