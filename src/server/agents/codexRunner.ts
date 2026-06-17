/**
 * Reviewer runner: spawns `codex exec --json` (read-only sandbox, stdin
 * CLOSED — codex reads stdin when it's not a TTY and can stall otherwise),
 * captures thread_id from the `thread.started` event, streams item events to
 * the bus, and reads + zod-validates the verdict JSON from the -o outfile.
 *
 * Round 1:  codex exec --json -C <dir> -s read-only ... "<prompt>"
 * Round 2+: codex exec resume <thread_id> --json ... "<prompt>"
 */

import fs from "node:fs";
import path from "node:path";
import type { AgentRunUsage, ModelSpec, ReviewVerdict, TranscriptItem } from "@/lib/types";
import { EFFORT_TO_CODEX, REVIEW_VERDICT_JSON_SCHEMA } from "@/lib/constants";
import { parseVerdict } from "./verdict";
import { publish } from "@/server/bus";
import {
  createAgentRun,
  finishAgentRun,
  updateAgentRunArgv,
  updateAgentRunPid,
  updateAgentRunTranscriptPath,
} from "@/server/db/agentRuns";
import { ensureDir, fridayHome, transcriptsDir } from "@/server/paths";
import { registerProcess } from "@/server/pipeline/processRegistry";
import { NdjsonReader } from "./streamParser";
import { codexEventToItems } from "./transcript";
import { spawnAgent, type SpawnEndReason } from "./spawn";

const REVIEWER_HARD_TIMEOUT_MS = 45 * 60 * 1000;

export interface CodexRunParams {
  taskId: string;
  /** The review prompt (task prompt + diff + verdict instructions). */
  prompt: string;
  /** Directory codex is pointed at via -C. */
  cwd: string;
  spec: ModelSpec;
  /** Resume an existing review thread (round 2+). */
  resumeThreadId?: string;
  reviewCycle: number;
  /** Path of the verdict JSON schema file passed to --output-schema. */
  outputSchemaPath: string;
  hardTimeoutMs?: number;
  stallTimeoutMs?: number;
}

export interface CodexRunResult {
  runId: string;
  /** Validated verdict from the -o outfile; undefined when the run failed. */
  verdict?: ReviewVerdict;
  /** thread_id captured from thread.started (resume target). */
  threadId?: string;
  usage?: AgentRunUsage;
  exitCode: number | null;
  endReason: SpawnEndReason;
  failureReason?: string;
}

/**
 * Write the canonical review-verdict JSON schema to disk (idempotent) and
 * return its path. Reviewer calls this before each codex spawn.
 */
export function ensureVerdictSchemaFile(): string {
  const schemaPath = path.join(ensureDir(fridayHome()), "review-verdict-schema.json");
  const json = JSON.stringify(REVIEW_VERDICT_JSON_SCHEMA, null, 2);
  try {
    if (fs.readFileSync(schemaPath, "utf8") === json) return schemaPath;
  } catch {
    // missing — write below
  }
  fs.writeFileSync(schemaPath, json);
  return schemaPath;
}

function buildCodexArgv(params: CodexRunParams, outFile: string): string[] {
  const effort = EFFORT_TO_CODEX[params.spec.effort];
  const argv = ["codex", "exec"];
  if (params.resumeThreadId) {
    argv.push("resume", params.resumeThreadId);
  }
  argv.push("--json");
  // `codex exec resume` accepts neither -C nor -s — it inherits the cwd and
  // sandbox of the original session. Only the fresh run sets them explicitly
  // (the spawned process cwd is params.cwd either way).
  if (!params.resumeThreadId) {
    argv.push("-C", params.cwd, "-s", "read-only");
  }
  argv.push(
    "-c",
    'approval_policy="never"',
    "-m",
    params.spec.model,
    "-c",
    `model_reasoning_effort="${effort}"`,
    "--output-schema",
    params.outputSchemaPath,
    "-o",
    outFile,
    params.prompt,
  );
  return argv;
}

function extractCodexUsage(usage: unknown): AgentRunUsage | undefined {
  if (typeof usage !== "object" || usage === null) return undefined;
  const u = usage as Record<string, unknown>;
  const num = (v: unknown): number => (typeof v === "number" ? v : 0);
  return {
    input: num(u.input_tokens),
    output: num(u.output_tokens),
    cached: num(u.cached_input_tokens),
  };
}

function readVerdictFile(outFile: string): { verdict?: ReviewVerdict; error?: string } {
  let raw: string;
  try {
    raw = fs.readFileSync(outFile, "utf8");
  } catch {
    return { error: "codex did not write the verdict outfile" };
  }
  return parseVerdict(raw);
}

/** Run one codex reviewer invocation to completion. */
export async function runCodex(params: CodexRunParams): Promise<CodexRunResult> {
  const dir = ensureDir(transcriptsDir());

  const run = createAgentRun({
    taskId: params.taskId,
    role: "reviewer",
    spec: params.spec,
    argv: [], // patched below once outFile (named after run id) is known
    transcriptPath: "",
    reviewCycle: params.reviewCycle,
  });
  const transcriptPath = path.join(dir, `${run.id}.ndjson`);
  const outFile = path.join(dir, `${run.id}.verdict.json`);
  updateAgentRunTranscriptPath(run.id, transcriptPath);

  const argv = buildCodexArgv(params, outFile);
  updateAgentRunArgv(run.id, argv);
  const transcriptStream = fs.createWriteStream(transcriptPath, { flags: "a" });

  const captured: { threadId?: string; usage?: AgentRunUsage; turnFailed?: string } = {};

  const emitItem = (item: TranscriptItem): void => {
    publish({ type: "transcript_item", taskId: params.taskId, runId: run.id, item });
  };

  const reader = new NdjsonReader({
    onRawLine: (line) => {
      transcriptStream.write(line + "\n");
    },
    onObject: (obj) => {
      for (const item of codexEventToItems(obj)) emitItem(item);
      const rec = obj as Record<string, unknown>;
      if (!rec || typeof rec.type !== "string") return;
      if (rec.type === "thread.started" && typeof rec.thread_id === "string") {
        captured.threadId = rec.thread_id;
      } else if (rec.type === "turn.completed") {
        captured.usage = extractCodexUsage(rec.usage) ?? captured.usage;
      } else if (rec.type === "turn.failed") {
        const error = rec.error as Record<string, unknown> | undefined;
        captured.turnFailed =
          (error && typeof error.message === "string" ? error.message : undefined) ??
          "codex turn failed";
      } else if (rec.type === "error" && typeof rec.message === "string") {
        captured.turnFailed = rec.message;
      }
    },
  });

  const spawned = spawnAgent({
    argv,
    cwd: params.cwd,
    env: process.env,
    stdin: "ignore", // CRITICAL: codex reads stdin when not a TTY — close it
    hardTimeoutMs: params.hardTimeoutMs ?? REVIEWER_HARD_TIMEOUT_MS,
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

  let verdict: ReviewVerdict | undefined;
  let failureReason: string | undefined;

  if (exit.endReason === "stall") {
    failureReason = "reviewer stalled (no stdout for the watchdog window)";
  } else if (exit.endReason === "timeout") {
    failureReason = "reviewer exceeded the hard time limit";
  } else if (exit.endReason === "killed") {
    failureReason = "reviewer was canceled";
  } else if (exit.endReason === "spawn_error") {
    failureReason = `failed to spawn codex: ${exit.stderrTail.trim() || "unknown spawn error"}`;
  } else {
    const read = readVerdictFile(outFile);
    if (read.verdict) {
      verdict = read.verdict;
    } else {
      failureReason =
        captured.turnFailed ??
        read.error ??
        `codex exited (code ${exit.exitCode ?? "?"}) without a verdict`;
      if (exit.stderrTail.trim() && !captured.turnFailed) {
        failureReason += ` — stderr: ${exit.stderrTail.trim().slice(-400)}`;
      }
    }
  }

  finishAgentRun(run.id, {
    exitCode: exit.exitCode ?? undefined,
    usage: captured.usage,
  });

  return {
    runId: run.id,
    verdict,
    threadId: captured.threadId,
    usage: captured.usage,
    exitCode: exit.exitCode,
    endReason: exit.endReason,
    failureReason,
  };
}
