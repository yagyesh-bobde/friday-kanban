/**
 * Implementer phase: prepare the workspace per workspaceMode, build the
 * prompt (task prompt + context paths + commit instruction), run the claude
 * implementer, ensure commits exist (commitAll fallback), record commit shas,
 * and leave the task ready for review (dev_completed).
 */

import { randomUUID } from "node:crypto";
import type { Task } from "@/lib/types";
import { updateTask } from "@/server/db/tasks";
import { listTaskAttachments } from "@/server/attachments";
import { runClaude } from "@/server/agents/claudeRunner";
import {
  branchExists,
  changedFiles,
  checkoutBranch,
  commitAll,
  commitPaths,
  createBranch,
  headSha,
  revList,
  worktreeAdd,
  worktreeIsValid,
} from "@/server/git";
import { notify } from "@/server/notify";
import { wasCanceled, wasInterrupted } from "./processRegistry";
import { withKeyedLock } from "./mutex";
import { matchesScope } from "./scope";
import { requireTask, transition } from "./stateMachine";
import { renderFindingsMarkdown, requireProject, resolveModelSpec } from "./common";
import {
  commitAllRepos,
  isMultiRepo,
  prepareTaskBranches,
  projectRepos,
  repoHeadShas,
} from "./repos";
import type { ReviewVerdict } from "@/lib/types";

export interface ImplementOptions {
  /** 'start' = fresh session; 'fix' = resume the session with feedback. */
  mode: "start" | "fix";
  /** Findings/comment markdown injected into the fix prompt (mode 'fix'). */
  feedbackMarkdown?: string;
  /**
   * The feedback is a free-form user message (drawer composer), not reviewer
   * findings — frame the fix prompt as a user instruction.
   */
  humanDirective?: boolean;
}

export interface ImplementOutcome {
  ok: boolean;
  canceled?: boolean;
  /** The live agent was interrupted by a mid-task user message; resume with it. */
  interrupted?: boolean;
}

/** Pathspec for the keyed git lock — undefined for isolated (worktree) checkouts. */
function branchLockKey(task: Task): string | undefined {
  return task.workspaceMode === "worktree" ? undefined : `${task.projectId}::${task.branch}`;
}

/**
 * Commit instruction appended to the agent prompt. Scoped tasks must NOT run
 * git themselves — the system stages only their declared paths (so a concurrent
 * same-branch task's disjoint edits are never swept into this task's commit).
 */
function commitInstruction(task: Task): string[] {
  if (task.scopePaths.length > 0) {
    return [
      "",
      "Confine your edits to this file scope (other tasks may be editing the same branch in parallel):",
      ...task.scopePaths.map((p) => `- ${p}`),
      "Do NOT run git add / git commit / git push — the system commits ONLY the changed files",
      "inside your scope for you. Just make the edits, then finish with a short summary of what you changed.",
    ];
  }
  return [
    "",
    "When you are done, commit your work with `git add -A && git commit` using a clear,",
    "descriptive commit message (imperative mood, one summary line; body if needed).",
    "Do NOT push and do NOT open a pull request. Finish with a short summary of what you changed.",
  ];
}

function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "task"
  );
}

function buildStartPrompt(task: Task): string {
  const parts: string[] = [task.prompt.trim()];
  if (task.contextPaths.length > 0) {
    parts.push(
      "",
      "Relevant files/directories for context (paths relative to the repo root):",
      ...task.contextPaths.map((p) => `- ${p}`),
    );
  }
  const attachments = listTaskAttachments(task.id);
  if (attachments.length > 0) {
    parts.push(
      "",
      "Image attachments for this task — read each with the Read tool (absolute paths):",
      ...attachments.map((p) => `- ${p}`),
    );
  }
  parts.push(...commitInstruction(task));
  return parts.join("\n");
}

function buildFixPrompt(task: Task, feedbackMarkdown: string, humanDirective: boolean): string {
  const intro = humanDirective
    ? [
        "The user sent a message about this task while it was running. Follow their",
        "instructions below, then finish.",
      ]
    : [
        "A code reviewer examined your changes for this task and requested changes.",
        "Address each blocking item below, then finish.",
      ];
  return [...intro, ...commitInstruction(task), "", feedbackMarkdown.trim()].join("\n");
}

/** Build the markdown fed into the fix round from a codex verdict. */
export function feedbackFromVerdict(verdict: ReviewVerdict): string {
  return renderFindingsMarkdown(verdict);
}

/**
 * Prepare the working directory per workspaceMode. Returns the cwd for the
 * agent. May update the task (worktree info, new-branch rename).
 */
async function prepareWorkspace(task: Task): Promise<{ task: Task; cwd: string }> {
  const project = requireProject(task.projectId);

  // Multi-repo: prepare each repo's target branch (per-repo override or the
  // task default) and run the agent at the parent folder so it can see/edit all
  // of them. Constrained to branch mode.
  if (isMultiRepo(project)) {
    await prepareTaskBranches(projectRepos(project), task);
    return { task, cwd: project.path };
  }

  if (task.workspaceMode === "worktree") {
    if (task.worktree && (await worktreeIsValid(task.worktree))) {
      return { task, cwd: task.worktree.path };
    }
    const baseRef = (await branchExists(project.path, task.branch))
      ? task.branch
      : project.baseBranch;
    const worktree = await worktreeAdd(project.path, task.projectId, baseRef);
    const updated = updateTask(task.id, { worktree });
    return { task: updated ?? task, cwd: worktree.path };
  }

  if (task.workspaceMode === "new-branch") {
    // First start: create friday/<slug>-<suffix> off the selected branch in
    // the main checkout, and retarget the task at it (PR bundling key).
    if (!task.branch.startsWith("friday/")) {
      const newBranch = `friday/${slugify(task.title)}-${task.id.slice(-4).toLowerCase()}`;
      if (await branchExists(project.path, newBranch)) {
        await checkoutBranch(project.path, newBranch);
      } else {
        const from = (await branchExists(project.path, task.branch))
          ? task.branch
          : undefined;
        await createBranch(project.path, newBranch, from);
      }
      const updated = updateTask(task.id, { branch: newBranch });
      return { task: updated ?? task, cwd: project.path };
    }
    await checkoutBranch(project.path, task.branch);
    return { task, cwd: project.path };
  }

  // 'branch' (default): work directly in the main checkout on task.branch.
  if (await branchExists(project.path, task.branch)) {
    await checkoutBranch(project.path, task.branch);
  } else {
    const from = (await branchExists(project.path, project.baseBranch))
      ? project.baseBranch
      : undefined;
    await createBranch(project.path, task.branch, from);
  }
  return { task, cwd: project.path };
}

/**
 * Run one implementer round (initial dev or a fix round). On success the task
 * is left in in_dev/idle with dev_completed recorded; on failure in
 * in_dev/error with dev_failed.
 */
export async function runImplementerPhase(
  taskId: string,
  opts: ImplementOptions,
): Promise<ImplementOutcome> {
  let task = requireTask(taskId);

  // Workspace prep happens BEFORE dev_started so a git failure surfaces
  // cleanly as dev_failed below without a half-started run.
  let cwd: string;
  try {
    // Scoped tasks can run concurrently on a shared checkout, so serialize the
    // short workspace-prep git ops (checkout / branch create) on the branch key.
    const lockKey = branchLockKey(task);
    const prepared =
      lockKey && task.scopePaths.length > 0
        ? await withKeyedLock(lockKey, () => prepareWorkspace(task))
        : await prepareWorkspace(task);
    task = prepared.task;
    cwd = prepared.cwd;
  } catch (err) {
    const message = `workspace preparation failed: ${err instanceof Error ? err.message : String(err)}`;
    // dev_failed requires running/queued; the task may still be idle/queued
    // here, so record a generic error event instead.
    transition(taskId, "error", {
      payload: { phase: "workspace", message },
      update: { error: message },
    });
    notify("friday-kanban: task failed", `${task.title}: ${message}`, taskId);
    return { ok: false };
  }

  const isFix = opts.mode === "fix";
  // Fresh session per 'start' (a crashed earlier session cannot be resumed
  // reliably); fix rounds resume the recorded session.
  const priorSessionId = task.claudeSessionId;
  const resume = isFix && priorSessionId !== undefined;
  const sessionId = resume ? priorSessionId : randomUUID();

  const spec = resolveModelSpec(task, "in_dev");
  // Capture the pre-run HEAD(s) so we can list exactly this round's commits.
  // Multi-repo tracks a base per sub-repo (the parent cwd isn't a git repo).
  const project = requireProject(task.projectId);
  const multi = isMultiRepo(project);
  const repos = projectRepos(project);
  const baseSha = multi ? undefined : await headSha(cwd).catch(() => undefined);
  const baseShas = multi ? await repoHeadShas(repos) : null;

  task = transition(taskId, isFix ? "fix_started" : "dev_started", {
    payload: { spec, cwd, sessionId },
    update: { claudeSessionId: sessionId, error: undefined },
  });

  const prompt =
    isFix && opts.feedbackMarkdown !== undefined
      ? buildFixPrompt(task, opts.feedbackMarkdown, opts.humanDirective === true)
      : buildStartPrompt(task);

  const result = await runClaude({
    taskId,
    prompt,
    cwd,
    spec,
    sessionId,
    mode: resume ? "resume" : "start",
    reviewCycle: task.reviewCycle,
  });

  if (wasCanceled(taskId)) {
    // cancelTask already recorded task_canceled and reset runState.
    return { ok: false, canceled: true };
  }

  const costDelta = result.totalCostUsd ?? 0;

  if (wasInterrupted(taskId)) {
    // A mid-task user message killed the run. This is NOT a failure: record the
    // cost, drop runState back to idle, and let the pipeline resume the session
    // with the queued message. Uncommitted edits stay in the tree for the
    // resumed session to finish and commit.
    transition(taskId, "task_interrupted", {
      payload: { runId: result.runId },
      update: { costUsd: task.costUsd + costDelta, error: undefined },
    });
    return { ok: false, interrupted: true };
  }

  if (result.isError) {
    const message = result.failureReason ?? "implementer run failed";
    transition(taskId, "dev_failed", {
      payload: { runId: result.runId, message, exitCode: result.exitCode },
      update: { error: message, costUsd: task.costUsd + costDelta },
    });
    notify("friday-kanban: implementer failed", `${task.title}: ${message.slice(0, 180)}`, taskId);
    return { ok: false };
  }

  // Commit the work. Scoped tasks stage ONLY their in-scope changed files under
  // the per-branch git lock (so a concurrent task's disjoint edits aren't swept
  // in); unscoped tasks keep the original "commit everything" behaviour.
  let newShas: string[] = [];
  try {
    const message = `friday: ${task.title}`;
    if (multi && baseShas) {
      // Multi-repo: commit across every sub-repo (scoping not applied here).
      newShas = await commitAllRepos(repos, message, baseShas);
    } else if (task.scopePaths.length > 0) {
      const lockKey = branchLockKey(task);
      const doCommit = async (): Promise<void> => {
        const pre = (await headSha(cwd).catch(() => undefined)) ?? baseSha;
        const changed = await changedFiles(cwd);
        const inScope = changed.filter((f) => matchesScope(f, task.scopePaths));
        await commitPaths(cwd, message, inScope);
        const post = await headSha(cwd).catch(() => undefined);
        newShas = pre && post && post !== pre ? await revList(cwd, pre, post) : [];
      };
      if (lockKey) await withKeyedLock(lockKey, doCommit);
      else await doCommit();
    } else {
      await commitAll(cwd, message);
      newShas = baseSha ? await revList(cwd, baseSha, "HEAD") : [];
    }
  } catch (err) {
    const message = `failed to commit implementer work: ${err instanceof Error ? err.message : String(err)}`;
    transition(taskId, "dev_failed", {
      payload: { runId: result.runId, message },
      update: { error: message, costUsd: task.costUsd + costDelta },
    });
    notify("friday-kanban: task failed", `${task.title}: ${message}`, taskId);
    return { ok: false };
  }

  if (newShas.length === 0 && task.commitShas.length === 0) {
    const message = "implementer finished without producing any commits";
    transition(taskId, "dev_failed", {
      payload: { runId: result.runId, message, summary: result.resultText },
      update: { error: message, costUsd: task.costUsd + costDelta },
    });
    notify("friday-kanban: task failed", `${task.title}: ${message}`, taskId);
    return { ok: false };
  }

  transition(taskId, "dev_completed", {
    payload: {
      runId: result.runId,
      commitShas: newShas,
      costUsd: costDelta,
      summary: result.resultText,
    },
    update: {
      commitShas: [...task.commitShas, ...newShas],
      costUsd: task.costUsd + costDelta,
      claudeSessionId: result.sessionId ?? sessionId,
      error: undefined,
    },
  });

  return { ok: true };
}
