/**
 * The Orchestrator — the single server-side brain that owns the task pipeline:
 * scheduling, agent spawning (claude -p / codex exec / claude --remote),
 * review loops, PR creation, and status reports.
 *
 * Always obtain the instance via getOrchestrator() — it is globalThis-cached
 * so server.ts and Next route handlers share one instance across HMR
 * re-evaluations.
 *
 * Error contract for API routes (docs/API.md):
 * - TaskNotFoundError  (code 'not_found')          -> 404
 * - InvalidTransitionError (code 'invalid_transition') -> 409
 * - TaskRunningError   (code 'task_running')       -> 409
 */

import type {
  AppConfig,
  BranchPR,
  CreateTaskInput,
  ProjectStatusReport,
  Task,
} from "@/lib/types";
import { getDb } from "@/server/db";
import { getProject } from "@/server/db/projects";
import {
  createTask as dbCreateTask,
  getTask,
  markStaleRunningTasksAsError,
} from "@/server/db/tasks";
import { getConfig } from "@/server/db/config";
import { saveTaskAttachments } from "@/server/attachments";
import { enqueueTaskMessage } from "@/server/db/taskMessages";
import { publish } from "@/server/bus";
import {
  InvalidTransitionError,
  TaskNotFoundError,
  TaskRunningError,
  assertLegalDrag,
  requireTask,
  transition,
} from "@/server/pipeline/stateMachine";
import { getScheduler } from "@/server/pipeline/scheduler";
import {
  cancelProcesses,
  clearCanceled,
  hasLiveProcess,
  interruptProcesses,
} from "@/server/pipeline/processRegistry";
import { createPrForProjectBranch } from "@/server/pipeline/prCreator";
import { getOrGenerateStatusReports as generateStatusReports } from "@/server/reports/statusReports";

/**
 * Kept for the API contract: routes map NotImplementedError to HTTP 501.
 * All orchestrator methods are implemented now, but routes written during the
 * scaffold phase still import this.
 */
export class NotImplementedError extends Error {
  constructor(method: string) {
    super(`Orchestrator.${method} is not implemented yet`);
    this.name = "NotImplementedError";
  }
}

export class Orchestrator {
  private booted = false;

  /**
   * Boot sequence, called by server.ts BEFORE the HTTP server starts listening:
   * 1. Open the DB (creates schema idempotently).
   * 2. Crash recovery: mark stale 'running'/'queued' tasks as error.
   * 3. Start the scheduler (auto-mode drain loop).
   *
   * Idempotent — safe to call more than once.
   */
  async boot(): Promise<void> {
    if (this.booted) return;
    this.booted = true;

    getDb(); // opens ~/.friday-kanban/friday.db, creates schema, WAL

    const stale = markStaleRunningTasksAsError();
    for (const task of stale) {
      publish({ type: "task_updated", task });
    }
    if (stale.length > 0) {
      console.log(
        `[orchestrator] crash recovery: marked ${stale.length} stale running task(s) as error`,
      );
    }

    getScheduler().start();
  }

  /**
   * Validate input, persist the task (column 'todo', runState 'idle'),
   * publish task_created. When `input.startNow` is set the implementer is
   * kicked on demand immediately (Todo -> In Dev via the scheduler) regardless
   * of scheduler mode; otherwise the card waits for a manual drag, and in auto
   * scheduler mode the scheduler picks it up immediately.
   */
  async createTask(input: CreateTaskInput): Promise<Task> {
    const project = getProject(input.projectId);
    if (!project) throw new TaskNotFoundError(`project:${input.projectId}`);

    const { task, event } = dbCreateTask({
      projectId: project.id,
      title: input.title,
      prompt: input.prompt,
      contextPaths: input.contextPaths ?? [],
      scopePaths: input.scopePaths ?? [],
      branch: input.branch ?? project.baseBranch,
      workspaceMode: input.workspaceMode ?? "branch",
      execution: input.execution ?? project.defaultExecution,
      modelOverrides: input.modelOverrides,
    });

    // Persist any prompt image attachments to disk (referenced by absolute
    // path in the implementer prompt). Done after the task exists so the files
    // land under the task's directory.
    if (input.images && input.images.length > 0) {
      saveTaskAttachments(task.id, input.images);
    }

    publish({ type: "task_created", task });
    publish({ type: "task_event_appended", taskId: task.id, event });

    // On-demand start: kick the implementer right away instead of leaving the
    // card in Todo. startTask runs the same admission path as a manual drag.
    if (input.startNow) {
      return this.startTask(task.id);
    }

    if (getConfig().schedulerMode === "auto") {
      getScheduler().autoDrain();
    }
    return task;
  }

  /**
   * The Todo -> In Dev command (manual drag or auto-scheduler): admission via
   * the scheduler (per-project-branch FIFO mutex + global concurrency gate),
   * then the implementer pipeline (or the cloud pipeline for execution
   * 'cloud'). Returns the task after the transition is recorded.
   */
  async startTask(taskId: string): Promise<Task> {
    const task = requireTask(taskId);
    assertLegalDrag(task, "in_dev");
    if (task.column !== "todo") {
      throw new InvalidTransitionError(`startTask requires column 'todo' (got '${task.column}')`);
    }

    getScheduler().enqueue(taskId, { kind: "implement" });
    return requireTask(taskId);
  }

  /**
   * The In Dev -> In Review command (manual drag): commit outstanding work and
   * spawn the codex reviewer immediately, even if the implementer is idle.
   */
  async forceReview(taskId: string): Promise<Task> {
    const task = requireTask(taskId);
    if (task.column !== "in_dev") {
      throw new InvalidTransitionError(`forceReview requires column 'in_dev' (got '${task.column}')`);
    }
    assertLegalDrag(task, "in_review");

    // Committing outstanding work + the review both run inside the pipeline,
    // under the scheduler's per-branch mutex — so this never races a
    // concurrent implementer mutating the same shared checkout. If there is
    // ultimately nothing to review, the pipeline records the task as error.
    getScheduler().enqueue(taskId, { kind: "review", commitOutstanding: true });
    return requireTask(taskId);
  }

  /**
   * The In Review -> In Dev command (manual drag with typed comment):
   * record review_changes_requested with the human comment and resume the
   * implementer session (claude -p --resume <claudeSessionId>).
   */
  async sendBackToDev(taskId: string, comment: string): Promise<Task> {
    const task = requireTask(taskId);
    if (task.column !== "in_review") {
      throw new InvalidTransitionError(
        `sendBackToDev requires column 'in_review' (got '${task.column}')`,
      );
    }
    assertLegalDrag(task, "in_dev");
    if (comment.trim().length === 0) {
      throw new InvalidTransitionError("a comment is required to send a task back");
    }

    transition(taskId, "review_changes_requested", {
      payload: { source: "human", comment },
    });

    const feedbackMarkdown = ["**Human reviewer comment:**", "", comment.trim()].join("\n");
    getScheduler().enqueue(taskId, { kind: "fix", feedbackMarkdown });
    return requireTask(taskId);
  }

  /**
   * Retry a task in runState 'error' or 'needs_attention': clear the error and
   * re-enter the pipeline at the step it failed in (resuming sessions where
   * possible).
   */
  async retryTask(taskId: string): Promise<Task> {
    const task = requireTask(taskId);
    if (task.runState !== "error" && task.runState !== "needs_attention") {
      throw new InvalidTransitionError(
        `retry requires runState 'error' or 'needs_attention' (got '${task.runState}')`,
      );
    }

    clearCanceled(taskId);
    // A needs_attention task has already burned the full review-cycle budget
    // (reviewCycle === maxReviewCycles). Retrying must hand it a fresh budget,
    // otherwise the very next review instantly re-exhausts the cap and the
    // implementer never gets another fix round.
    const resetCycle = task.runState === "needs_attention";
    transition(taskId, "task_retried", {
      payload: { fromColumn: task.column, fromRunState: task.runState, resetCycle },
      update: resetCycle ? { error: undefined, reviewCycle: 0 } : { error: undefined },
    });

    // Re-enter at the step it failed in.
    if (task.column === "in_review") {
      getScheduler().enqueue(taskId, { kind: "review" });
    } else if (task.column === "in_dev" && task.claudeSessionId && task.commitShas.length > 0) {
      // A session exists with prior work — resume it rather than restarting.
      getScheduler().enqueue(taskId, {
        kind: "fix",
        feedbackMarkdown:
          "The previous run of this task failed or was interrupted. " +
          "Review the current state of the working tree and finish the task.",
      });
    } else {
      getScheduler().enqueue(taskId, { kind: "implement" });
    }
    return requireTask(taskId);
  }

  /**
   * Resume a stopped task (runState 'error' or 'needs_attention') with a
   * free-form user message instead of a blind retry: the message is handed to
   * the implementer as a directive ("the user says: ...") in the resumed
   * session. Mirrors retryTask's branching by the column it stopped in.
   */
  async resumeWithMessage(taskId: string, message: string): Promise<Task> {
    const task = requireTask(taskId);
    if (task.runState !== "error" && task.runState !== "needs_attention") {
      throw new InvalidTransitionError(
        `sending a message requires runState 'error' or 'needs_attention' (got '${task.runState}')`,
      );
    }
    const trimmed = message.trim();
    if (trimmed.length === 0) {
      throw new InvalidTransitionError("a message is required");
    }

    clearCanceled(taskId);
    // needs_attention has burned the review-cycle budget — hand it a fresh one
    // (same reasoning as retryTask).
    const resetCycle = task.runState === "needs_attention";
    const clearError = resetCycle
      ? { error: undefined, reviewCycle: 0 }
      : { error: undefined };
    const feedbackMarkdown = ["**The user sent a message to direct this task:**", "", trimmed].join(
      "\n",
    );

    if (task.column === "in_review") {
      // Move back to In Dev for a fix round that addresses the user's message
      // (review_changes_requested is legal from in_review/error|needs_attention).
      transition(taskId, "review_changes_requested", {
        payload: { source: "human", message: trimmed, viaMessage: true },
        update: clearError,
      });
      getScheduler().enqueue(taskId, { kind: "fix", feedbackMarkdown, humanDirective: true });
    } else {
      transition(taskId, "task_retried", {
        payload: { fromColumn: task.column, fromRunState: task.runState, resetCycle, viaMessage: true },
        update: clearError,
      });
      if (task.claudeSessionId) {
        // Resume the existing session with the user's directive.
        getScheduler().enqueue(taskId, { kind: "fix", feedbackMarkdown, humanDirective: true });
      } else {
        // No session to resume (never started) — start fresh.
        getScheduler().enqueue(taskId, { kind: "implement" });
      }
    }
    return requireTask(taskId);
  }

  /**
   * Mid-task chat: send a free-form message to a RUNNING task. The message is
   * persisted, then the live agent is interrupted (not canceled). The running
   * pipeline drains the message at the interrupt boundary and resumes the same
   * session with it as a human directive (a fix round). If no live process is
   * found (the run just ended), the queued message is still picked up at the
   * pipeline's next boundary.
   */
  async messageRunningTask(taskId: string, message: string): Promise<Task> {
    const task = requireTask(taskId);
    if (task.runState !== "running") {
      throw new InvalidTransitionError(
        `messaging a running task requires runState 'running' (got '${task.runState}')`,
      );
    }
    const trimmed = message.trim();
    if (trimmed.length === 0) {
      throw new InvalidTransitionError("a message is required");
    }

    enqueueTaskMessage(taskId, trimmed);
    interruptProcesses(taskId);
    return requireTask(taskId);
  }

  /**
   * Kill any live agent process for the task, release its queue slot, and mark
   * it idle in its current column (event: task_canceled).
   */
  async cancelTask(taskId: string): Promise<Task> {
    const task = requireTask(taskId);
    if (task.runState !== "running" && task.runState !== "queued") {
      throw new InvalidTransitionError(
        `cancel requires runState 'running' or 'queued' (got '${task.runState}')`,
      );
    }

    const dequeued = getScheduler().dequeue(taskId);
    const killed = cancelProcesses(taskId);

    return transition(taskId, "task_canceled", {
      payload: { dequeued, killedLiveProcess: killed },
      update: { error: undefined },
    });
  }

  /**
   * The manual "Create PR" action for a project/branch (DESIGN.md decision 6):
   * push the branch; if an open PR exists for it, push into it, else
   * `gh pr create` with a body generated from all done tasks on that branch
   * (titles, summaries, non-blocking review findings). Upserts and returns the
   * BranchPR record.
   */
  async createPrForProject(projectId: string, branch: string): Promise<BranchPR> {
    return createPrForProjectBranch(projectId, branch);
  }

  /**
   * Status pane: return today's cached per-project reports, generating any
   * missing ones (git log --since=yesterday + task history, summarized by
   * haiku) and caching them per (project, date).
   */
  async getOrGenerateStatusReports(): Promise<ProjectStatusReport[]> {
    return generateStatusReports();
  }

  /**
   * Called after PUT /api/config persists a change: react to schedulerMode /
   * maxConcurrentTasks updates (e.g. start draining Todo when switched to
   * 'auto').
   */
  onConfigChanged(config: AppConfig): void {
    getScheduler().onConfigChanged(config);
  }

  /** True when the task has a live agent process (diagnostics / API guards). */
  hasLiveRun(taskId: string): boolean {
    const task = getTask(taskId);
    if (!task) return false;
    return hasLiveProcess(taskId) || getScheduler().isRunning(taskId);
  }
}

// Re-export the typed pipeline errors so API routes can map them to HTTP
// codes without importing pipeline internals.
export { InvalidTransitionError, TaskNotFoundError, TaskRunningError };

const GLOBAL_KEY = "__fridayKanbanOrchestrator" as const;

type GlobalWithOrchestrator = typeof globalThis & {
  [GLOBAL_KEY]?: Orchestrator;
};

export function getOrchestrator(): Orchestrator {
  const g = globalThis as GlobalWithOrchestrator;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new Orchestrator();
  }
  return g[GLOBAL_KEY];
}
