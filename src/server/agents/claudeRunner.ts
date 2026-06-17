/**
 * Implementer runner: spawns `claude -p` with stream-json output, persists the
 * raw NDJSON transcript to ~/.friday-kanban/transcripts/<runId>.ndjson, emits
 * parsed TranscriptItems onto the bus, and extracts the final result
 * (is_error, session_id, total_cost_usd, usage).
 *
 * First run:  claude -p "<prompt>" --session-id <uuid> ...
 * Fix rounds: claude -p "<prompt>" --resume <uuid> ...
 */

import fs from "node:fs";
import path from "node:path";
import type { AgentRole, AgentRunUsage, ModelSpec, TranscriptItem } from "@/lib/types";
import { publish } from "@/server/bus";
import {
  createAgentRun,
  finishAgentRun,
  updateAgentRunPid,
  updateAgentRunTranscriptPath,
} from "@/server/db/agentRuns";
import { ensureDir, transcriptsDir } from "@/server/paths";
import { registerProcess } from "@/server/pipeline/processRegistry";
import { NdjsonReader } from "./streamParser";
import { claudeEventToItems } from "./transcript";
import { spawnAgent, type SpawnEndReason } from "./spawn";

export interface ClaudeRunParams {
  taskId: string;
  /** Full prompt text passed to -p. */
  prompt: string;
  /** Working directory for the spawn (project checkout or worktree). */
  cwd: string;
  spec: ModelSpec;
  /** Pre-allocated UUID: --session-id on first run, --resume on fix rounds. */
  sessionId: string;
  mode: "start" | "resume";
  /** Run role recorded on the agent run; defaults to "implementer". */
  role?: AgentRole;
  reviewCycle?: number;
  hardTimeoutMs?: number;
  stallTimeoutMs?: number;
}

/** Shape extracted from the final stream `result` event. */
interface ClaudeStreamResult {
  isError: boolean;
  sessionId?: string;
  totalCostUsd?: number;
  usage?: AgentRunUsage;
  resultText?: string;
}

export interface ClaudeRunResult extends ClaudeStreamResult {
  runId: string;
  exitCode: number | null;
  endReason: SpawnEndReason;
  /** Human-readable failure detail when the run did not succeed. */
  failureReason?: string;
}

function buildClaudeArgv(params: ClaudeRunParams): string[] {
  const argv = ["claude", "-p", params.prompt];
  if (params.mode === "start") {
    argv.push("--session-id", params.sessionId);
  } else {
    argv.push("--resume", params.sessionId);
  }
  argv.push(
    "--model",
    params.spec.model,
    "--effort",
    params.spec.effort,
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--dangerously-skip-permissions",
  );
  return argv;
}

function childEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  // --effort must win; the env var has highest precedence in the CLI.
  delete env.CLAUDE_CODE_EFFORT_LEVEL;
  return env;
}

function extractUsage(usage: unknown): AgentRunUsage | undefined {
  if (typeof usage !== "object" || usage === null) return undefined;
  const u = usage as Record<string, unknown>;
  const num = (v: unknown): number => (typeof v === "number" ? v : 0);
  return {
    input: num(u.input_tokens),
    output: num(u.output_tokens),
    cached: num(u.cache_read_input_tokens),
  };
}

/** Run one claude implementer invocation to completion. */
export async function runClaude(params: ClaudeRunParams): Promise<ClaudeRunResult> {
  const argv = buildClaudeArgv(params);

  const dir = ensureDir(transcriptsDir());
  const run = createAgentRun({
    taskId: params.taskId,
    role: params.role ?? "implementer",
    spec: params.spec,
    argv,
    transcriptPath: "", // patched right below, once the run id is known
    reviewCycle: params.reviewCycle,
  });
  const transcriptPath = path.join(dir, `${run.id}.ndjson`);
  updateAgentRunTranscriptPath(run.id, transcriptPath);
  const transcriptStream = fs.createWriteStream(transcriptPath, { flags: "a" });

  const captured: { result: ClaudeStreamResult | null } = { result: null };

  const emitItem = (item: TranscriptItem): void => {
    publish({ type: "transcript_item", taskId: params.taskId, runId: run.id, item });
  };

  const reader = new NdjsonReader({
    onRawLine: (line) => {
      transcriptStream.write(line + "\n");
    },
    onObject: (obj) => {
      for (const item of claudeEventToItems(obj)) emitItem(item);
      const rec = obj as Record<string, unknown>;
      if (rec && rec.type === "result") {
        captured.result = {
          isError: rec.is_error === true,
          sessionId: typeof rec.session_id === "string" ? rec.session_id : undefined,
          totalCostUsd: typeof rec.total_cost_usd === "number" ? rec.total_cost_usd : undefined,
          usage: extractUsage(rec.usage),
          resultText: typeof rec.result === "string" ? rec.result : undefined,
        };
      }
    },
  });

  const spawned = spawnAgent({
    argv,
    cwd: params.cwd,
    env: childEnv(),
    stdin: "ignore",
    hardTimeoutMs: params.hardTimeoutMs,
    stallTimeoutMs: params.stallTimeoutMs,
    onStdoutChunk: (chunk) => reader.push(chunk),
  });

  if (spawned.pid !== undefined) {
    updateAgentRunPid(run.id, spawned.pid);
  }
  const unregister = registerProcess(params.taskId, () => spawned.kill("killed"));

  const exit = await spawned.exited;
  unregister();
  reader.end();
  transcriptStream.end();

  const final = captured.result;
  const isError = final === null ? true : final.isError;

  const noun = params.role ?? "implementer";
  let failureReason: string | undefined;
  if (exit.endReason === "stall") {
    failureReason = `${noun} stalled (no stdout for the watchdog window)`;
  } else if (exit.endReason === "timeout") {
    failureReason = `${noun} exceeded the hard time limit`;
  } else if (exit.endReason === "killed") {
    failureReason = `${noun} was canceled`;
  } else if (exit.endReason === "spawn_error") {
    failureReason = `failed to spawn claude: ${exit.stderrTail.trim() || "unknown spawn error"}`;
  } else if (final === null) {
    failureReason = `claude exited (code ${exit.exitCode ?? "?"}) without a result event${
      exit.stderrTail.trim() ? `: ${exit.stderrTail.trim().slice(-500)}` : ""
    }`;
  } else if (final.isError) {
    failureReason = final.resultText?.slice(0, 1000) ?? "claude reported is_error=true";
  }

  finishAgentRun(run.id, {
    exitCode: exit.exitCode ?? undefined,
    costUsd: final?.totalCostUsd,
    usage: final?.usage,
  });

  // Surface a synthetic error item when the process died without a result.
  if (final === null && exit.endReason !== "killed") {
    emitItem({
      kind: "error",
      ts: new Date().toISOString(),
      message: failureReason ?? `${noun} run failed`,
    });
  }

  return {
    runId: run.id,
    isError,
    sessionId: final?.sessionId,
    totalCostUsd: final?.totalCostUsd,
    usage: final?.usage,
    resultText: final?.resultText,
    exitCode: exit.exitCode,
    endReason: exit.endReason,
    failureReason,
  };
}
