/**
 * Repository for `task_messages` — free-form user messages addressed to a task
 * (mid-task chat). A message sent to a running task interrupts the live agent;
 * the pipeline drains unconsumed messages at the next boundary and resumes the
 * session with them as a human directive.
 */

import { getDb, nowIso } from "./index";

interface TaskMessageRow {
  id: number;
  task_id: string;
  message: string;
  created_at: string;
  consumed_at: string | null;
}

/** Persist a pending message for a task. Returns the row id. */
export function enqueueTaskMessage(taskId: string, message: string): number {
  const res = getDb()
    .prepare(`INSERT INTO task_messages (task_id, message, created_at) VALUES (?, ?, ?)`)
    .run(taskId, message, nowIso());
  return Number(res.lastInsertRowid);
}

/** True if the task has at least one un-drained message. */
export function hasPendingMessages(taskId: string): boolean {
  const row = getDb()
    .prepare(
      `SELECT 1 FROM task_messages WHERE task_id = ? AND consumed_at IS NULL LIMIT 1`,
    )
    .get(taskId);
  return row !== undefined;
}

/**
 * Atomically read AND mark-consumed every pending message for a task, oldest
 * first. Returns the message bodies (empty array when there are none).
 */
export function takePendingMessages(taskId: string): string[] {
  const db = getDb();
  const txn = db.transaction(() => {
    const rows = db
      .prepare(
        `SELECT * FROM task_messages WHERE task_id = ? AND consumed_at IS NULL ORDER BY id ASC`,
      )
      .all(taskId) as TaskMessageRow[];
    if (rows.length > 0) {
      const at = nowIso();
      db.prepare(`UPDATE task_messages SET consumed_at = ? WHERE task_id = ? AND consumed_at IS NULL`).run(
        at,
        taskId,
      );
    }
    return rows.map((r) => r.message);
  });
  return txn();
}
