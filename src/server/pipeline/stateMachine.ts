/**
 * The task state machine. ALL column/runState changes flow through
 * `transition()` here: it validates the move against the legal-transition
 * table, appends the task_event + applies the denormalized update in one
 * sqlite transaction (db/tasks.appendEventAndUpdate), and publishes the
 * resulting BoardEvents.
 *
 * Drag commands (todo->in_dev, in_dev->in_review, in_review->in_dev) are
 * expressed as task events too (dev/review lifecycle + manual_move), so the
 * board always reflects real pipeline state.
 */

import type {
  Column,
  RunState,
  Task,
  TaskEventType,
} from "@/lib/types";
import {
  appendEventAndUpdate,
  getTask,
  type TaskUpdate,
} from "@/server/db/tasks";
import { publish } from "@/server/bus";

// ---------------------------------------------------------------------------
// Typed errors (mapped to HTTP codes by the API layer)
// ---------------------------------------------------------------------------

export class TaskNotFoundError extends Error {
  readonly code = "not_found";
  constructor(taskId: string) {
    super(`Task not found: ${taskId}`);
    this.name = "TaskNotFoundError";
  }
}

export class InvalidTransitionError extends Error {
  readonly code = "invalid_transition";
  constructor(message: string) {
    super(message);
    this.name = "InvalidTransitionError";
  }
}

export class TaskRunningError extends Error {
  readonly code = "task_running";
  constructor(message: string) {
    super(message);
    this.name = "TaskRunningError";
  }
}

// ---------------------------------------------------------------------------
// Legal transition table
// ---------------------------------------------------------------------------

interface TransitionSpec {
  /** Columns the task must be in (empty = any). */
  fromColumns: readonly Column[];
  /** Run states the task must be in (empty = any). */
  fromRunStates: readonly RunState[];
  /** Resulting column (undefined = unchanged). */
  toColumn?: Column;
  /** Resulting run state (undefined = unchanged). */
  toRunState?: RunState;
}

/**
 * Event-driven transition table. Each TaskEventType that changes state
 * declares where it is legal FROM and what it implies. Events not listed
 * here (task_created) are emitted by the repositories directly.
 */
const TRANSITIONS: Partial<Record<TaskEventType, TransitionSpec>> = {
  // Admission to the scheduler. The target column is supplied by the caller
  // (enqueue) via the update, NOT hardcoded here: a Todo start moves to In Dev,
  // but re-queuing a review (retry from In Review) must stay in In Review.
  task_queued: {
    fromColumns: ["todo", "in_dev", "in_review"],
    fromRunStates: ["idle", "error"],
    toRunState: "queued",
  },
  dev_started: {
    fromColumns: ["todo", "in_dev"],
    fromRunStates: ["idle", "queued", "error"],
    toColumn: "in_dev",
    toRunState: "running",
  },
  dev_completed: {
    fromColumns: ["in_dev"],
    fromRunStates: ["running"],
    toColumn: "in_dev",
    toRunState: "idle",
  },
  dev_failed: {
    fromColumns: ["in_dev"],
    fromRunStates: ["running", "queued"],
    toColumn: "in_dev",
    toRunState: "error",
  },

  // Review loop
  review_started: {
    fromColumns: ["in_dev", "in_review"],
    fromRunStates: ["idle", "queued", "error", "needs_attention"],
    toColumn: "in_review",
    toRunState: "running",
  },
  review_approved: {
    fromColumns: ["in_review"],
    fromRunStates: ["running"],
    toColumn: "done",
    toRunState: "idle",
  },
  review_changes_requested: {
    // running = codex verdict; idle/needs_attention = human send-back drag
    fromColumns: ["in_review"],
    fromRunStates: ["running", "idle", "needs_attention", "error"],
    toColumn: "in_dev",
    toRunState: "idle",
  },
  review_failed: {
    fromColumns: ["in_review"],
    fromRunStates: ["running"],
    toColumn: "in_review",
    toRunState: "error",
  },
  review_cap_exhausted: {
    fromColumns: ["in_review"],
    fromRunStates: ["running"],
    toColumn: "in_review",
    toRunState: "needs_attention",
  },
  fix_started: {
    fromColumns: ["in_dev"],
    fromRunStates: ["idle", "queued", "error"],
    toColumn: "in_dev",
    toRunState: "running",
  },

  // Terminal-ish / bookkeeping
  pr_created: {
    fromColumns: ["done"],
    fromRunStates: [],
  },
  task_retried: {
    fromColumns: [],
    fromRunStates: ["error", "needs_attention"],
    toRunState: "idle",
  },
  task_canceled: {
    fromColumns: [],
    fromRunStates: ["running", "queued"],
    toRunState: "idle",
  },
  // A mid-task user message interrupted a live run. Not a failure: drop to idle
  // in the current column so the pipeline can resume with the message.
  task_interrupted: {
    fromColumns: [],
    fromRunStates: ["running"],
    toRunState: "idle",
  },
  manual_move: {
    fromColumns: [],
    fromRunStates: [],
  },
  budget_exceeded: {
    fromColumns: [],
    fromRunStates: [],
    toRunState: "error",
  },
  error: {
    fromColumns: [],
    fromRunStates: [],
    toRunState: "error",
  },
};

// ---------------------------------------------------------------------------
// Core primitive
// ---------------------------------------------------------------------------

export interface TransitionOptions {
  payload?: unknown;
  /** Extra denormalized fields to set alongside the state change. */
  update?: TaskUpdate;
}

/** Read the task or throw TaskNotFoundError. */
export function requireTask(taskId: string): Task {
  const task = getTask(taskId);
  if (!task) throw new TaskNotFoundError(taskId);
  return task;
}

/**
 * Validate + apply one state transition:
 * 1. checks the event is legal from the task's current (column, runState)
 * 2. appends the task_event AND updates the denormalized row transactionally
 * 3. publishes task_event_appended + task_updated on the bus
 *
 * Throws InvalidTransitionError on illegal moves.
 */
export function transition(
  taskId: string,
  type: TaskEventType,
  opts: TransitionOptions = {},
): Task {
  const task = requireTask(taskId);
  const spec = TRANSITIONS[type];
  if (!spec) {
    throw new InvalidTransitionError(`Event '${type}' cannot be applied via transition()`);
  }
  if (spec.fromColumns.length > 0 && !spec.fromColumns.includes(task.column)) {
    throw new InvalidTransitionError(
      `Event '${type}' is illegal from column '${task.column}' (task ${taskId})`,
    );
  }
  if (spec.fromRunStates.length > 0 && !spec.fromRunStates.includes(task.runState)) {
    throw new InvalidTransitionError(
      `Event '${type}' is illegal from runState '${task.runState}' (task ${taskId})`,
    );
  }

  const update: TaskUpdate = { ...opts.update };
  if (spec.toColumn !== undefined) update.column = spec.toColumn;
  if (spec.toRunState !== undefined) update.runState = spec.toRunState;

  const { task: next, event } = appendEventAndUpdate(taskId, type, opts.payload, update);
  publish({ type: "task_event_appended", taskId, event });
  publish({ type: "task_updated", task: next });
  return next;
}

/**
 * Validate a drag command (from API POST /api/tasks/[id]/move) without
 * applying it — the orchestrator dispatch performs the real transitions.
 * Mirrors LEGAL_MOVES in src/lib/constants.ts plus run-state requirements.
 */
export function assertLegalDrag(task: Task, to: Column): void {
  const from = task.column;
  if (from === "todo" && to === "in_dev") {
    if (task.runState !== "idle" && task.runState !== "error") {
      throw new InvalidTransitionError(
        `Task is '${task.runState}' — cannot start from todo unless idle/error`,
      );
    }
    return;
  }
  if (from === "in_dev" && to === "in_review") {
    if (task.runState === "running" || task.runState === "queued") {
      throw new TaskRunningError("Implementer is still running — cancel it or wait");
    }
    return;
  }
  if (from === "in_review" && to === "in_dev") {
    if (task.runState === "running" || task.runState === "queued") {
      throw new TaskRunningError("Reviewer is still running — cancel it or wait");
    }
    return;
  }
  throw new InvalidTransitionError(`Illegal move ${from} -> ${to}`);
}
