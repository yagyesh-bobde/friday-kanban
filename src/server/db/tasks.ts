/**
 * Repository for `tasks` + `task_events`.
 *
 * The append-only `task_events` table is the source of truth; column/runState
 * (and the other pipeline fields) are derived but denormalized onto the task
 * row for queries. `appendEventAndUpdate` performs both writes in ONE sqlite
 * transaction so the event log and the denormalized row can never diverge.
 */

import { ulid } from "ulid";
import type {
  Column,
  Task,
  TaskEvent,
  TaskEventType,
  WorktreeInfo,
  ModelSpec,
  AgentColumn,
} from "@/lib/types";
import { getDb, nowIso } from "./index";

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

interface TaskRow {
  id: string;
  project_id: string;
  title: string;
  prompt: string;
  context_paths: string;
  scope_paths: string;
  branch: string;
  repo_branches: string | null;
  workspace_mode: Task["workspaceMode"];
  board_column: Column;
  run_state: Task["runState"];
  execution: Task["execution"];
  model_overrides: string | null;
  worktree: string | null;
  claude_session_id: string | null;
  codex_thread_id: string | null;
  remote_session_id: string | null;
  review_cycle: number;
  commit_shas: string;
  pr_url: string | null;
  cost_usd: number;
  error: string | null;
  created_at: string;
  updated_at: string;
}

interface TaskEventRow {
  id: number;
  task_id: string;
  type: TaskEventType;
  at: string;
  payload: string | null;
}

function rowToTask(row: TaskRow): Task {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    prompt: row.prompt,
    contextPaths: JSON.parse(row.context_paths) as string[],
    scopePaths: JSON.parse(row.scope_paths) as string[],
    branch: row.branch,
    repoBranches: row.repo_branches
      ? (JSON.parse(row.repo_branches) as Record<string, string>)
      : undefined,
    workspaceMode: row.workspace_mode,
    column: row.board_column,
    runState: row.run_state,
    execution: row.execution,
    modelOverrides: row.model_overrides
      ? (JSON.parse(row.model_overrides) as Partial<Record<AgentColumn, ModelSpec>>)
      : undefined,
    worktree: row.worktree ? (JSON.parse(row.worktree) as WorktreeInfo) : undefined,
    claudeSessionId: row.claude_session_id ?? undefined,
    codexThreadId: row.codex_thread_id ?? undefined,
    remoteSessionId: row.remote_session_id ?? undefined,
    reviewCycle: row.review_cycle,
    commitShas: JSON.parse(row.commit_shas) as string[],
    prUrl: row.pr_url ?? undefined,
    costUsd: row.cost_usd,
    error: row.error ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToEvent(row: TaskEventRow): TaskEvent {
  return {
    id: row.id,
    taskId: row.task_id,
    type: row.type,
    at: row.at,
    payload: row.payload ? (JSON.parse(row.payload) as unknown) : undefined,
  };
}

/** Fields the pipeline may update on a task after creation. */
export type TaskUpdate = Partial<
  Pick<
    Task,
    | "title"
    | "prompt"
    | "contextPaths"
    | "scopePaths"
    | "branch"
    | "repoBranches"
    | "workspaceMode"
    | "column"
    | "runState"
    | "execution"
    | "modelOverrides"
    | "worktree"
    | "claudeSessionId"
    | "codexThreadId"
    | "remoteSessionId"
    | "reviewCycle"
    | "commitShas"
    | "prUrl"
    | "costUsd"
    | "error"
  >
>;

function taskToRowParams(task: Task) {
  return {
    id: task.id,
    projectId: task.projectId,
    title: task.title,
    prompt: task.prompt,
    contextPaths: JSON.stringify(task.contextPaths),
    scopePaths: JSON.stringify(task.scopePaths),
    branch: task.branch,
    repoBranches: task.repoBranches ? JSON.stringify(task.repoBranches) : null,
    workspaceMode: task.workspaceMode,
    boardColumn: task.column,
    runState: task.runState,
    execution: task.execution,
    modelOverrides: task.modelOverrides ? JSON.stringify(task.modelOverrides) : null,
    worktree: task.worktree ? JSON.stringify(task.worktree) : null,
    claudeSessionId: task.claudeSessionId ?? null,
    codexThreadId: task.codexThreadId ?? null,
    remoteSessionId: task.remoteSessionId ?? null,
    reviewCycle: task.reviewCycle,
    commitShas: JSON.stringify(task.commitShas),
    prUrl: task.prUrl ?? null,
    costUsd: task.costUsd,
    error: task.error ?? null,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

const UPDATE_SQL = `
  UPDATE tasks SET
    title = @title,
    prompt = @prompt,
    context_paths = @contextPaths,
    scope_paths = @scopePaths,
    branch = @branch,
    repo_branches = @repoBranches,
    workspace_mode = @workspaceMode,
    board_column = @boardColumn,
    run_state = @runState,
    execution = @execution,
    model_overrides = @modelOverrides,
    worktree = @worktree,
    claude_session_id = @claudeSessionId,
    codex_thread_id = @codexThreadId,
    remote_session_id = @remoteSessionId,
    review_cycle = @reviewCycle,
    commit_shas = @commitShas,
    pr_url = @prUrl,
    cost_usd = @costUsd,
    error = @error,
    updated_at = @updatedAt
  WHERE id = @id
`;

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export interface CreateTaskRecord {
  projectId: string;
  title: string;
  prompt: string;
  contextPaths: string[];
  scopePaths: string[];
  branch: string;
  repoBranches?: Record<string, string>;
  workspaceMode: Task["workspaceMode"];
  execution: Task["execution"];
  modelOverrides?: Task["modelOverrides"];
}

/**
 * Inserts the task row AND its `task_created` event in one transaction.
 * Returns the created task + event.
 */
export function createTask(record: CreateTaskRecord): { task: Task; event: TaskEvent } {
  const db = getDb();
  const now = nowIso();
  const task: Task = {
    id: ulid(),
    projectId: record.projectId,
    title: record.title,
    prompt: record.prompt,
    contextPaths: record.contextPaths,
    scopePaths: record.scopePaths,
    branch: record.branch,
    repoBranches: record.repoBranches,
    workspaceMode: record.workspaceMode,
    column: "todo",
    runState: "idle",
    execution: record.execution,
    modelOverrides: record.modelOverrides,
    reviewCycle: 0,
    commitShas: [],
    costUsd: 0,
    createdAt: now,
    updatedAt: now,
  };

  const insert = db.transaction(() => {
    db.prepare(
      `INSERT INTO tasks (
         id, project_id, title, prompt, context_paths, scope_paths, branch, repo_branches, workspace_mode,
         board_column, run_state, execution, model_overrides, worktree,
         claude_session_id, codex_thread_id, remote_session_id,
         review_cycle, commit_shas, pr_url, cost_usd, error, created_at, updated_at
       ) VALUES (
         @id, @projectId, @title, @prompt, @contextPaths, @scopePaths, @branch, @repoBranches, @workspaceMode,
         @boardColumn, @runState, @execution, @modelOverrides, @worktree,
         @claudeSessionId, @codexThreadId, @remoteSessionId,
         @reviewCycle, @commitShas, @prUrl, @costUsd, @error, @createdAt, @updatedAt
       )`,
    ).run(taskToRowParams(task));
    return insertEvent(task.id, "task_created", undefined, now);
  });

  const event = insert();
  return { task, event };
}

export function getTask(id: string): Task | undefined {
  const row = getDb().prepare(`SELECT * FROM tasks WHERE id = ?`).get(id) as TaskRow | undefined;
  return row ? rowToTask(row) : undefined;
}

export function listTasks(): Task[] {
  const rows = getDb().prepare(`SELECT * FROM tasks ORDER BY created_at ASC`).all() as TaskRow[];
  return rows.map(rowToTask);
}

export function listTasksByProject(projectId: string): Task[] {
  const rows = getDb()
    .prepare(`SELECT * FROM tasks WHERE project_id = ? ORDER BY created_at ASC`)
    .all(projectId) as TaskRow[];
  return rows.map(rowToTask);
}

export function listTasksByColumn(column: Column): Task[] {
  const rows = getDb()
    .prepare(`SELECT * FROM tasks WHERE board_column = ? ORDER BY created_at ASC`)
    .all(column) as TaskRow[];
  return rows.map(rowToTask);
}

/** Tasks on a given project+branch — the FIFO queue domain for the scheduler mutex. */
export function listTasksByProjectBranch(projectId: string, branch: string): Task[] {
  const rows = getDb()
    .prepare(`SELECT * FROM tasks WHERE project_id = ? AND branch = ? ORDER BY created_at ASC`)
    .all(projectId, branch) as TaskRow[];
  return rows.map(rowToTask);
}

/**
 * Plain field update WITHOUT an event — only for non-state bookkeeping
 * (cost accumulation, session ids). State changes (column/runState) should go
 * through `appendEventAndUpdate`.
 */
export function updateTask(id: string, patch: TaskUpdate): Task | undefined {
  const existing = getTask(id);
  if (!existing) return undefined;
  const next: Task = { ...existing, ...patch, updatedAt: nowIso() };
  getDb().prepare(UPDATE_SQL).run(taskToRowParams(next));
  return next;
}

/** Deletes the task; events/runs cascade. Returns false if not found. */
export function deleteTask(id: string): boolean {
  const res = getDb().prepare(`DELETE FROM tasks WHERE id = ?`).run(id);
  return res.changes > 0;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

function insertEvent(
  taskId: string,
  type: TaskEventType,
  payload: unknown,
  at: string,
): TaskEvent {
  const res = getDb()
    .prepare(`INSERT INTO task_events (task_id, type, at, payload) VALUES (?, ?, ?, ?)`)
    .run(taskId, type, at, payload === undefined ? null : JSON.stringify(payload));
  return {
    id: Number(res.lastInsertRowid),
    taskId,
    type,
    at,
    payload,
  };
}

export function listTaskEvents(taskId: string): TaskEvent[] {
  const rows = getDb()
    .prepare(`SELECT * FROM task_events WHERE task_id = ? ORDER BY id ASC`)
    .all(taskId) as TaskEventRow[];
  return rows.map(rowToEvent);
}

/**
 * Additive (pipeline agent): task events for a project in a time window,
 * joined with the task title — input for the morning status reports.
 */
export function listTaskEventsForProjectBetween(
  projectId: string,
  fromIso: string,
  toIso: string,
): Array<TaskEvent & { taskTitle: string }> {
  const rows = getDb()
    .prepare(
      `SELECT e.*, t.title AS task_title
       FROM task_events e
       JOIN tasks t ON t.id = e.task_id
       WHERE t.project_id = ? AND e.at >= ? AND e.at < ?
       ORDER BY e.id ASC`,
    )
    .all(projectId, fromIso, toIso) as Array<TaskEventRow & { task_title: string }>;
  return rows.map((row) => ({ ...rowToEvent(row), taskTitle: row.task_title }));
}

/**
 * THE state-transition primitive: appends a task_event AND applies the derived
 * denormalized update to the task row in one transaction.
 *
 * Throws if the task does not exist.
 */
export function appendEventAndUpdate(
  taskId: string,
  type: TaskEventType,
  payload: unknown,
  update: TaskUpdate,
): { task: Task; event: TaskEvent } {
  const db = getDb();
  const txn = db.transaction(() => {
    const existing = getTask(taskId);
    if (!existing) throw new Error(`Task not found: ${taskId}`);
    const at = nowIso();
    const event = insertEvent(taskId, type, payload, at);
    const next: Task = { ...existing, ...update, updatedAt: at };
    db.prepare(UPDATE_SQL).run(taskToRowParams(next));
    return { task: next, event };
  });
  return txn();
}

// ---------------------------------------------------------------------------
// Crash recovery
// ---------------------------------------------------------------------------

/**
 * On boot: any task still marked running/queued has no live process behind it
 * (the orchestrator died). Mark each as error with an `error` event appended.
 * Returns the affected tasks (post-update).
 */
export function markStaleRunningTasksAsError(): Task[] {
  const db = getDb();
  const txn = db.transaction(() => {
    const rows = db
      .prepare(`SELECT * FROM tasks WHERE run_state IN ('running','queued')`)
      .all() as TaskRow[];
    return rows.map((row) => {
      const { task } = appendEventAndUpdate(
        row.id,
        "error",
        { reason: "stale_running_on_boot" },
        { runState: "error", error: "Orchestrator restarted while this task was running (stale)." },
      );
      return task;
    });
  });
  return txn();
}
