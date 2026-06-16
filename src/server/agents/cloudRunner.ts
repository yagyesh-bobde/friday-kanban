/**
 * Cloud runner — the ONLY module that touches node-pty. `claude --remote`
 * hard-requires a TTY (verified), so the launcher runs under a pty. The flow:
 *
 *   1. (caller) push the task branch to origin
 *   2. launchRemoteSession(): pty-spawn `claude --remote "<prompt>"`,
 *      capture the cse_ session id from the output
 *   3. pollForRemoteResult(): watch origin for the new claude/* branch and
 *      its PR via git ls-remote + gh
 *   4. sendRemoteFeedback(): review feedback goes back as a NEW remote prompt
 *      referencing the PR/branch (remote sessions get no --resume continuity)
 *
 * This module is deliberately self-contained: the local pipeline never
 * imports it (only cloudPipeline.ts does).
 */

import fs from "node:fs";
import path from "node:path";
import * as pty from "node-pty";
import type { ModelSpec } from "@/lib/types";
import {
  createAgentRun,
  finishAgentRun,
  updateAgentRunPid,
  updateAgentRunTranscriptPath,
} from "@/server/db/agentRuns";
import { ensureDir, transcriptsDir } from "@/server/paths";
import { registerProcess } from "@/server/pipeline/processRegistry";
import { listRemoteHeads, prList } from "@/server/git";

const CSE_ID_RE = /\bcse_[A-Za-z0-9_-]+/;
const LAUNCH_HARD_TIMEOUT_MS = 30 * 60 * 1000;
const LAUNCH_STALL_TIMEOUT_MS = 10 * 60 * 1000;
const POLL_INTERVAL_MS = 30_000;
const DEFAULT_POLL_TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2h for the VM to finish

export interface CloudLaunchParams {
  taskId: string;
  /** Prompt for the remote session. */
  prompt: string;
  /** cwd whose GitHub remote / current branch seed the session. */
  cwd: string;
  spec: ModelSpec;
}

export interface CloudLaunchResult {
  runId: string;
  /** cse_... session id, when captured from the CLI output. */
  remoteSessionId?: string;
  exitCode: number | null;
  failureReason?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Spawn `claude --remote "<prompt>"` under a pty, capture the cse_ session id,
 * and wait for the CLI to exit. Raw pty output is archived as the run's
 * transcript (plain text, not NDJSON — remote sessions stream no local JSON).
 */
export async function launchRemoteSession(params: CloudLaunchParams): Promise<CloudLaunchResult> {
  const dir = ensureDir(transcriptsDir());
  const argv = ["claude", "--remote", params.prompt];
  const run = createAgentRun({
    taskId: params.taskId,
    role: "implementer",
    spec: params.spec,
    argv,
    transcriptPath: "",
  });
  const transcriptPath = path.join(dir, `${run.id}.remote.log`);
  updateAgentRunTranscriptPath(run.id, transcriptPath);
  const transcript = fs.createWriteStream(transcriptPath, { flags: "a" });

  const [bin, ...args] = argv;
  let proc: pty.IPty;
  try {
    proc = pty.spawn(bin ?? "claude", args, {
      name: "xterm-256color",
      cols: 200,
      rows: 50,
      cwd: params.cwd,
      env: process.env as Record<string, string>,
    });
  } catch (err) {
    transcript.end();
    finishAgentRun(run.id, { exitCode: undefined });
    return {
      runId: run.id,
      exitCode: null,
      failureReason: `failed to spawn claude --remote under pty: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  updateAgentRunPid(run.id, proc.pid);

  let remoteSessionId: string | undefined;
  let killedFor: "stall" | "timeout" | "canceled" | undefined;
  let stallTimer: ReturnType<typeof setTimeout> | undefined;

  const kill = (reason: "stall" | "timeout" | "canceled"): void => {
    if (killedFor) return;
    killedFor = reason;
    try {
      proc.kill();
    } catch {
      // already dead
    }
  };

  const resetStall = (): void => {
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = setTimeout(() => kill("stall"), LAUNCH_STALL_TIMEOUT_MS);
    stallTimer.unref?.();
  };
  resetStall();
  const hardTimer = setTimeout(() => kill("timeout"), LAUNCH_HARD_TIMEOUT_MS);
  hardTimer.unref?.();

  const unregister = registerProcess(params.taskId, () => kill("canceled"));

  const exitCode = await new Promise<number | null>((resolve) => {
    proc.onData((data) => {
      resetStall();
      transcript.write(data);
      if (!remoteSessionId) {
        const match = CSE_ID_RE.exec(data);
        if (match) remoteSessionId = match[0];
      }
    });
    proc.onExit(({ exitCode: code }) => resolve(code ?? null));
  });

  unregister();
  if (stallTimer) clearTimeout(stallTimer);
  clearTimeout(hardTimer);
  transcript.end();
  finishAgentRun(run.id, { exitCode: exitCode ?? undefined });

  let failureReason: string | undefined;
  if (killedFor === "stall") failureReason = "claude --remote produced no output (stall watchdog)";
  else if (killedFor === "timeout") failureReason = "claude --remote exceeded the launch time limit";
  else if (killedFor === "canceled") failureReason = "remote launch was canceled";
  else if (!remoteSessionId) {
    failureReason = `claude --remote exited (code ${exitCode ?? "?"}) without printing a cse_ session id`;
  }

  return { runId: run.id, remoteSessionId, exitCode, failureReason };
}

export interface RemotePollParams {
  /** Project checkout used for git ls-remote / gh calls. */
  cwd: string;
  /** Remote claude/* heads snapshot taken BEFORE the launch. */
  headsBefore: string[];
  /** Returns true when polling should stop (e.g. task canceled). */
  shouldAbort?: () => boolean;
  timeoutMs?: number;
}

export interface RemotePollResult {
  /** The new remote branch the cloud session produced. */
  branch?: string;
  /** PR opened by the cloud session for that branch, when found. */
  prUrl?: string;
  prNumber?: number;
  failureReason?: string;
}

/** Snapshot the current claude/* remote heads (call before launching). */
export async function snapshotRemoteHeads(cwd: string): Promise<string[]> {
  try {
    return await listRemoteHeads(cwd, "claude/*");
  } catch {
    return [];
  }
}

/**
 * Poll GitHub (via git ls-remote + gh pr list) until the cloud session's
 * result branch appears; then keep polling briefly for its PR.
 */
export async function pollForRemoteResult(params: RemotePollParams): Promise<RemotePollResult> {
  const timeoutMs = params.timeoutMs ?? DEFAULT_POLL_TIMEOUT_MS;
  const before = new Set(params.headsBefore);
  const deadline = Date.now() + timeoutMs;

  let branch: string | undefined;

  while (Date.now() < deadline) {
    if (params.shouldAbort?.()) return { failureReason: "polling aborted (task canceled)" };

    if (!branch) {
      const heads = await listRemoteHeads(params.cwd, "claude/*").catch(() => [] as string[]);
      branch = heads.find((h) => !before.has(h));
    }

    if (branch) {
      const prs = await prList(params.cwd, { head: branch, state: "all" }).catch(
        () => [] as Awaited<ReturnType<typeof prList>>,
      );
      const pr = prs[0];
      if (pr) {
        return { branch, prUrl: pr.url, prNumber: pr.number };
      }
    }

    await sleep(POLL_INTERVAL_MS);
  }

  if (branch) {
    // Branch arrived but no PR — still a usable result.
    return { branch };
  }
  return { failureReason: "timed out waiting for the cloud session's branch/PR on GitHub" };
}

export interface RemoteFeedbackParams {
  taskId: string;
  cwd: string;
  spec: ModelSpec;
  /** The cse_ id of the original session (referenced in the prompt). */
  remoteSessionId?: string;
  /** PR / branch produced by the original session. */
  prUrl?: string;
  branch?: string;
  /** Review findings rendered as markdown. */
  feedbackMarkdown: string;
}

/**
 * Send review feedback back to the cloud as a NEW remote prompt. Remote
 * sessions have no cross-process --resume, so the prompt carries the PR /
 * branch context explicitly and instructs the session to push fixes there.
 */
export async function sendRemoteFeedback(params: RemoteFeedbackParams): Promise<CloudLaunchResult> {
  const prompt = [
    "You are continuing work on an existing cloud coding session" +
      (params.remoteSessionId ? ` (original session ${params.remoteSessionId})` : "") +
      ".",
    params.branch ? `Check out the existing branch \`${params.branch}\` and work on it.` : "",
    params.prUrl ? `The work lives in this pull request: ${params.prUrl}` : "",
    "",
    "A code reviewer examined the changes and requested changes. Address each blocking",
    "item below, commit your fixes to the SAME branch, and push so the pull request updates.",
    "",
    params.feedbackMarkdown.trim(),
  ]
    .filter((l) => l !== "")
    .join("\n");

  return launchRemoteSession({
    taskId: params.taskId,
    prompt,
    cwd: params.cwd,
    spec: params.spec,
  });
}
