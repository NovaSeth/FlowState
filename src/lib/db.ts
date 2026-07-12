import type * as Sqlite from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

// node:sqlite is a new Node builtin - the Turbopack bundler doesn't handle it in
// the server-component bundle (it externalizes and calls require, which doesn't
// exist in ESM -> "require is not defined"). process.getBuiltinModule loads the
// builtin directly from the runtime, bypassing the bundler. The type comes from a
// type-only import.
const { DatabaseSync } = process.getBuiltinModule(
  "node:sqlite",
) as typeof Sqlite;
type DatabaseSync = Sqlite.DatabaseSync;

/** Schema - created idempotently on every connection open.
 * Cascading delete down the hierarchy (solution -> project -> milestone -> task -> comment). */
const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS solutions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  solutionId TEXT NOT NULL REFERENCES solutions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_projects_solution ON projects(solutionId);

CREATE TABLE IF NOT EXISTS milestones (
  id TEXT PRIMARY KEY,
  projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  position REAL NOT NULL DEFAULT 0,
  -- deliverable outcome, independent of task %: shipped|infeasible|descoped|null.
  -- 100% of tasks done != deliverable delivered (e.g. it turned out infeasible).
  outcome TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_milestones_project ON milestones(projectId);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  milestoneId TEXT NOT NULL REFERENCES milestones(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'todo',
  priority TEXT NOT NULL DEFAULT 'none',
  position REAL NOT NULL DEFAULT 0,
  clientRequestId TEXT,
  ownerActorId TEXT,
  parentTaskId TEXT,
  -- 'done-pending-verification': work done but not validated (e.g. code waiting
  -- for an on-device test). Does NOT affect progress % - it's an orthogonal flag.
  verified INTEGER NOT NULL DEFAULT 0,
  -- blocker type (meaningful when status='blocked'): dependency|external|decision.
  blockerType TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_milestone ON tasks(milestoneId);
-- idx_tasks_owner is created in migrate() (after the ownerActorId column is
-- guaranteed to exist), NOT here: on an old database (tasks already exists, so
-- IF NOT EXISTS skips CREATE TABLE) the ownerActorId column may not exist yet, so
-- the index in SCHEMA would fail.
CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_cri
  ON tasks(clientRequestId) WHERE clientRequestId IS NOT NULL;

-- updatedAt: for delta-sync (changesSince) and "recent" feeds (ORDER BY updatedAt).
CREATE INDEX IF NOT EXISTS idx_tasks_updated ON tasks(updatedAt);
CREATE INDEX IF NOT EXISTS idx_solutions_updated ON solutions(updatedAt);
CREATE INDEX IF NOT EXISTS idx_projects_updated ON projects(updatedAt);
CREATE INDEX IF NOT EXISTS idx_milestones_updated ON milestones(updatedAt);

CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  taskId TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  author TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  createdAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comments_task ON comments(taskId);

-- Dependencies between tasks (Stream B): a task is blocked by blockedByTaskId.
CREATE TABLE IF NOT EXISTS task_deps (
  taskId TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  blockedByTaskId TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  PRIMARY KEY (taskId, blockedByTaskId)
);
CREATE INDEX IF NOT EXISTS idx_deps_task ON task_deps(taskId);
CREATE INDEX IF NOT EXISTS idx_deps_blockedby ON task_deps(blockedByTaskId);

-- Task labels (Stream B): arbitrary tags (e.g. external-blocker, needs-physical).
CREATE TABLE IF NOT EXISTS task_labels (
  taskId TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  PRIMARY KEY (taskId, label)
);
CREATE INDEX IF NOT EXISTS idx_labels_task ON task_labels(taskId);
CREATE INDEX IF NOT EXISTS idx_labels_label ON task_labels(label);

-- Task artifacts: first-class references to work products (commit hash, PR/MR,
-- file path, any URL) - instead of pasting them into a comment body.
CREATE TABLE IF NOT EXISTS task_artifacts (
  id TEXT PRIMARY KEY,
  taskId TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'url',
  value TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  createdAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_artifacts_task ON task_artifacts(taskId);

-- Soft cross-links between tasks (relatedTo) - no blocking semantics (that's what
-- task_deps is for). Symmetric: we store one edge and read it both ways. The pair
-- is normalized (a<b) on write to avoid duplicates.
CREATE TABLE IF NOT EXISTS task_links (
  taskId TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  relatedTaskId TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  PRIMARY KEY (taskId, relatedTaskId)
);
CREATE INDEX IF NOT EXISTS idx_links_task ON task_links(taskId);
CREATE INDEX IF NOT EXISTS idx_links_related ON task_links(relatedTaskId);

-- Identity and auth (Stream C). Actor = human (UI) or agent (machine).
CREATE TABLE IF NOT EXISTS actors (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'agent',
  name TEXT NOT NULL,
  createdByKeyId TEXT,
  archivedAt TEXT,
  createdAt TEXT NOT NULL
);

-- API key: belongs to an actor, optionally scoped to a solution. The database
-- holds only the secret hash; the full token (prefix.secret) is shown once at creation.
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  actorId TEXT NOT NULL REFERENCES actors(id) ON DELETE CASCADE,
  solutionId TEXT REFERENCES solutions(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  prefix TEXT NOT NULL,
  secretHash TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'write',
  grants TEXT,
  expiresAt TEXT,
  createdByKeyId TEXT,
  lastUsedAt TEXT,
  revokedAt TEXT,
  createdAt TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_keys_prefix ON api_keys(prefix);
CREATE INDEX IF NOT EXISTS idx_keys_actor ON api_keys(actorId);

-- Audit log: who, what, when. A concise summary instead of full diffs.
CREATE TABLE IF NOT EXISTS activity (
  id TEXT PRIMARY KEY,
  actorId TEXT,
  entityType TEXT NOT NULL,
  entityId TEXT NOT NULL,
  action TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  solutionId TEXT,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activity_at ON activity(at);
CREATE INDEX IF NOT EXISTS idx_activity_entity ON activity(entityId);
CREATE INDEX IF NOT EXISTS idx_activity_solution ON activity(solutionId);
`;

/** True when `table` has a column named `column` (reads PRAGMA table_info live). */
function hasColumn(db: DatabaseSync, table: string, column: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as {
    name: string;
  }[];
  return cols.some((c) => c.name === column);
}

/** Additive migrations for existing databases (SQLite has no ADD COLUMN IF NOT EXISTS). */
function migrate(db: DatabaseSync): void {
  if (!hasColumn(db, "tasks", "ownerActorId")) {
    db.exec(`ALTER TABLE tasks ADD COLUMN ownerActorId TEXT`);
  }
  if (!hasColumn(db, "tasks", "parentTaskId")) {
    db.exec(`ALTER TABLE tasks ADD COLUMN parentTaskId TEXT`);
  }
  // The parentTaskId index is created here (after the column is guaranteed to
  // exist) - in SCHEMA it would fail on an existing database that lacks the column yet.
  db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parentTaskId)`);
  if (!hasColumn(db, "tasks", "verified")) {
    db.exec(`ALTER TABLE tasks ADD COLUMN verified INTEGER NOT NULL DEFAULT 0`);
  }
  if (!hasColumn(db, "tasks", "blockerType")) {
    db.exec(`ALTER TABLE tasks ADD COLUMN blockerType TEXT`);
  }
  // completedAt: timestamp of entering the 'done' status (for "TODAY" in the
  // scoreboard). Added in migrate (NOT in SCHEMA), because on a live database tasks
  // already exists and IF NOT EXISTS skips CREATE TABLE - the column would be
  // missing. Backfill: existing 'done' rows without completedAt get updatedAt (the
  // best available approximation).
  if (!hasColumn(db, "tasks", "completedAt")) {
    db.exec(`ALTER TABLE tasks ADD COLUMN completedAt TEXT`);
    db.exec(
      `UPDATE tasks SET completedAt = updatedAt WHERE status = 'done' AND completedAt IS NULL`,
    );
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_owner ON tasks(ownerActorId)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_completed ON tasks(completedAt)`);

  // outcome on milestones (deliverable outcome, independent of task %).
  if (!hasColumn(db, "milestones", "outcome")) {
    db.exec(`ALTER TABLE milestones ADD COLUMN outcome TEXT`);
  }

  // grants on api_keys: JSON list of {solutionId?|projectId?, scope} chosen at
  // creation. NULL on legacy keys - resolved from solutionId+scope at read time.
  if (!hasColumn(db, "api_keys", "grants")) {
    db.exec(`ALTER TABLE api_keys ADD COLUMN grants TEXT`);
  }

  // Plaintext token secret for the "show key" reveal in the Users panel - an
  // explicit product decision for this LOCAL single-user tool. Auth still
  // verifies against secretHash only; this column merely reconstructs the
  // token for display. Keys created before it stay NULL (unrecoverable).
  if (!hasColumn(db, "api_keys", "secret")) {
    db.exec(`ALTER TABLE api_keys ADD COLUMN secret TEXT`);
  }

  // New tables (artifacts, soft links) - on an existing database SCHEMA creates
  // them via IF NOT EXISTS, but we create them explicitly in case of an older file.
  db.exec(`
    CREATE TABLE IF NOT EXISTS task_artifacts (
      id TEXT PRIMARY KEY,
      taskId TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      kind TEXT NOT NULL DEFAULT 'url',
      value TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT '',
      createdAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_artifacts_task ON task_artifacts(taskId);
    CREATE TABLE IF NOT EXISTS task_links (
      taskId TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      relatedTaskId TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      PRIMARY KEY (taskId, relatedTaskId)
    );
    CREATE INDEX IF NOT EXISTS idx_links_task ON task_links(taskId);
    CREATE INDEX IF NOT EXISTS idx_links_related ON task_links(relatedTaskId);
  `);

  // status on solutions and milestones (active|archived / project lifecycle).
  if (!hasColumn(db, "solutions", "status")) {
    db.exec(
      `ALTER TABLE solutions ADD COLUMN status TEXT NOT NULL DEFAULT 'active'`,
    );
  }
  if (!hasColumn(db, "milestones", "status")) {
    db.exec(
      `ALTER TABLE milestones ADD COLUMN status TEXT NOT NULL DEFAULT 'active'`,
    );
  }
}

/** Opens a connection and sets up the schema. Use ":memory:" in tests. */
export function createDatabase(path: string): DatabaseSync {
  if (path !== ":memory:") {
    mkdirSync(dirname(resolve(path)), { recursive: true });
  }
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

// Singleton kept on globalThis to survive Next's hot-reload in dev.
const g = globalThis as unknown as { __fsDb?: DatabaseSync };

export function getDb(): DatabaseSync {
  if (!g.__fsDb) {
    const path = process.env.FS_DB_PATH ?? "data/fs.db";
    g.__fsDb = createDatabase(path);
  } else {
    // The connection survives Next's hot-reload (cached on globalThis), so new
    // additive migrations (e.g. tasks.completedAt) would NOT appear on the live
    // connection without a full server restart. migrate() is idempotent
    // (PRAGMA table_info + IF NOT EXISTS), so we can cheaply run it again to
    // pull in missing columns/indexes on the already-open connection.
    migrate(g.__fsDb);
  }
  return g.__fsDb;
}
