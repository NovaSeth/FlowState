/**
 * Sample data seed for Flow State.
 *
 * Run via `npm run seed` (i.e. `tsx scripts/seed.ts`). tsx resolves the `@/`
 * alias and TypeScript, so we use normal module imports.
 *
 * The script is idempotent - it clears all tables on startup, so it can be run
 * repeatedly without accumulating duplicates. It opens exactly the same database
 * as the app (FS_DB_PATH, or data/fs.db by default).
 */
import { Repo } from "@/lib/repo";
import { createDatabase } from "@/lib/db";
import type {
  ProjectStatus,
  TaskPriority,
  TaskStatus,
} from "@/lib/types";

const db = createDatabase(process.env.FS_DB_PATH ?? "data/fs.db");
const repo = new Repo(db);

// --- RESET: clear up the hierarchy (children -> parents), idempotently. ---
function reset() {
  // Order is not critical with ON DELETE CASCADE, but we explicitly clear all
  // tables so the script behaves the same regardless of the database state.
  // `activity` has no FK and does NOT cascade - without this the audit log grows
  // after every seed (createTask writes activity rows). task_deps/task_labels
  // cascade from tasks; actors/api_keys are not created by the seed.
  for (const table of [
    "activity",
    "comments",
    "tasks",
    "milestones",
    "projects",
    "solutions",
  ]) {
    db.exec(`DELETE FROM ${table};`);
  }
  console.log("Reset: deleted all rows (activity, comments, tasks, milestones, projects, solutions).");
}

// Helper types for a readable description of the seed data.
type TaskSeed = {
  title: string;
  description?: string;
  status: TaskStatus;
  priority: TaskPriority;
  milestone: string; // milestone name within the project
  comments?: { author: string; body: string }[];
};

type ProjectSeed = {
  name: string;
  description: string;
  status: ProjectStatus;
  extraMilestones: string[]; // real stages besides the "Backlog" created by the seed
  tasks: TaskSeed[];
};

type SolutionSeed = {
  name: string;
  description: string;
  color: string;
  projects: ProjectSeed[];
};

// --- Sample data - theme: tracking multiple Claude Code projects. ---
const DATA: SolutionSeed[] = [
  {
    name: "Acme Internal",
    description: "Internal team tools and experiments.",
    color: "#7C3AED",
    projects: [
      {
        name: "Flow State - v1",
        description: "API-first dashboard for tracking Claude Code project progress.",
        status: "active",
        extraMilestones: ["MVP", "Release 1.0"],
        tasks: [
          {
            title: "Design the database schema in node:sqlite",
            description: "Client/project/milestone/task/comment tables with cascade.",
            status: "done",
            priority: "high",
            milestone: "MVP",
            comments: [
              { author: "claude-code", body: "Schema is ready, cascading delete works." },
            ],
          },
          {
            title: "Write the repository layer",
            description: "Typed CRUD methods plus progress rollups.",
            status: "done",
            priority: "high",
            milestone: "MVP",
          },
          {
            title: "Add test coverage for the repo",
            description: "Vitest for validation, idempotency, and bulk create.",
            status: "in_progress",
            priority: "medium",
            milestone: "MVP",
            comments: [
              { author: "alex", body: "Add a test for cascading delete too." },
            ],
          },
          {
            title: "REST route handlers in src/app/api",
            description: "Map repo methods to /api endpoints.",
            status: "in_progress",
            priority: "urgent",
            milestone: "MVP",
          },
          {
            title: "Add API input validation",
            description: "Return 422 for bad enums and missing fields.",
            status: "todo",
            priority: "high",
            milestone: "MVP",
          },
          {
            title: "Overview screen with progress bars",
            description: "Project rollup table plus a blocked/urgent feed.",
            status: "todo",
            priority: "medium",
            milestone: "Release 1.0",
          },
          {
            title: "Dark mode based on Primer tokens",
            description: "CSS vars mapped to the Tailwind v4 theme.",
            status: "todo",
            priority: "low",
            milestone: "Release 1.0",
          },
          {
            title: "Fix the race in dashboard refresh",
            description: "Concurrent tasks overwrite the status counter.",
            status: "blocked",
            priority: "urgent",
            milestone: "Backlog",
            comments: [
              { author: "claude-code", body: "Waiting on a decision whether we use transactions." },
            ],
          },
        ],
      },
      {
        name: "Acme - topology dashboard",
        description: "Service topology visualization in the Acme visual language.",
        status: "active",
        extraMilestones: ["Stabilization"],
        tasks: [
          {
            title: "Render the service node graph",
            status: "done",
            priority: "medium",
            milestone: "Backlog",
          },
          {
            title: "Status pills on nodes",
            status: "done",
            priority: "low",
            milestone: "Backlog",
          },
          {
            title: "Slide-out node drill-down panel",
            description: "Details and metrics when a node is clicked.",
            status: "in_progress",
            priority: "medium",
            milestone: "Stabilization",
          },
          {
            title: "Fix flicker on zoom",
            status: "blocked",
            priority: "high",
            milestone: "Stabilization",
            comments: [
              { author: "claude-code", body: "Re-render issue with the zoom debounce." },
            ],
          },
          {
            title: "Export the view to PNG",
            status: "todo",
            priority: "none",
            milestone: "Stabilization",
          },
        ],
      },
    ],
  },
  {
    name: "Client Alpha",
    description: "Commercial client - backend migrations and refactors.",
    color: "#2563EB",
    projects: [
      {
        name: "Globex - API refactor",
        description: "Refactor the CMS API monolith into modular handlers.",
        status: "active",
        extraMilestones: ["MVP", "Stabilization"],
        tasks: [
          {
            title: "Extract the service layer out of the controllers",
            status: "done",
            priority: "high",
            milestone: "MVP",
          },
          {
            title: "Standardize the API error format",
            description: "A common shape for 4xx/5xx responses.",
            status: "done",
            priority: "medium",
            milestone: "MVP",
          },
          {
            title: "Add API input validation",
            description: "Input schemas at the handler boundary.",
            status: "in_progress",
            priority: "high",
            milestone: "MVP",
            comments: [
              { author: "claude-code", body: "Done for 6 of 9 endpoints." },
            ],
          },
          {
            title: "Migrate from REST to batch queries",
            status: "blocked",
            priority: "urgent",
            milestone: "Stabilization",
            comments: [
              { author: "alex", body: "Blocked until the client approves the contract." },
            ],
          },
          {
            title: "Test coverage for the service layer",
            status: "todo",
            priority: "medium",
            milestone: "Stabilization",
          },
          {
            title: "OpenAPI documentation",
            status: "todo",
            priority: "low",
            milestone: "Backlog",
          },
        ],
      },
      {
        name: "Initech - data import",
        description: "Pipeline for importing geo data into the Initech database.",
        status: "paused",
        extraMilestones: ["MVP"],
        tasks: [
          {
            title: "GeoJSON file parser",
            status: "done",
            priority: "medium",
            milestone: "MVP",
          },
          {
            title: "Fix the race in SSE",
            description: "The import progress stream drops events on large files.",
            status: "blocked",
            priority: "high",
            milestone: "MVP",
            comments: [
              { author: "claude-code", body: "The event buffer overflows at 50k records." },
            ],
          },
          {
            title: "Validate coordinate bounds",
            status: "todo",
            priority: "medium",
            milestone: "Backlog",
          },
          {
            title: "Resume an interrupted import",
            status: "todo",
            priority: "low",
            milestone: "Backlog",
          },
        ],
      },
    ],
  },
  {
    name: "Open Source",
    description: "Open source projects maintained in spare time.",
    color: "#16A34A",
    projects: [
      {
        name: "tsx-config-loader",
        description: "TS config loader for CLI tools.",
        status: "done",
        extraMilestones: ["Release 1.0"],
        tasks: [
          {
            title: "Support aliases from tsconfig paths",
            status: "done",
            priority: "medium",
            milestone: "Release 1.0",
          },
          {
            title: "Tests on Windows and Linux",
            status: "done",
            priority: "low",
            milestone: "Release 1.0",
          },
          {
            title: "Publish version 1.0 to npm",
            status: "done",
            priority: "high",
            milestone: "Release 1.0",
            comments: [
              { author: "alex", body: "Released, tag 1.0.0 on npm." },
            ],
          },
          {
            title: "Write a README with examples",
            status: "done",
            priority: "low",
            milestone: "Backlog",
          },
        ],
      },
    ],
  },
];

function seed() {
  const counts = {
    solutions: 0,
    projects: 0,
    milestones: 0,
    tasks: 0,
    comments: 0,
  };

  for (const c of DATA) {
    const solution = repo.createSolution({
      name: c.name,
      description: c.description,
      color: c.color,
    });
    counts.solutions++;

    for (const p of c.projects) {
      const project = repo.createProject({
        solutionId: solution.id,
        name: p.name,
        description: p.description,
        status: p.status,
      });
      counts.projects++;

      // The project starts with no milestones - we create them explicitly. The
      // first is "Backlog" (a container for tasks not yet assigned to a specific
      // stage), followed by the real stages from extraMilestones.
      const milestoneIds = new Map<string, string>();
      const backlog = repo.createMilestone({
        projectId: project.id,
        title: "Backlog",
        position: 0,
      });
      milestoneIds.set(backlog.title, backlog.id);
      counts.milestones++;
      for (const title of p.extraMilestones) {
        const ms = repo.createMilestone({ projectId: project.id, title });
        milestoneIds.set(ms.title, ms.id);
        counts.milestones++;
      }

      for (const t of p.tasks) {
        const milestoneId = milestoneIds.get(t.milestone);
        if (!milestoneId) {
          throw new Error(
            `Missing milestone "${t.milestone}" in project "${p.name}".`,
          );
        }
        const task = repo.createTask({
          milestoneId,
          title: t.title,
          description: t.description,
          status: t.status,
          priority: t.priority,
        });
        counts.tasks++;

        for (const cm of t.comments ?? []) {
          repo.createComment(task.id, { author: cm.author, body: cm.body });
          counts.comments++;
        }
      }
    }
  }

  return counts;
}

function run() {
  try {
    // Run reset + inserts in a single transaction so a failure rolls back
    // instead of leaving a half-seeded database. We go through repo.transaction
    // (not a raw BEGIN) because the repo's create* methods open their own
    // re-entrant transactions; this keeps the nesting guard correct so they run
    // inside this one transaction instead of issuing a nested BEGIN.
    const counts = repo.transaction(() => {
      reset();
      return seed();
    });

    console.log("");
    console.log("Seed complete. Created:");
    console.log(`  solutions:   ${counts.solutions}`);
    console.log(`  projects:    ${counts.projects}`);
    console.log(`  milestones:  ${counts.milestones}`);
    console.log(`  tasks:       ${counts.tasks}`);
    console.log(`  comments:    ${counts.comments}`);
    console.log("");
    console.log("Now run `npm run dev` -> http://localhost:3000");
  } catch (err) {
    console.error(
      "Seed failed:",
      err instanceof Error ? err.message : err,
    );
    process.exit(1);
  } finally {
    db.close();
  }
}

run();
