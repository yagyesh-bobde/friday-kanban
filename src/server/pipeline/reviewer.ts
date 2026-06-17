/**
 * Reviewer phase: compute the diff of THIS task's commits, run the codex
 * reviewer (resuming the thread on round 2+), and gate on the verdict:
 * - approve OR zero blocker findings -> done (non-blocking findings stored)
 * - blockers -> review_changes_requested, back to In Dev for a fix round
 * - cap (config.maxReviewCycles) -> needs_attention + macOS notification
 */

import type { ReviewVerdict, Task } from "@/lib/types";
import { getConfig } from "@/server/db/config";
import { REVIEW_SPEC, runClaudeReviewer } from "@/server/agents/claudeReviewer";
import { commitAll, headSha, showCommit } from "@/server/git";
import { notify } from "@/server/notify";
import { wasCanceled } from "./processRegistry";
import { requireTask, transition } from "./stateMachine";
import { requireProject, workspaceDir } from "./common";

const DIFF_CHAR_BUDGET = 160_000;

export type ReviewOutcome =
  | { kind: "approved"; verdict: ReviewVerdict }
  | { kind: "changes_requested"; verdict: ReviewVerdict }
  | { kind: "exhausted"; verdict: ReviewVerdict }
  | { kind: "failed" }
  | { kind: "canceled" };

/**
 * Assemble the diff for exactly this task's commits (they may interleave
 * with other tasks' commits on a shared branch, so we show each commit
 * individually rather than diffing a range).
 */
export async function buildTaskDiff(task: Task, cwd: string): Promise<string> {
  const chunks: string[] = [];
  let used = 0;
  for (const sha of task.commitShas) {
    let patch: string;
    try {
      patch = await showCommit(cwd, sha);
    } catch {
      patch = `commit ${sha}: <unavailable — not found in this checkout>`;
    }
    if (used + patch.length > DIFF_CHAR_BUDGET) {
      chunks.push(
        `\n[diff truncated — ${task.commitShas.length - chunks.length} more commit(s) omitted for size]`,
      );
      break;
    }
    chunks.push(patch);
    used += patch.length;
  }
  return chunks.join("\n");
}

export function buildReviewPrompt(task: Task, diff: string, round: number): string {
  const intro =
    round === 0
      ? [
          `You are reviewing the code changes an AI implementer made for the following task.`,
          "",
          `## Task: ${task.title}`,
          "",
          task.prompt.trim(),
          "",
          "## Changes to review (one section per commit)",
          "",
          "```diff",
          diff,
          "```",
        ]
      : [
          "The implementer pushed a new round of commits addressing your previous findings.",
          "Re-review: verify each previous blocker is fixed and check the new changes.",
          "",
          "## New/updated changes",
          "",
          "```diff",
          diff,
          "```",
        ];

  return [
    ...intro,
    "",
    "## Instructions",
    "",
    "- Verdict 'request_changes' ONLY for real bugs or security problems.",
    "- Severity 'blocker' is reserved for bugs and security issues — anything that is",
    "  broken behavior, data loss, a crash, or a vulnerability.",
    "- Style, naming, structure and nitpicks are 'major' or 'minor' — they must NOT",
    "  drive a 'request_changes' verdict on their own.",
    "- If there are no blockers, the verdict is 'approve' (still report major/minor findings).",
    "- Your final message MUST be a single JSON object matching the provided output schema:",
    '  {"verdict":"approve"|"request_changes","summary":string,"findings":[{"file":string,"line":number|null,"severity":"blocker"|"major"|"minor","comment":string}]}',
  ].join("\n");
}

/**
 * Commit any uncommitted work in the task's workspace before a forced review
 * (the In Dev -> In Review drag). Runs INSIDE the pipeline so it executes
 * under the scheduler's per-branch mutex — never racing a concurrent
 * implementer that holds the same shared checkout. Records the commit (if any)
 * and returns false (recording an error) when there is nothing to review.
 */
export async function commitOutstandingForReview(taskId: string): Promise<boolean> {
  let task = requireTask(taskId);
  const project = requireProject(task.projectId);
  const cwd = workspaceDir(task, project);

  try {
    const base = await headSha(cwd).catch(() => undefined);
    const sha = await commitAll(cwd, `friday: ${task.title} (manual review)`);
    if (sha && sha !== base) {
      task = transition(taskId, "manual_move", {
        payload: { action: "force_review_commit", sha },
        update: { commitShas: [...task.commitShas, sha] },
      });
    }
  } catch (err) {
    const message = `could not commit outstanding work for review: ${
      err instanceof Error ? err.message : String(err)
    }`;
    transition(taskId, "error", {
      payload: { phase: "force_review_commit", message },
      update: { error: message },
    });
    notify("friday-kanban: review failed", `${task.title}: ${message.slice(0, 180)}`, taskId);
    return false;
  }

  if (task.commitShas.length === 0) {
    const message = "task has no commits to review";
    transition(taskId, "error", {
      payload: { phase: "force_review_commit", message },
      update: { error: message },
    });
    notify("friday-kanban: review failed", `${task.title}: ${message}`, taskId);
    return false;
  }
  return true;
}

/**
 * Run one review round. The task must have commits to review.
 * Leaves the task in done / in_dev / needs_attention / error per the verdict.
 */
export async function runReviewPhase(taskId: string): Promise<ReviewOutcome> {
  let task = requireTask(taskId);
  const project = requireProject(task.projectId);
  const cwd = workspaceDir(task, project);
  const config = getConfig();

  const round = task.reviewCycle;
  const diff = await buildTaskDiff(task, cwd).catch(() => "");

  task = transition(taskId, "review_started", {
    payload: { spec: REVIEW_SPEC, round },
    update: { error: undefined },
  });

  const review = await runClaudeReviewer({
    taskId,
    prompt: buildReviewPrompt(task, diff, round),
    cwd,
    reviewCycle: round,
  });

  if (wasCanceled(taskId)) {
    return { kind: "canceled" };
  }

  if (!review.verdict) {
    const message = review.failureReason ?? "review run failed";
    transition(taskId, "review_failed", {
      payload: { runId: review.runId, message },
      update: { error: message },
    });
    notify("friday-kanban: review failed", `${task.title}: ${message.slice(0, 180)}`, taskId);
    return { kind: "failed" };
  }

  const verdict = review.verdict;
  const blockers = verdict.findings.filter((f) => f.severity === "blocker");
  const approved = verdict.verdict === "approve" || blockers.length === 0;

  if (approved) {
    transition(taskId, "review_approved", {
      // Non-blocking findings live in this payload — surfaced on the card and
      // included in the eventual PR body.
      payload: { runId: review.runId, verdict, source: "claude-haiku" },
      update: { reviewCycle: round + 1, error: undefined },
    });
    notify("friday-kanban: task done", `${task.title} passed review`, taskId);
    return { kind: "approved", verdict };
  }

  const newCycle = round + 1;
  if (newCycle >= config.maxReviewCycles) {
    transition(taskId, "review_cap_exhausted", {
      payload: { runId: review.runId, verdict, rounds: newCycle, source: "claude-haiku" },
      update: { reviewCycle: newCycle },
    });
    notify(
      "friday-kanban: needs attention",
      `${task.title}: review cap (${config.maxReviewCycles} rounds) exhausted`,
      taskId,
    );
    return { kind: "exhausted", verdict };
  }

  transition(taskId, "review_changes_requested", {
    payload: { runId: review.runId, verdict, source: "claude-haiku" },
    update: { reviewCycle: newCycle },
  });
  return { kind: "changes_requested", verdict };
}
