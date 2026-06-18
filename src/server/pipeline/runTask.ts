/**
 * The per-task pipeline driver: composes implementer + reviewer rounds for
 * local tasks (the bounded fix loop), and delegates cloud tasks to the
 * isolated cloud pipeline. The scheduler invokes this and releases the
 * task's queue slot when the returned promise settles.
 */

import { requireTask } from "./stateMachine";
import { feedbackFromVerdict, runImplementerPhase } from "./implementer";
import { commitOutstandingForReview, runReviewPhase } from "./reviewer";
import { runCloudPipeline } from "./cloudPipeline";
import { clearInterrupted, wasCanceled } from "./processRegistry";
import { hasPendingMessages, takePendingMessages } from "@/server/db/taskMessages";

/**
 * Build a fix-round entry from any queued mid-task user messages, marking them
 * consumed. Called at pipeline boundaries and after an interrupt so the user's
 * message is handed to the resumed session as a human directive.
 */
function drainMessagesToFix(taskId: string): PipelineEntry {
  clearInterrupted(taskId);
  const messages = takePendingMessages(taskId);
  const body = messages.join("\n\n").trim();
  const feedbackMarkdown =
    body.length > 0
      ? ["**The user sent a message while this task was running:**", "", body].join("\n")
      : "The user interrupted this task. Review the current state of the work and finish it.";
  return { kind: "fix", feedbackMarkdown, humanDirective: true };
}

export type PipelineEntry =
  /** Fresh Todo -> In Dev start. */
  | { kind: "implement" }
  /**
   * Resume the session with feedback. `humanDirective` distinguishes a
   * free-form user message (sent via the drawer composer) from reviewer
   * findings, so the implementer prompt frames it correctly.
   */
  | { kind: "fix"; feedbackMarkdown: string; humanDirective?: boolean }
  /**
   * Jump straight to review (forced-review drag, or retry in In Review).
   * `commitOutstanding` (set by the In Dev -> In Review drag) commits any
   * uncommitted work in the checkout FIRST — done here, inside the pipeline,
   * so it runs under the scheduler's per-branch mutex rather than racing a
   * concurrent implementer on the shared checkout.
   */
  | { kind: "review"; commitOutstanding?: boolean };

/**
 * Run the pipeline for one task from the given entry point until it reaches
 * a terminal state for this run (done / error / needs_attention / canceled).
 * Never throws for pipeline-level failures (they are recorded as task
 * events); only truly unexpected errors propagate to the scheduler's catch.
 */
export async function runTaskPipeline(taskId: string, entry: PipelineEntry): Promise<void> {
  const task = requireTask(taskId);

  if (task.execution === "cloud") {
    // Cloud tasks always run their own isolated flow end-to-end.
    await runCloudPipeline(taskId);
    return;
  }

  let next: PipelineEntry = entry;
  for (;;) {
    if (wasCanceled(taskId)) return;

    // Mid-task chat: a queued user message takes priority at any boundary. This
    // also covers the race where the interrupt found no live process to kill
    // (the run had just ended) — the message is still drained here.
    if (next.kind !== "fix" && hasPendingMessages(taskId)) {
      next = drainMessagesToFix(taskId);
    }

    if (next.kind === "implement" || next.kind === "fix") {
      const outcome = await runImplementerPhase(
        taskId,
        next.kind === "fix"
          ? {
              mode: "fix",
              feedbackMarkdown: next.feedbackMarkdown,
              humanDirective: next.humanDirective,
            }
          : { mode: "start" },
      );
      if (outcome.interrupted) {
        // A mid-task message killed the run; resume the session with it.
        next = drainMessagesToFix(taskId);
        continue;
      }
      if (!outcome.ok) return; // dev_failed / canceled — recorded already
      next = { kind: "review" };
      continue;
    }

    if (next.commitOutstanding) {
      // Commit any uncommitted work under the held branch mutex before review.
      const committed = await commitOutstandingForReview(taskId);
      if (!committed) return; // error recorded (nothing to review / commit failed)
      if (wasCanceled(taskId)) return;
    }

    const review = await runReviewPhase(taskId);
    switch (review.kind) {
      case "approved":
      case "exhausted":
      case "failed":
      case "canceled":
        return;
      case "interrupted":
        // Reviewer killed by a mid-task message; resume in dev with it.
        next = drainMessagesToFix(taskId);
        continue;
      case "changes_requested":
        next = { kind: "fix", feedbackMarkdown: feedbackFromVerdict(review.verdict) };
        continue;
    }
  }
}
