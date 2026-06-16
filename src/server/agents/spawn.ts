/**
 * Shared child-process spawn helper for agent CLI runs.
 *
 * Every spawn gets:
 * - argv arrays (never shell strings)
 * - a hard timeout (process killed when exceeded)
 * - a stall watchdog (no stdout activity for N ms -> killed)
 * - graceful kill handling (SIGTERM, then SIGKILL after a grace period)
 * - line-buffered stdout/stderr delivery
 */

import { spawn, type ChildProcess, type StdioOptions } from "node:child_process";
import { LineBuffer } from "./streamParser";

export const DEFAULT_STALL_TIMEOUT_MS = 10 * 60 * 1000; // 10 min without stdout
export const DEFAULT_HARD_TIMEOUT_MS = 90 * 60 * 1000; // 90 min absolute cap
const SIGKILL_GRACE_MS = 5_000;

export type SpawnEndReason = "exit" | "timeout" | "stall" | "killed" | "spawn_error";

export interface SpawnAgentOptions {
  /** argv[0] = binary, rest = args. */
  argv: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  /** 'ignore' closes stdin (required for codex exec). Default 'ignore'. */
  stdin?: "ignore" | "pipe";
  hardTimeoutMs?: number;
  stallTimeoutMs?: number;
  onStdoutChunk: (chunk: Buffer) => void;
  onStderrLine?: (line: string) => void;
}

export interface SpawnAgentExit {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  endReason: SpawnEndReason;
  /** Last ~8KB of stderr, for error surfacing. */
  stderrTail: string;
}

export interface SpawnedAgent {
  child: ChildProcess;
  pid?: number;
  /** Resolves when the process has fully exited (never rejects). */
  exited: Promise<SpawnAgentExit>;
  /** Request termination (SIGTERM, escalating to SIGKILL). Idempotent. */
  kill: (reason?: SpawnEndReason) => void;
}

const STDERR_TAIL_MAX = 8 * 1024;

export function spawnAgent(opts: SpawnAgentOptions): SpawnedAgent {
  const hardTimeoutMs = opts.hardTimeoutMs ?? DEFAULT_HARD_TIMEOUT_MS;
  const stallTimeoutMs = opts.stallTimeoutMs ?? DEFAULT_STALL_TIMEOUT_MS;

  const [bin, ...args] = opts.argv;
  if (bin === undefined) {
    throw new Error("spawnAgent: argv must not be empty");
  }
  const stdio: StdioOptions = [opts.stdin ?? "ignore", "pipe", "pipe"];
  const child: ChildProcess = spawn(bin, args, {
    cwd: opts.cwd,
    env: opts.env ?? process.env,
    stdio,
    // Own process group so a kill reaches the agent's children (claude/codex
    // fork helper + MCP subprocesses); otherwise child.kill() only signals the
    // direct child and leaves grandchildren orphaned on cancel/timeout/stall.
    detached: true,
  });

  /** Signal the whole process group, falling back to the direct child. */
  const signalTree = (sig: NodeJS.Signals): void => {
    const pid = child.pid;
    if (pid !== undefined) {
      try {
        process.kill(-pid, sig); // negative pid = the process group
        return;
      } catch {
        // group already gone / not a leader — fall through to direct kill
      }
    }
    try {
      child.kill(sig);
    } catch {
      // already dead
    }
  };

  let stderrTail = "";
  let endReason: SpawnEndReason = "exit";
  let killed = false;
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  let stallTimer: ReturnType<typeof setTimeout> | undefined;
  let hardTimer: ReturnType<typeof setTimeout> | undefined;

  const kill = (reason: SpawnEndReason = "killed"): void => {
    if (killed) return;
    killed = true;
    endReason = reason;
    signalTree("SIGTERM");
    killTimer = setTimeout(() => signalTree("SIGKILL"), SIGKILL_GRACE_MS);
    killTimer.unref?.();
  };

  const resetStallTimer = (): void => {
    if (stallTimer) clearTimeout(stallTimer);
    if (stallTimeoutMs <= 0) return;
    stallTimer = setTimeout(() => kill("stall"), stallTimeoutMs);
    stallTimer.unref?.();
  };

  if (hardTimeoutMs > 0) {
    hardTimer = setTimeout(() => kill("timeout"), hardTimeoutMs);
    hardTimer.unref?.();
  }
  resetStallTimer();

  child.stdout?.on("data", (chunk: Buffer) => {
    resetStallTimer();
    opts.onStdoutChunk(chunk);
  });

  const stderrBuffer = new LineBuffer();
  child.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf8");
    stderrTail = (stderrTail + text).slice(-STDERR_TAIL_MAX);
    if (opts.onStderrLine) {
      for (const line of stderrBuffer.push(text)) {
        if (line.trim().length > 0) opts.onStderrLine(line);
      }
    }
  });

  const exited = new Promise<SpawnAgentExit>((resolve) => {
    const finish = (exitCode: number | null, signal: NodeJS.Signals | null): void => {
      if (stallTimer) clearTimeout(stallTimer);
      if (hardTimer) clearTimeout(hardTimer);
      if (killTimer) clearTimeout(killTimer);
      resolve({ exitCode, signal, endReason, stderrTail });
    };
    child.once("error", (err) => {
      endReason = "spawn_error";
      stderrTail = (stderrTail + String(err)).slice(-STDERR_TAIL_MAX);
      finish(null, null);
    });
    child.once("close", (code, signal) => finish(code, signal));
  });

  return { child, pid: child.pid, exited, kill };
}
