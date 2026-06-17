/**
 * The (local) review reviewer: runs a Claude Code review with Haiku. It reuses
 * the implementer's claude spawn path (role "reviewer") with the review prompt;
 * the prompt instructs the agent to end with a single JSON verdict object,
 * which we salvage + zod-validate via parseVerdict.
 *
 * Always a fresh session (no thread to resume) — each round carries the full
 * prompt + diff, so it needs no history.
 */

import { randomUUID } from "node:crypto";
import type { ModelSpec, ReviewVerdict } from "@/lib/types";
import { runClaude } from "./claudeRunner";
import { parseVerdict } from "./verdict";

/** Cheap, fast model used for the review phase. */
export const REVIEW_SPEC: ModelSpec = {
  provider: "claude-code",
  model: "haiku",
  effort: "medium",
};

export interface ClaudeReviewParams {
  taskId: string;
  /** The same review prompt assembled for codex (task + diff + instructions). */
  prompt: string;
  cwd: string;
  reviewCycle: number;
}

export interface ClaudeReviewResult {
  runId: string;
  /** Validated verdict parsed from the agent's final message, if any. */
  verdict?: ReviewVerdict;
  failureReason?: string;
}

export async function runClaudeReviewer(params: ClaudeReviewParams): Promise<ClaudeReviewResult> {
  const result = await runClaude({
    taskId: params.taskId,
    prompt: params.prompt,
    cwd: params.cwd,
    spec: REVIEW_SPEC,
    sessionId: randomUUID(),
    mode: "start",
    role: "reviewer",
    reviewCycle: params.reviewCycle,
  });

  if (result.isError || result.resultText === undefined) {
    return {
      runId: result.runId,
      failureReason: result.failureReason ?? "reviewer produced no result",
    };
  }

  const parsed = parseVerdict(result.resultText);
  if (!parsed.verdict) {
    return {
      runId: result.runId,
      failureReason: `reviewer ${parsed.error ?? "verdict parse failed"}`,
    };
  }
  return { runId: result.runId, verdict: parsed.verdict };
}
