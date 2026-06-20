/**
 * The scheduler: admission control for task pipelines.
 *
 * - Global running-count gate: at most config.maxConcurrentTasks pipelines.
 * - Per (projectId, branch) admission for tasks that share the main checkout
 *   (workspaceMode 'branch' / 'new-branch'). Historically this was a strict
 *   FIFO mutex (one task per branch at a time). It is now SCOPE-AWARE: two
 *   same-branch tasks run CONCURRENTLY when their declared file scopes are
 *   disjoint, and only queue when their scopes overlap. A task with an empty
 *   (undeclared) scope is treated as touching everything, so it still
 *   serializes with every other task on its branch — preserving the original
 *   behaviour for tasks that don't opt in. Worktree + cloud tasks are isolated
 *   and skip branch admission entirely (they still count against the global gate).
 * - Auto mode drains Todo (oldest first) up to the cap; manual mode only runs
 *   tasks explicitly started (drag Todo -> In Dev).
 * - Reacts to config changes (mode flip / cap raise -> pump).
 *
 * globalThis-cached: route handlers and server.ts share one instance.
 */

import type { AppConfig, Column, Task } from "@/lib/types";
import { getConfig } from "@/server/db/config";
import { getTask, listTasksByColumn } from "@/server/db/tasks";
import { transition } from "./stateMachine";
import { runTaskPipeline, type PipelineEntry } from "./runTask";
import { clearCanceled } from "./processRegistry";
import { scopesOverlap } from "./scope";
import { notify } from "@/server/notify";

const AUTO_DRAIN_INTERVAL_MS = 15_000;

interface QueuedEntry {
  taskId: string;
  entry: PipelineEntry;
}

function mutexKey(task: Task): string | undefined {
  // Worktree tasks are isolated; cloud tasks run on a VM. Only tasks that
  // mutate the main checkout contend on (projectId, branch).
  if (task.workspaceMode === "worktree" || task.execution === "cloud") return undefined;
  return `${task.projectId}::${task.branch}`;
}

export class Scheduler {
  /** taskIds with a live pipeline (counts against maxConcurrentTasks). */
  private readonly running = new Set<string>();
  /** mutexKey -> (taskId -> its scopePaths) for tasks currently running on that branch. */
  private readonly branchRunning = new Map<string, Map<string, string[]>>();
  /** mutexKey -> FIFO of waiting entries. */
  private readonly queues = new Map<string, QueuedEntry[]>();
  /** Entries waiting only on the global gate (no mutex contention). */
  private readonly globalQueue: QueuedEntry[] = [];
  private drainTimer: ReturnType<typeof setInterval> | undefined;
  private started = false;

  /** Boot hook: start the auto-drain loop. (Stale-run recovery happens in boot().) */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.drainTimer = setInterval(() => this.autoDrain(), AUTO_DRAIN_INTERVAL_MS);
    this.drainTimer.unref?.();
    // Kick once at boot so auto mode picks up leftover Todo immediately.
    this.autoDrain();
  }

  stop(): void {
    if (this.drainTimer) clearInterval(this.drainTimer);
    this.drainTimer = undefined;
    this.started = false;
  }

  /** React to config updates: a mode flip to auto / higher cap pumps queues. */
  onConfigChanged(config: AppConfig): void {
    void config;
    this.pump();
    this.autoDrain();
  }

  /** Live pipeline count (for diagnostics). */
  runningCount(): number {
    return this.running.size;
  }

  isRunning(taskId: string): boolean {
    return this.running.has(taskId);
  }

  /**
   * Admission point: start the task's pipeline at `entry` now if a slot is free
   * and no scope-conflicting task is running on its branch, else queue it FIFO
   * (runState 'queued'). The caller must have validated the command (state
   * machine drag rules).
   */
  enqueue(taskId: string, entry: PipelineEntry): void {
    const task = getTask(taskId);
    if (!task) return;
    if (this.running.has(taskId) || this.isQueued(taskId)) return;

    clearCanceled(taskId);

    const key = mutexKey(task);
    const capacity = this.running.size < getConfig().maxConcurrentTasks;
    const admissible = key === undefined || this.canRunOnKey(key, taskId, task.scopePaths);
    // A Todo start advances to In Dev; any other entry (fix / forced review /
    // retry re-review) keeps the task in its current column while it waits.
    const queuedColumn: Column = entry.kind === "implement" ? "in_dev" : task.column;

    if (capacity && admissible) {
      // Record the admission synchronously so the board (and the API response
      // that triggered this) immediately shows in_dev/queued instead of the
      // task lingering in its old column until dev_started lands.
      transition(taskId, "task_queued", {
        payload: { waitingOn: "launch", entry: entry.kind },
        update: { column: queuedColumn },
      });
      this.launch(getTask(taskId) ?? task, entry, key);
      return;
    }

    // Mark queued (visible on the board) and park it.
    transition(taskId, "task_queued", {
      payload: { waitingOn: !admissible ? "branch_scope" : "concurrency_cap", entry: entry.kind },
      update: { column: queuedColumn },
    });
    const queued: QueuedEntry = { taskId, entry };
    if (key !== undefined) {
      const queue = this.queues.get(key) ?? [];
      queue.push(queued);
      this.queues.set(key, queue);
    } else {
      this.globalQueue.push(queued);
    }
  }

  /** Remove a task from any wait queue (cancel path). Returns true if found. */
  dequeue(taskId: string): boolean {
    let removed = false;
    for (const [key, queue] of this.queues) {
      const idx = queue.findIndex((q) => q.taskId === taskId);
      if (idx >= 0) {
        queue.splice(idx, 1);
        if (queue.length === 0) this.queues.delete(key);
        removed = true;
      }
    }
    const gIdx = this.globalQueue.findIndex((q) => q.taskId === taskId);
    if (gIdx >= 0) {
      this.globalQueue.splice(gIdx, 1);
      removed = true;
    }
    return removed;
  }

  /** Auto mode: drain Todo (oldest first) into the pipeline up to the cap. */
  autoDrain(): void {
    const config = getConfig();
    if (config.schedulerMode !== "auto") return;
    const todo = listTasksByColumn("todo").filter((t) => t.runState === "idle");
    for (const task of todo) {
      if (this.running.size >= config.maxConcurrentTasks) break;
      if (this.running.has(task.id) || this.isQueued(task.id)) continue;
      this.enqueue(task.id, { kind: "implement" });
    }
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private isQueued(taskId: string): boolean {
    if (this.globalQueue.some((q) => q.taskId === taskId)) return true;
    for (const queue of this.queues.values()) {
      if (queue.some((q) => q.taskId === taskId)) return true;
    }
    return false;
  }

  /**
   * Can a task with `scopePaths` run on `key` right now? Only if no OTHER task
   * currently running on that branch has an overlapping scope.
   */
  private canRunOnKey(key: string, taskId: string, scopePaths: string[]): boolean {
    const live = this.branchRunning.get(key);
    if (!live || live.size === 0) return true;
    for (const [otherId, otherScope] of live) {
      if (otherId === taskId) continue;
      if (scopesOverlap(scopePaths, otherScope)) return false;
    }
    return true;
  }

  private launch(task: Task, entry: PipelineEntry, key: string | undefined): void {
    this.running.add(task.id);
    if (key !== undefined) {
      let live = this.branchRunning.get(key);
      if (!live) {
        live = new Map();
        this.branchRunning.set(key, live);
      }
      live.set(task.id, task.scopePaths);
    }

    runTaskPipeline(task.id, entry)
      .catch((err: unknown) => {
        // Pipeline-internal failures are recorded as task events; anything
        // landing here is unexpected (bug). Surface it on the task.
        const message = `pipeline crashed: ${err instanceof Error ? err.message : String(err)}`;
        console.error(`[scheduler] task ${task.id}: ${message}`, err);
        try {
          transition(task.id, "error", { payload: { message }, update: { error: message } });
        } catch {
          // task may be gone — nothing to record
        }
        notify("friday-kanban: task crashed", `${task.title}: ${message.slice(0, 180)}`, task.id);
      })
      .finally(() => {
        this.running.delete(task.id);
        if (key !== undefined) {
          const live = this.branchRunning.get(key);
          live?.delete(task.id);
          if (live && live.size === 0) this.branchRunning.delete(key);
        }
        this.pump();
        this.autoDrain();
      });
  }

  /** Start queued entries whose scope is now free, while capacity remains. */
  private pump(): void {
    const config = getConfig();

    // Per-branch queues first (FIFO within each key, but a scope-disjoint entry
    // may overtake a blocked head — that's the whole point of parallelism).
    for (const [key, queue] of [...this.queues.entries()]) {
      const remaining: QueuedEntry[] = [];
      for (const next of queue) {
        if (this.running.size >= config.maxConcurrentTasks) {
          remaining.push(next);
          continue;
        }
        const task = getTask(next.taskId);
        if (!task || task.runState !== "queued") continue; // canceled/retried while waiting
        if (this.canRunOnKey(key, task.id, task.scopePaths)) {
          this.launch(task, next.entry, key);
        } else {
          remaining.push(next);
        }
      }
      if (remaining.length === 0) this.queues.delete(key);
      else this.queues.set(key, remaining);
    }

    // Then the global (mutex-free) queue.
    while (this.globalQueue.length > 0 && this.running.size < config.maxConcurrentTasks) {
      const next = this.globalQueue.shift();
      if (!next) break;
      const task = getTask(next.taskId);
      if (!task || task.runState !== "queued") continue;
      this.launch(task, next.entry, mutexKey(task));
    }
  }
}

const GLOBAL_KEY = "__fridayKanbanScheduler" as const;

type GlobalWithScheduler = typeof globalThis & {
  [GLOBAL_KEY]?: Scheduler;
};

export function getScheduler(): Scheduler {
  const g = globalThis as GlobalWithScheduler;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new Scheduler();
  }
  return g[GLOBAL_KEY];
}
