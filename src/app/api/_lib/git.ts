/**
 * Minimal git helpers for the API layer (project registration + branch
 * listing). Self-contained on purpose: the pipeline agent owns the richer git
 * layer in src/server/**, and the API agent must not depend on its in-flight
 * shape. Everything here is read-only `execFile('git', ...)`.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ProjectBranches } from "@/lib/types";

const execFileAsync = promisify(execFile);

/** Error shape thrown by promisified execFile when git exits non-zero. */
interface ExecError extends Error {
  stderr?: string;
}

/** Extract the most useful message from a git failure (stderr first). */
export function gitErrorMessage(err: unknown): string {
  const e = err as ExecError;
  const stderr = typeof e?.stderr === "string" ? e.stderr.trim() : "";
  if (stderr) return stderr;
  return e instanceof Error ? e.message : String(err);
}

/** Run a git command in `repoPath`; resolves with trimmed stdout. */
export async function git(repoPath: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", repoPath, ...args], {
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout.trim();
}

/** True when `dir` is inside a git work tree. */
export async function isGitRepo(dir: string): Promise<boolean> {
  try {
    return (await git(dir, ["rev-parse", "--is-inside-work-tree"])) === "true";
  } catch {
    return false;
  }
}

/**
 * Detect the repo's default branch: origin/HEAD if set, else the currently
 * checked-out branch, else 'main' (per docs/API.md).
 */
export async function detectDefaultBranch(repoPath: string): Promise<string> {
  try {
    const ref = await git(repoPath, ["symbolic-ref", "refs/remotes/origin/HEAD"]);
    const match = ref.match(/^refs\/remotes\/origin\/(.+)$/);
    if (match?.[1]) return match[1];
  } catch {
    // origin/HEAD not set — fall through
  }
  try {
    const current = await git(repoPath, ["symbolic-ref", "--short", "HEAD"]);
    if (current) return current;
  } catch {
    // detached HEAD — fall through
  }
  return "main";
}

/** Local branches + the currently checked-out one ('HEAD' when detached). */
export async function listBranches(repoPath: string): Promise<ProjectBranches> {
  const out = await git(repoPath, ["branch", "--format=%(refname:short)"]);
  const branches = out
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  let current = "";
  try {
    current = await git(repoPath, ["branch", "--show-current"]);
  } catch {
    // older git — fall back below
  }
  if (!current) {
    try {
      current = await git(repoPath, ["rev-parse", "--abbrev-ref", "HEAD"]);
    } catch {
      // empty repo with no commits — leave as HEAD
    }
  }
  return { branches, current: current || "HEAD" };
}
