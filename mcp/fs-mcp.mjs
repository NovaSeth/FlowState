#!/usr/bin/env node
/*
 * MCP server (stdio, zero dependencies) for Flow State.
 *
 * Lets any Claude Code instance read and write project state through the
 * Flow State REST API - instead of keeping it in MD files.
 * Protocol: JSON-RPC 2.0, one JSON object per line (MCP stdio transport).
 *
 * Configuration via env:
 *   FS_BASE_URL  - base URL of the app (default http://localhost:3000)
 *   FS_API_KEY   - optional key; when Flow State requires it, sent as the x-api-key header
 *
 * Stdout is used EXCLUSIVELY for JSON-RPC; logs go to stderr.
 */

import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

const BASE = (process.env.FS_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const API_KEY = process.env.FS_API_KEY || "";
const SERVER_NAME = "flow-state";
const SERVER_VERSION = "1.7.0";

const INSTRUCTIONS = [
  "Flow State is a live store of Claude Code project state.",
  "Use these tools (fs_*) to track work INSTEAD OF MD files (TODO.md, roadmaps):",
  "- start by checking state: fs_dashboard or fs_list_tasks with status=todo/in_progress/blocked (filter by solutionId/projectId/milestoneId) to see what is still left to do,",
  "- looking for a specific task? fs_search_tasks(q=...) instead of listing per project and grepping in your head,",
  "- at the start of a turn / before a mutation, call fs_changes_since(since=<serverTime from the previous call>) to see what the user or another agent changed manually between your calls (MCP does not push notifications),",
  "- read user feedback: fs_list_comments / fs_get_task with expandComments=true,",
  "- report progress: fs_update_task (status change), add new tasks with fs_create_task (also accepts a `tasks` array - bulk), comment with fs_add_comment.",
  "- when setting status=blocked, PROVIDE a reason (what unblocks it) - otherwise the API rejects it (422), unless the task already has a comment.",
  "- identity (multi-agent): your key (FS_API_KEY) attributes authorship of mutations. fs_whoami = who you are; fs_list_activity = who changed what; when spawning sub-agents, mint them keys with fs_mint_agent_key (with ttlSeconds) and pass them in their FS_API_KEY.",
  "- task structure: parentTaskId creates subtasks (the parent closes automatically once all subtasks are done; progress in fs_get_task), blockedBy: [taskId] are dependencies instead of writing them in the description, labels (e.g. external-blocker/needs-physical/code-only) classify - filter by them with fs_list_tasks({label}).",
  "The dashboard (UI) is live (SSE) and lets you manually change status/priority, add comments, and delete;",
  "but you create and change the structure (solutions/projects/milestones) and tasks through these tools (fs_create_* / fs_update_*).",
  "Hierarchy: Solution -> Project -> Milestone -> Task -> Comment. Task status:",
  "todo|in_progress|blocked|done|closed (closed = out of scope/cancelled, drops out of the progress denominator). Priority: none|low|medium|high|urgent.",
].join("\n");

// --- REST client ---

/**
 * Shapes an HTTP response into a tool result or throws a CLEAN error.
 * KEY POINT: when the server returns non-JSON (e.g. the `next dev` error overlay
 * HTML during a rebuild / UI compile error), we do NOT pour the whole page +
 * stacktrace into the agent's context - we give a concise, actionable message.
 * Exported for tests.
 */
export function interpretResponse({ ok, status, statusText, text, contentType }) {
  let data = null;
  let parsed = false;
  if (text) {
    try {
      data = JSON.parse(text);
      parsed = true;
    } catch {
      parsed = false;
    }
  }
  if (!ok) {
    let msg;
    if (parsed && data && typeof data === "object" && data.error) {
      msg = data.error;
    } else if (parsed && typeof data === "string" && data) {
      msg = data;
    } else if (status >= 500) {
      msg =
        "server returned a non-JSON error (likely a UI rebuild or compile error in `next dev`) - try again in a moment";
    } else {
      msg = statusText || `unexpected response (${contentType || "no content-type"})`;
    }
    const err = new Error(`FS ${status}: ${msg}`);
    err.fsStatus = status;
    throw err;
  }
  if (!parsed && text) {
    // 2xx, but the body is not JSON - again, we do not return HTML as data.
    throw new Error(
      `FS ${status}: expected JSON, got non-JSON (${contentType || "no content-type"})`,
    );
  }
  return data; // null for an empty body (e.g. 204)
}

async function fsFetch(path, init = {}) {
  const headers = { "content-type": "application/json", ...(init.headers || {}) };
  if (API_KEY) headers["x-api-key"] = API_KEY;
  let res;
  try {
    res = await fetch(BASE + path, { ...init, headers });
  } catch (e) {
    throw new Error(
      `No connection to Flow State (${BASE}). Start the app (npm run dev). Detail: ${e.message}`,
    );
  }
  const text = await res.text();
  return interpretResponse({
    ok: res.ok,
    status: res.status,
    statusText: res.statusText,
    text,
    contentType: res.headers.get("content-type") || "",
  });
}

const qs = (params) => {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
};

// --- tool definitions ---

const TASK_STATUS = ["todo", "in_progress", "blocked", "done", "closed"];
const TASK_PRIORITY = ["none", "low", "medium", "high", "urgent"];
const PROJECT_STATUS = ["active", "paused", "done", "archived"];
const MILESTONE_STATUS = PROJECT_STATUS; // milestone like a project
const SOLUTION_STATUS = ["active", "archived"];
const BLOCKER_TYPE = ["dependency", "external", "decision"];
const ARTIFACT_KIND = ["commit", "pr", "file", "url"];
const MILESTONE_OUTCOME = ["shipped", "infeasible", "descoped"];
const ARTIFACT_ITEM = {
  type: "object",
  properties: {
    kind: { type: "string", enum: ARTIFACT_KIND, description: "Kind (default url)." },
    value: { type: "string", description: "Value: commit hash / PR URL / file path / URL." },
    label: { type: "string", description: "Optional label." },
  },
  required: ["value"],
};

// Allowed PATCH fields (allowlist) - SHARED between the single and bulk paths,
// so they cannot drift apart (bulk must not let arbitrary fields through - mass assignment).
const TASK_PATCH_KEYS = [
  "status", "priority", "title", "description", "milestoneId",
  "reason", "reasonAuthor", "parentTaskId", "blockedBy", "relatedTo",
  "labels", "verified", "blockerType", "artifacts", "ownerActorId", "position",
];
// Allowed CREATE fields (allowlist) - applied to each element of the bulk
// `tasks` array, mirroring how TASK_PATCH_KEYS guards the update paths, so
// server-trusted/unknown fields cannot be mass-assigned on creation.
const TASK_CREATE_KEYS = [
  "milestoneId", "title", "description", "status", "priority", "clientRequestId",
  "parentTaskId", "blockedBy", "relatedTo", "labels", "verified", "blockerType",
  "artifacts",
];
const MILESTONE_PATCH_KEYS = ["title", "description", "status", "position", "outcome"];

/** Builds a patch object from `src` limited to `keys` (skips undefined). */
function pickPatch(src, keys) {
  const out = {};
  for (const k of keys) if (src[k] !== undefined) out[k] = src[k];
  return out;
}

const TOOLS = [
  {
    name: "fs_dashboard",
    description:
      "Full overview: all solutions with their projects and progress, the global status breakdown, blocked/urgent tasks (what needs attention), and recent activity. Start here to see the whole state.",
    inputSchema: { type: "object", properties: {} },
    run: () => fsFetch("/api/dashboard"),
  },
  {
    name: "fs_changes_since",
    description:
      "Raw delta: entities (solutions, projects, milestones, tasks, comments) modified (updatedAt) or created (comments: createdAt) AFTER the given `since`. Use it at the start of a turn to see what the user or another agent changed manually in the dashboard between your calls. First turn with no state: call without `since` (full snapshot + `serverTime`); subsequent calls: pass `serverTime` from the previous response as the new `since`. Invalid / empty `since` = full snapshot from the epoch.",
    inputSchema: {
      type: "object",
      properties: {
        since: {
          type: "string",
          description:
            "ISO 8601 timestamp (e.g. 2026-05-28T15:42:11.000Z). Empty / omitted = full snapshot.",
        },
      },
    },
    run: (a) => fsFetch("/api/changes" + qs({ since: a.since })),
  },
  {
    name: "fs_list_solutions",
    description: "List solutions (top-level containers) with a progress rollup.",
    inputSchema: { type: "object", properties: {} },
    run: () => fsFetch("/api/solutions"),
  },
  {
    name: "fs_list_projects",
    description: "List projects, optionally limited to one solution.",
    inputSchema: {
      type: "object",
      properties: { solutionId: { type: "string" } },
    },
    run: (a) => fsFetch("/api/projects" + qs({ solutionId: a.solutionId })),
  },
  {
    name: "fs_list_milestones",
    description: "List a project's milestones (with progress).",
    inputSchema: {
      type: "object",
      properties: { projectId: { type: "string" } },
      required: ["projectId"],
    },
    run: (a) => fsFetch("/api/milestones" + qs({ projectId: a.projectId })),
  },
  {
    name: "fs_list_tasks",
    description:
      "List tasks with filters. Use status=todo|in_progress|blocked to see what is STILL left to do. Filter per milestoneId, projectId OR solutionId (e.g. all blocked tasks across an entire solution at once).",
    inputSchema: {
      type: "object",
      properties: {
        solutionId: { type: "string" },
        projectId: { type: "string" },
        milestoneId: { type: "string" },
        status: { type: "string", enum: TASK_STATUS },
        priority: { type: "string", enum: TASK_PRIORITY },
        parentTaskId: { type: "string", description: "Only subtasks of the given parent." },
        label: { type: "string", description: "Only tasks with this label." },
        ownerActorId: {
          type: "string",
          description:
            "Only tasks of the given owner. 'Only mine': first fs_whoami -> actor.id, then pass it here.",
        },
      },
    },
    run: (a) =>
      fsFetch(
        "/api/tasks" +
          qs({
            solutionId: a.solutionId,
            projectId: a.projectId,
            milestoneId: a.milestoneId,
            status: a.status,
            priority: a.priority,
            parentTaskId: a.parentTaskId,
            label: a.label,
            ownerActorId: a.ownerActorId,
          }),
      ),
  },
  {
    name: "fs_search_tasks",
    description:
      "Global full-text search (over title and description, case-insensitive) across all tasks. Optionally narrow to one solution. Returns tasks with context (solution/project/milestone) - instead of listing per project and grepping in your head.",
    inputSchema: {
      type: "object",
      properties: {
        q: { type: "string", description: "Search text (non-empty)." },
        solutionId: { type: "string", description: "Optional narrowing to a solution." },
      },
      required: ["q"],
    },
    run: (a) =>
      fsFetch("/api/tasks/search" + qs({ q: a.q, solutionId: a.solutionId })),
  },
  {
    name: "fs_get_task",
    description:
      "Fetch a single task with its dependencies (blockedBy), subtasks (children), and subtask progress (childProgress). With expandComments=true it attaches comments (user feedback) in one call.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string" },
        expandComments: { type: "boolean" },
      },
      required: ["taskId"],
    },
    run: (a) => {
      if (!a.taskId) throw new Error("taskId is required");
      return fsFetch(
        `/api/tasks/${encodeURIComponent(a.taskId)}` +
          (a.expandComments ? "?expand=comments" : ""),
      );
    },
  },
  {
    name: "fs_create_solution",
    description: "Create a new solution (top-level container, e.g. a product or a client).",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        description: { type: "string" },
        color: { type: "string", description: "hex, e.g. #0969da" },
      },
      required: ["name"],
    },
    run: (a) =>
      fsFetch("/api/solutions", {
        method: "POST",
        body: JSON.stringify({ name: a.name, description: a.description, color: a.color }),
      }),
  },
  {
    name: "fs_create_project",
    description:
      "Create a project in a solution. A project starts with NO milestones - you create a milestone separately via fs_create_milestone, and it should describe a concrete problem/deliverable (not a catch-all bucket like 'Backlog').",
    inputSchema: {
      type: "object",
      properties: {
        solutionId: { type: "string" },
        name: { type: "string" },
        description: { type: "string" },
        status: { type: "string", enum: PROJECT_STATUS },
      },
      required: ["solutionId", "name"],
    },
    run: (a) =>
      fsFetch("/api/projects", {
        method: "POST",
        body: JSON.stringify({
          solutionId: a.solutionId,
          name: a.name,
          description: a.description,
          status: a.status,
        }),
      }),
  },
  {
    name: "fs_create_milestone",
    description: "Create a milestone in a project.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        title: { type: "string" },
        description: { type: "string" },
        position: { type: "number" },
        outcome: {
          type: "string",
          enum: MILESTONE_OUTCOME,
          description:
            "Deliverable outcome, independent of task %: shipped|infeasible|descoped.",
        },
      },
      required: ["projectId", "title"],
    },
    run: (a) =>
      fsFetch("/api/milestones", {
        method: "POST",
        body: JSON.stringify({
          projectId: a.projectId,
          title: a.title,
          description: a.description,
          position: a.position,
          outcome: a.outcome,
        }),
      }),
  },
  {
    name: "fs_create_task",
    description:
      "Create a task (or several at once). Provide individual fields for a single task OR a `tasks` array for bulk (several tasks in one call). Provide clientRequestId (a stable key) to avoid duplicates on retry.",
    inputSchema: {
      type: "object",
      properties: {
        milestoneId: { type: "string" },
        title: { type: "string" },
        description: { type: "string" },
        status: { type: "string", enum: TASK_STATUS },
        priority: { type: "string", enum: TASK_PRIORITY },
        clientRequestId: { type: "string" },
        parentTaskId: { type: "string", description: "Parent task (subtask)." },
        blockedBy: {
          type: "array",
          items: { type: "string" },
          description: "Ids of blocking tasks (they must be done before this one).",
        },
        relatedTo: {
          type: "array",
          items: { type: "string" },
          description: "Ids of related tasks (soft, no blocking) - first-class cross-links.",
        },
        labels: {
          type: "array",
          items: { type: "string" },
          description: "Labels (e.g. external-blocker, needs-physical, code-only).",
        },
        verified: {
          type: "boolean",
          description: "'Done, unverified' - a flag orthogonal to status (does not change progress %).",
        },
        blockerType: {
          type: "string",
          enum: BLOCKER_TYPE,
          description: "Blocker type (when status=blocked): dependency|external|decision.",
        },
        artifacts: {
          type: "array",
          items: ARTIFACT_ITEM,
          description: "Artifacts: commit hash / PR / file path / URL (instead of pasting into a comment).",
        },
        tasks: {
          type: "array",
          description:
            "Bulk: an array of tasks (each with fields as above). When provided, the individual fields are ignored.",
          items: {
            type: "object",
            properties: {
              milestoneId: { type: "string" },
              title: { type: "string" },
              description: { type: "string" },
              status: { type: "string", enum: TASK_STATUS },
              priority: { type: "string", enum: TASK_PRIORITY },
              clientRequestId: { type: "string" },
              parentTaskId: { type: "string" },
              blockedBy: { type: "array", items: { type: "string" } },
              relatedTo: { type: "array", items: { type: "string" } },
              labels: { type: "array", items: { type: "string" } },
              verified: { type: "boolean" },
              blockerType: { type: "string", enum: BLOCKER_TYPE },
              artifacts: { type: "array", items: ARTIFACT_ITEM },
            },
            required: ["milestoneId", "title"],
          },
        },
      },
    },
    run: (a) => {
      const body = Array.isArray(a.tasks)
        ? // Allowlist each bulk element (as the single path does below) - so
          // server-trusted/unknown fields cannot be mass-assigned.
          a.tasks.map((t) => pickPatch(t, TASK_CREATE_KEYS))
        : pickPatch(
            {
              milestoneId: a.milestoneId,
              title: a.title,
              description: a.description,
              status: a.status,
              priority: a.priority,
              clientRequestId: a.clientRequestId,
              parentTaskId: a.parentTaskId,
              blockedBy: a.blockedBy,
              relatedTo: a.relatedTo,
              labels: a.labels,
              verified: a.verified,
              blockerType: a.blockerType,
              artifacts: a.artifacts,
            },
            TASK_CREATE_KEYS,
          );
      return fsFetch("/api/tasks", {
        method: "POST",
        body: JSON.stringify(body),
      });
    },
  },
  {
    name: "fs_update_task",
    description:
      "Update a task - partially. Most often a status change in one call. Bulk: provide `updates` (an array of {taskId|id, ...patch}) to change many at once atomically (e.g. archiving). NOTE: setting status=blocked requires a `reason` field (saved as a comment), unless the task already has a comment - otherwise 422.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string" },
        status: { type: "string", enum: TASK_STATUS },
        priority: { type: "string", enum: TASK_PRIORITY },
        title: { type: "string" },
        description: { type: "string" },
        milestoneId: { type: "string" },
        reason: {
          type: "string",
          description:
            "Reason when status=blocked - what should unblock it. Saved as a comment.",
        },
        reasonAuthor: { type: "string", description: "Author of the reason comment (optional)." },
        parentTaskId: { type: "string", description: "Change the parent (subtask)." },
        blockedBy: {
          type: "array",
          items: { type: "string" },
          description: "Replaces the set of dependencies (ids of blocking tasks).",
        },
        relatedTo: {
          type: "array",
          items: { type: "string" },
          description: "Replaces the set of soft links (relatedTo).",
        },
        labels: {
          type: "array",
          items: { type: "string" },
          description: "Replaces the set of labels.",
        },
        verified: {
          type: "boolean",
          description: "'Done, unverified' (e.g. code waiting on a hardware test). Does not change progress %.",
        },
        blockerType: {
          type: "string",
          enum: BLOCKER_TYPE,
          description: "Blocker type (when status=blocked): dependency|external|decision. '' clears it.",
        },
        artifacts: {
          type: "array",
          items: ARTIFACT_ITEM,
          description: "Replaces the set of artifacts (commit/PR/file/URL).",
        },
        ownerActorId: {
          type: "string",
          description: "Assign an owner (actorId). Empty string '' = remove (unclaim).",
        },
        position: { type: "number", description: "Position (sort order)." },
        updates: {
          type: "array",
          description:
            "Bulk: an array of {taskId|id, ...patch}. When provided, the remaining fields are ignored; the change is atomic (all-or-nothing).",
          items: { type: "object" },
        },
      },
      required: [],
    },
    run: (a) => {
      if (Array.isArray(a.updates)) {
        // Allowlist in bulk too (as in the single path) - without letting
        // arbitrary fields through (mass assignment).
        const arr = a.updates.map((u) => {
          const id = u.taskId ?? u.id;
          if (typeof id !== "string" || !id)
            throw new Error("Every `updates` item must have a string taskId");
          return { id, ...pickPatch(u, TASK_PATCH_KEYS) };
        });
        return fsFetch("/api/tasks", { method: "PATCH", body: JSON.stringify(arr) });
      }
      if (!a.taskId) throw new Error("taskId is required when not using bulk updates");
      return fsFetch(`/api/tasks/${encodeURIComponent(a.taskId)}`, {
        method: "PATCH",
        body: JSON.stringify(pickPatch(a, TASK_PATCH_KEYS)),
      });
    },
  },
  {
    name: "fs_update_solution",
    description:
      "Update a solution (partially): name, description, color (hex), status (active|archived - 'archived' = closed).",
    inputSchema: {
      type: "object",
      properties: {
        solutionId: { type: "string" },
        name: { type: "string" },
        description: { type: "string" },
        color: { type: "string" },
        status: { type: "string", enum: SOLUTION_STATUS },
      },
      required: ["solutionId"],
    },
    run: (a) => {
      if (!a.solutionId) throw new Error("solutionId is required");
      const body = {};
      for (const k of ["name", "description", "color", "status"])
        if (a[k] !== undefined) body[k] = a[k];
      return fsFetch(`/api/solutions/${encodeURIComponent(a.solutionId)}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
    },
  },
  {
    name: "fs_update_project",
    description:
      "Update a project (partially): name, description, status (active|paused|done|archived).",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        name: { type: "string" },
        description: { type: "string" },
        status: { type: "string", enum: PROJECT_STATUS },
      },
      required: ["projectId"],
    },
    run: (a) => {
      if (!a.projectId) throw new Error("projectId is required");
      const body = {};
      for (const k of ["name", "description", "status"])
        if (a[k] !== undefined) body[k] = a[k];
      return fsFetch(`/api/projects/${encodeURIComponent(a.projectId)}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
    },
  },
  {
    name: "fs_update_milestone",
    description:
      "Update a milestone (partially): title, description, position, status (active|paused|done|archived), outcome (deliverable outcome: shipped|infeasible|descoped, '' clears it). Bulk: provide `updates` (an array of {milestoneId|id, ...patch}) to change many at once atomically.",
    inputSchema: {
      type: "object",
      properties: {
        milestoneId: { type: "string" },
        title: { type: "string" },
        description: { type: "string" },
        status: { type: "string", enum: MILESTONE_STATUS },
        position: { type: "number" },
        outcome: {
          type: "string",
          enum: MILESTONE_OUTCOME,
          description:
            "Deliverable outcome, independent of task %: shipped|infeasible|descoped.",
        },
        updates: {
          type: "array",
          description:
            "Bulk: an array of {milestoneId|id, ...patch}. When provided, the remaining fields are ignored; the change is atomic.",
          items: { type: "object" },
        },
      },
      required: [],
    },
    run: (a) => {
      if (Array.isArray(a.updates)) {
        // Allowlist in bulk too (as in the single path) - no mass assignment.
        const arr = a.updates.map((u) => {
          const id = u.milestoneId ?? u.id;
          if (typeof id !== "string" || !id)
            throw new Error("Every `updates` item must have a string milestoneId");
          return { id, ...pickPatch(u, MILESTONE_PATCH_KEYS) };
        });
        return fsFetch("/api/milestones", { method: "PATCH", body: JSON.stringify(arr) });
      }
      if (!a.milestoneId) throw new Error("milestoneId is required when not using bulk updates");
      return fsFetch(`/api/milestones/${encodeURIComponent(a.milestoneId)}`, {
        method: "PATCH",
        body: JSON.stringify(pickPatch(a, MILESTONE_PATCH_KEYS)),
      });
    },
  },
  {
    name: "fs_add_comment",
    description:
      "Add a comment to a task (e.g. a progress note). The author is usually the agent name, e.g. 'claude-code'.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string" },
        body: { type: "string" },
        author: { type: "string" },
      },
      required: ["taskId", "body"],
    },
    run: (a) => {
      if (!a.taskId) throw new Error("taskId is required");
      return fsFetch(`/api/tasks/${encodeURIComponent(a.taskId)}/comments`, {
        method: "POST",
        body: JSON.stringify({ body: a.body, author: a.author || "claude-code" }),
      });
    },
  },
  {
    name: "fs_list_comments",
    description: "List a task's comments - user feedback and the history of notes.",
    inputSchema: {
      type: "object",
      properties: { taskId: { type: "string" } },
      required: ["taskId"],
    },
    run: (a) => {
      if (!a.taskId) throw new Error("taskId is required");
      return fsFetch(`/api/tasks/${encodeURIComponent(a.taskId)}/comments`);
    },
  },
  {
    name: "fs_whoami",
    description:
      "Who am I according to the key (FS_API_KEY) - returns the actor (human/agent) assigned to the key, or null (anonymous/admin). Use it to confirm your identity in a multi-agent setup.",
    inputSchema: { type: "object", properties: {} },
    run: () => fsFetch("/api/me"),
  },
  {
    name: "fs_list_actors",
    description:
      "List actors (humans with UI access + agents). Shows who exists in the system and who minted whom (createdByKeyId).",
    inputSchema: { type: "object", properties: {} },
    run: () => fsFetch("/api/actors"),
  },
  {
    name: "fs_mint_agent_key",
    description:
      "Mint an API key for a sub-agent (delegation). Creates a new 'agent' actor with the given name and returns a token (shown ONCE) to pass to the sub-agent in its FS_API_KEY. Narrow it with `solutionId` and `scope`, set `ttlSeconds` (e.g. 7200 = 2h) so the key expires after the work. The parent (your key) is recorded as createdByKeyId.",
    inputSchema: {
      type: "object",
      properties: {
        actorName: { type: "string", description: "Sub-agent name (e.g. 'voice-eval-worker')." },
        solutionId: { type: "string", description: "Optional narrowing to a solution." },
        scope: { type: "string", enum: ["read", "write"] },
        ttlSeconds: { type: "number", description: "Key lifetime in seconds (e.g. 7200)." },
        name: { type: "string", description: "Key label (optional)." },
      },
      required: ["actorName"],
    },
    run: (a) =>
      fsFetch("/api/keys", {
        method: "POST",
        body: JSON.stringify({
          actorName: a.actorName,
          solutionId: a.solutionId,
          scope: a.scope,
          ttlSeconds: a.ttlSeconds,
          name: a.name,
        }),
      }),
  },
  {
    name: "fs_list_keys",
    description:
      "List API keys (without the secret). Filter by actorId or solutionId. Shows the prefix, scope, solution, expiry, lastUsedAt, and revokedAt - who has access and with what.",
    inputSchema: {
      type: "object",
      properties: {
        actorId: { type: "string" },
        solutionId: { type: "string" },
      },
    },
    run: (a) =>
      fsFetch("/api/keys" + qs({ actorId: a.actorId, solutionId: a.solutionId })),
  },
  {
    name: "fs_revoke_key",
    description:
      "Revoke an API key by id (key_...). The key stops working. Authorization as in the API: your own key / the delegation parent / the owning actor / admin.",
    inputSchema: {
      type: "object",
      properties: { keyId: { type: "string" } },
      required: ["keyId"],
    },
    run: (a) => {
      if (!a.keyId) throw new Error("keyId is required");
      return fsFetch(`/api/keys/${encodeURIComponent(a.keyId)}`, { method: "DELETE" });
    },
  },
  {
    name: "fs_list_activity",
    description:
      "Audit log: who changed what and when (newest first). Filter by solutionId or entityId (e.g. a specific task). In a multi-agent setup it shows which actor actually touched the state.",
    inputSchema: {
      type: "object",
      properties: {
        solutionId: { type: "string" },
        entityId: { type: "string" },
        limit: { type: "number" },
      },
    },
    run: (a) =>
      fsFetch("/api/activity" + qs({ solutionId: a.solutionId, entityId: a.entityId, limit: a.limit })),
  },
];

const TOOL_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

// Exported for tests: look up a tool's `run` by name (so input-guard behavior,
// e.g. "missing taskId throws", is assertable without a live server).
export function getToolRun(name) {
  const tool = TOOL_BY_NAME.get(name);
  return tool ? tool.run : undefined;
}

// --- JSON-RPC loop over stdio ---

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}
function reply(id, result) {
  send({ jsonrpc: "2.0", id, result });
}
function replyError(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

async function handle(msg) {
  const { id, method, params } = msg;
  const isRequest = id !== undefined && id !== null;

  switch (method) {
    case "initialize":
      reply(id, {
        protocolVersion: params?.protocolVersion || "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        instructions: INSTRUCTIONS,
      });
      return;
    case "tools/list":
      reply(id, {
        tools: TOOLS.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      });
      return;
    case "tools/call": {
      const tool = TOOL_BY_NAME.get(params?.name);
      if (!tool) {
        replyError(id, -32602, `Unknown tool: ${params?.name}`);
        return;
      }
      try {
        const data = await tool.run(params?.arguments || {});
        reply(id, {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        });
      } catch (e) {
        // tool-level error (not a protocol error) - return isError
        reply(id, {
          content: [{ type: "text", text: `Error: ${e.message}` }],
          isError: true,
        });
      }
      return;
    }
    case "resources/list":
      if (isRequest) reply(id, { resources: [] });
      return;
    case "prompts/list":
      if (isRequest) reply(id, { prompts: [] });
      return;
    case "ping":
      if (isRequest) reply(id, {});
      return;
    default:
      // notifications (no id, e.g. notifications/initialized) are ignored;
      // unknown requests -> method not found
      if (isRequest) replyError(id, -32601, `Unknown method: ${method}`);
  }
}

function main() {
  const rl = createInterface({ input: process.stdin });
  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
      return;
    }
    handle(msg).catch((e) => {
      console.error("[fs-mcp] handler error:", e);
      if (msg && msg.id !== undefined && msg.id !== null) {
        replyError(msg.id, -32603, `Internal error: ${e.message}`);
      }
    });
  });
  console.error(`[fs-mcp] ready, BASE=${BASE}${API_KEY ? " (x-api-key)" : ""}`);
}

// Boot the server only when the file is run directly (node fs-mcp.mjs),
// not when imported from tests - otherwise readline on stdin would hold the test process.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
