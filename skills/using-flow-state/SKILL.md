---
name: using-flow-state
description: Use when working on a project tracked in Flow State - to see what is left to do, read the user's feedback, and report progress through the fs_* MCP tools instead of MD files (TODO.md, roadmaps). Trigger when starting/planning a task or recording done/blocked work.
---

# Working with Flow State (via the fs_* MCP)

Flow State is a LIVE store of project state. Instead of keeping a task list
in MD files, you read and write state through the `fs_*` MCP tools (a server
named `flow-state`). Flow State is the source of truth about progress.

## When to use
- At the start of work/planning: check what is left to do and what is blocking you.
- During work: update task statuses, add new tasks, record notes.
- When you want the user's feedback: read the comments on tasks.

## Requirement
The Flow State app must be running (default http://localhost:3000;
`npm run dev` in the FlowState repo). When it is down, the `fs_*` tools
return a connection error - tell the user about it instead of guessing the state.

## Hierarchy and fields
Solution -> Project -> Milestone -> Task -> Comment.
- Task.status: `todo | in_progress | blocked | done | closed`. Only `done` counts
  as completed; `closed` = out of scope/cancelled (drops out of the progress denominator).
- Task.priority: `none | low | medium | high | urgent`.
- Task.verified (bool): "done, but not verified" (e.g. code waiting for a test on
  hardware). Orthogonal to status - it does NOT change the progress %. Set `verified: true`
  instead of keeping a separate validation task.
- Task.blockerType: `dependency | external | decision` - the kind of blocker (meaningful when
  status=blocked). Provide it together with `reason`. Resets to null when leaving blocked.
- Milestone.outcome: `shipped | infeasible | descoped` - the OUTCOME of the deliverable,
  independent of task %. 100% done != delivered (e.g. it turned out to be infeasible ->
  `outcome: "infeasible"`). Set it via fs_update_milestone.
- Project / Milestone.status: `active | paused | done | archived`.

## Typical flow
1. Get your bearings:
   - `fs_dashboard` - an overview of everything (solutions, projects, progress, blocked/urgent), or
   - `fs_list_solutions` -> `fs_list_projects({ solutionId })` -> `fs_list_milestones({ projectId })`.
   - Match the project to the repo you are working in (by name).
2. What is still left to do:
   - `fs_list_tasks({ projectId, status: "todo" })`, and also `status: "blocked"` and `"in_progress"`.
   - `solutionId` in the filter covers all projects in the solution (e.g. all blocked at once).
   - `fs_search_tasks({ q })` - global full-text over title+description (instead of listing per project).
3. User feedback:
   - `fs_get_task({ taskId, expandComments: true })` or `fs_list_comments({ taskId })`.
4. Report progress (instead of writing to MD):
   - starting a task: `fs_update_task({ taskId, status: "in_progress" })`,
   - finished: `fs_update_task({ taskId, status: "done" })`,
   - stuck: `fs_update_task({ taskId, status: "blocked", reason: "..." })` - `reason` is REQUIRED
     (the API returns 422 without a reason and without an existing comment); it is saved as a comment,
   - new work: `fs_create_task({ milestoneId, title, description, status, priority })`
     with a stable `clientRequestId` (e.g. a slug of the title) so a retry does not duplicate it;
     bulk: `fs_create_task({ tasks: [...] })` creates several at once.
   - bulk update: `fs_update_task({ updates: [{ taskId, status }, ...] })` changes
     many tasks in a single, atomic call (e.g. archiving N); likewise
     `fs_update_milestone({ updates: [...] })`.
5. Progress notes: `fs_add_comment({ taskId, body, author: "claude-code" })`.

## First-class fields instead of prose
Do not put these things into the description/comment - they have dedicated fields:
- Artifacts (work products): `fs_update_task({ taskId, artifacts: [{ kind:"commit",
  value:"<hash>", label:"description" }] })`. kind: `commit | pr | file | url`. The UI links
  only http(s); the rest is shown as text. Replaces the whole set.
- Links between tasks: `blockedBy: [taskId]` (a hard dependency - it must be
  done) or `relatedTo: [taskId]` (a soft, symmetric link). Instead of listing ids
  in the description.
- "Only mine, recently changed": `fs_whoami` -> actor.id, then
  `fs_list_tasks({ ownerActorId: <id> })`; combined with fs_changes_since it gives
  "what of my things has changed".

## MCP errors
The fs_* tools return a concise, structured error message (e.g.
`FS 422: <reason>`). When you see "server returned a non-JSON error ... try
again" - a UI rebuild is in progress in dev; retry shortly (it is not an error in your input).

## Identity (multi-agent)
Your key (the MCP server's `FS_API_KEY`) attributes authorship of mutations (audit log,
task owner). `fs_whoami` = who you are; `fs_list_activity` = who changed what;
when spinning up sub-agents, mint them keys with
`fs_mint_agent_key({ actorName, ttlSeconds, solutionId, scope })` and pass them in their
`FS_API_KEY`. Narrow the grant with `solutionId` (a solution-scoped key is ENFORCED: it can
read/write ONLY that solution, anything else returns 403) and `scope` (`read | write`); set
`ttlSeconds` so the key expires after the work. Delegation cannot widen permissions: a child
key cannot exceed its parent's scope, solution, or lifetime. Keys and the audit log are
visible in the UI at `/users`.

## Creating and editing (structure via MCP)
The dashboard (UI) is live (SSE) and lets a human manually change
status/priority, add comments, and delete. But ALL structure
(solutions/projects/milestones) and tasks are created and changed via the MCP -
you, as an agent, work exclusively through fs_*:
- create: `fs_create_solution` / `fs_create_project` / `fs_create_milestone` / `fs_create_task`,
- edit: `fs_update_solution` / `fs_update_project` / `fs_update_milestone` / `fs_update_task`.
Creating a project does NOT create any milestone - the project starts empty, so after
`fs_create_project` set up the first milestone via `fs_create_milestone`.
You change Project.status via `fs_update_project` (active|paused|done|archived).

A milestone describes a CONCRETE problem to solve (a deliverable) with the tasks that
realize it - it is not a catch-all bag. The title = what this stage delivers
("REST API with task CRUD", "dashboard with a status filter"), not a generic
"Backlog" / "Todo" / "Other". If you find yourself with a junk-drawer milestone, break it
into the actual stages.

## Rules
- Do not duplicate state into MD files - Flow State is the source of truth.
- Before creating a task, check `fs_list_tasks` so you do not multiply duplicates.
- Short, concrete titles; the description = context. No em-dashes or emoji in the content.
- A status change is a single `fs_update_task` call - do it as you go, because the dashboard is live.
