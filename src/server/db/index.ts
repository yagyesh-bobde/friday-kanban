/**
 * better-sqlite3 connection + schema.
 *
 * - DB file: ~/.friday-kanban/friday.db
 * - WAL mode, foreign keys on
 * - Schema created idempotently on open (CREATE TABLE IF NOT EXISTS)
 * - globalThis-cached so server.ts (tsx) and Next route handlers (separately
 *   compiled module graphs in the same process, re-evaluated by HMR) share
 *   exactly one connection.
 */

import Database from "better-sqlite3";
import { dbPath, ensureRuntimeDirs } from "@/server/paths";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  path              TEXT NOT NULL,
  base_branch       TEXT NOT NULL DEFAULT 'main',
  default_execution TEXT NOT NULL DEFAULT 'local' CHECK (default_execution IN ('local','cloud')),
  created_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id                TEXT PRIMARY KEY,
  project_id        TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title             TEXT NOT NULL,
  prompt            TEXT NOT NULL,
  context_paths     TEXT NOT NULL DEFAULT '[]',  -- JSON string[]
  scope_paths       TEXT NOT NULL DEFAULT '[]',  -- JSON string[] of glob/path patterns this task may touch
  branch            TEXT NOT NULL,
  workspace_mode    TEXT NOT NULL DEFAULT 'branch' CHECK (workspace_mode IN ('branch','worktree','new-branch')),
  board_column      TEXT NOT NULL DEFAULT 'todo' CHECK (board_column IN ('todo','in_dev','in_review','done')),
  run_state         TEXT NOT NULL DEFAULT 'idle' CHECK (run_state IN ('idle','queued','running','needs_attention','error')),
  execution         TEXT NOT NULL DEFAULT 'local' CHECK (execution IN ('local','cloud')),
  model_overrides   TEXT,                        -- JSON Partial<Record<'in_dev'|'in_review', ModelSpec>> | NULL
  worktree          TEXT,                        -- JSON WorktreeInfo | NULL
  claude_session_id TEXT,
  codex_thread_id   TEXT,
  remote_session_id TEXT,
  review_cycle      INTEGER NOT NULL DEFAULT 0,
  commit_shas       TEXT NOT NULL DEFAULT '[]',  -- JSON string[]
  pr_url            TEXT,
  cost_usd          REAL NOT NULL DEFAULT 0,
  error             TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_column ON tasks(board_column);
CREATE INDEX IF NOT EXISTS idx_tasks_project_branch ON tasks(project_id, branch);

CREATE TABLE IF NOT EXISTS task_events (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  type    TEXT NOT NULL,
  at      TEXT NOT NULL,
  payload TEXT                                    -- JSON | NULL
);
CREATE INDEX IF NOT EXISTS idx_task_events_task ON task_events(task_id, id);

CREATE TABLE IF NOT EXISTS agent_runs (
  id              TEXT PRIMARY KEY,
  task_id         TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('implementer','reviewer','summarizer')),
  spec            TEXT NOT NULL,                  -- JSON ModelSpec
  argv            TEXT NOT NULL,                  -- JSON string[]
  pid             INTEGER,
  started_at      TEXT NOT NULL,
  ended_at        TEXT,
  exit_code       INTEGER,
  cost_usd        REAL,
  usage           TEXT,                           -- JSON AgentRunUsage | NULL
  transcript_path TEXT NOT NULL,
  review_cycle    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_agent_runs_task ON agent_runs(task_id, started_at);

CREATE TABLE IF NOT EXISTS branch_prs (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  branch     TEXT NOT NULL,
  pr_url     TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (project_id, branch)
);

CREATE TABLE IF NOT EXISTS status_reports (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  date            TEXT NOT NULL,                  -- YYYY-MM-DD
  summary         TEXT NOT NULL,
  commit_count    INTEGER NOT NULL DEFAULT 0,
  prs_merged      INTEGER NOT NULL DEFAULT 0,
  tasks_completed INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL,
  UNIQUE (project_id, date)
);

CREATE TABLE IF NOT EXISTS config (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL                             -- JSON
);

-- Free-form user messages addressed to a task (mid-task chat). A message sent
-- to a RUNNING task interrupts the live agent; the pipeline drains unconsumed
-- messages at the next boundary and resumes the session with them as a
-- human directive (fix round).
CREATE TABLE IF NOT EXISTS task_messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id     TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  message     TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  consumed_at TEXT                                -- NULL until drained by the pipeline
);
CREATE INDEX IF NOT EXISTS idx_task_messages_pending ON task_messages(task_id, consumed_at, id);
`;

/**
 * Additive migrations for DBs created before a column existed. CREATE TABLE IF
 * NOT EXISTS never alters an existing table, so new columns are added here,
 * each guarded against the "duplicate column" error so this stays idempotent.
 */
function migrate(db: Database.Database): void {
  const columnExists = (table: string, column: string): boolean => {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    return cols.some((c) => c.name === column);
  };
  if (!columnExists("tasks", "scope_paths")) {
    db.exec(`ALTER TABLE tasks ADD COLUMN scope_paths TEXT NOT NULL DEFAULT '[]'`);
  }
}

function openDb(): Database.Database {
  ensureRuntimeDirs();
  const db = new Database(dbPath());
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

const GLOBAL_KEY = "__fridayKanbanDb" as const;

type GlobalWithDb = typeof globalThis & {
  [GLOBAL_KEY]?: Database.Database;
};

/** The one shared connection. Always go through this — never `new Database()`. */
export function getDb(): Database.Database {
  const g = globalThis as GlobalWithDb;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = openDb();
  }
  return g[GLOBAL_KEY];
}

/** Current timestamp in ISO 8601 — the canonical time format in the DB. */
export function nowIso(): string {
  return new Date().toISOString();
}
