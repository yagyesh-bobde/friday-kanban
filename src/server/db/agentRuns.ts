/** Repository for the `agent_runs` table (one row per CLI invocation). */

import { ulid } from "ulid";
import type { AgentRun, AgentRunUsage, ModelSpec } from "@/lib/types";
import { getDb, nowIso } from "./index";

interface AgentRunRow {
  id: string;
  task_id: string;
  role: AgentRun["role"];
  spec: string;
  argv: string;
  pid: number | null;
  started_at: string;
  ended_at: string | null;
  exit_code: number | null;
  cost_usd: number | null;
  usage: string | null;
  transcript_path: string;
  review_cycle: number | null;
}

function rowToRun(row: AgentRunRow): AgentRun {
  return {
    id: row.id,
    taskId: row.task_id,
    role: row.role,
    spec: JSON.parse(row.spec) as ModelSpec,
    argv: JSON.parse(row.argv) as string[],
    pid: row.pid ?? undefined,
    startedAt: row.started_at,
    endedAt: row.ended_at ?? undefined,
    exitCode: row.exit_code ?? undefined,
    costUsd: row.cost_usd ?? undefined,
    usage: row.usage ? (JSON.parse(row.usage) as AgentRunUsage) : undefined,
    transcriptPath: row.transcript_path,
    reviewCycle: row.review_cycle ?? undefined,
  };
}

export interface CreateAgentRunRecord {
  taskId: string;
  role: AgentRun["role"];
  spec: ModelSpec;
  argv: string[];
  transcriptPath: string;
  pid?: number;
  reviewCycle?: number;
}

export function createAgentRun(record: CreateAgentRunRecord): AgentRun {
  const run: AgentRun = {
    id: ulid(),
    taskId: record.taskId,
    role: record.role,
    spec: record.spec,
    argv: record.argv,
    pid: record.pid,
    startedAt: nowIso(),
    transcriptPath: record.transcriptPath,
    reviewCycle: record.reviewCycle,
  };
  getDb()
    .prepare(
      `INSERT INTO agent_runs (id, task_id, role, spec, argv, pid, started_at, transcript_path, review_cycle)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      run.id,
      run.taskId,
      run.role,
      JSON.stringify(run.spec),
      JSON.stringify(run.argv),
      run.pid ?? null,
      run.startedAt,
      run.transcriptPath,
      run.reviewCycle ?? null,
    );
  return run;
}

export function getAgentRun(id: string): AgentRun | undefined {
  const row = getDb().prepare(`SELECT * FROM agent_runs WHERE id = ?`).get(id) as
    | AgentRunRow
    | undefined;
  return row ? rowToRun(row) : undefined;
}

export function listAgentRunsByTask(taskId: string): AgentRun[] {
  const rows = getDb()
    .prepare(`SELECT * FROM agent_runs WHERE task_id = ? ORDER BY started_at ASC, id ASC`)
    .all(taskId) as AgentRunRow[];
  return rows.map(rowToRun);
}

/**
 * Additive (pipeline agent): set the transcript path after the run id is
 * known — the transcript file is named after the run id.
 */
export function updateAgentRunTranscriptPath(id: string, transcriptPath: string): void {
  getDb().prepare(`UPDATE agent_runs SET transcript_path = ? WHERE id = ?`).run(transcriptPath, id);
}

/**
 * Additive (pipeline agent): record the child pid once spawned.
 */
export function updateAgentRunPid(id: string, pid: number): void {
  getDb().prepare(`UPDATE agent_runs SET pid = ? WHERE id = ?`).run(pid, id);
}

/**
 * Additive (pipeline agent): patch argv when it depends on the run id
 * (e.g. codex -o outfile named after the run).
 */
export function updateAgentRunArgv(id: string, argv: string[]): void {
  getDb().prepare(`UPDATE agent_runs SET argv = ? WHERE id = ?`).run(JSON.stringify(argv), id);
}

export interface FinishAgentRunPatch {
  endedAt?: string; // defaults to now
  exitCode?: number;
  costUsd?: number;
  usage?: AgentRunUsage;
  pid?: number;
}

/** Marks a run finished (or patches pid/cost mid-flight). */
export function finishAgentRun(id: string, patch: FinishAgentRunPatch): AgentRun | undefined {
  const existing = getAgentRun(id);
  if (!existing) return undefined;
  const next: AgentRun = {
    ...existing,
    pid: patch.pid ?? existing.pid,
    endedAt: patch.endedAt ?? nowIso(),
    exitCode: patch.exitCode ?? existing.exitCode,
    costUsd: patch.costUsd ?? existing.costUsd,
    usage: patch.usage ?? existing.usage,
  };
  getDb()
    .prepare(
      `UPDATE agent_runs
       SET pid = ?, ended_at = ?, exit_code = ?, cost_usd = ?, usage = ?
       WHERE id = ?`,
    )
    .run(
      next.pid ?? null,
      next.endedAt ?? null,
      next.exitCode ?? null,
      next.costUsd ?? null,
      next.usage ? JSON.stringify(next.usage) : null,
      id,
    );
  return next;
}
