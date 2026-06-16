/**
 * Git + gh plumbing. Everything goes through execFile with argv arrays —
 * never shell strings. All functions take an explicit cwd (project checkout
 * or worktree).
 */

import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { WorktreeInfo } from "@/lib/types";
import { ensureDir, worktreesDir } from "@/server/paths";

const execFileAsync = promisify(execFile);

const GIT_TIMEOUT_MS = 60_000;
const GH_TIMEOUT_MS = 120_000;
const MAX_BUFFER = 32 * 1024 * 1024; // diffs can be large

export class GitError extends Error {
  constructor(
    message: string,
    public readonly cmd: string,
    public readonly stderr: string,
  ) {
    super(message);
    this.name = "GitError";
  }
}

async function run(
  bin: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
): Promise<string> {
  try {
    const { stdout } = await execFileAsync(bin, args, {
      cwd,
      timeout: timeoutMs,
      maxBuffer: MAX_BUFFER,
      env: process.env,
    });
    return stdout;
  } catch (err) {
    const e = err as { stderr?: string; message?: string };
    const stderr = (e.stderr ?? "").trim();
    throw new GitError(
      `${bin} ${args.join(" ")} failed: ${stderr || e.message || "unknown error"}`,
      `${bin} ${args.join(" ")}`,
      stderr,
    );
  }
}

export async function git(cwd: string, args: string[]): Promise<string> {
  return run("git", args, cwd, GIT_TIMEOUT_MS);
}

export async function gh(cwd: string, args: string[]): Promise<string> {
  return run("gh", args, cwd, GH_TIMEOUT_MS);
}

// ---------------------------------------------------------------------------
// Branches
// ---------------------------------------------------------------------------

export async function listBranches(cwd: string): Promise<{ branches: string[]; current: string }> {
  const out = await git(cwd, ["branch", "--format=%(refname:short)"]);
  const branches = out
    .split("\n")
    .map((b) => b.trim())
    .filter((b) => b.length > 0 && !b.startsWith("("));
  const current = await currentBranch(cwd);
  return { branches, current };
}

export async function currentBranch(cwd: string): Promise<string> {
  return (await git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
}

export async function isGitRepo(dir: string): Promise<boolean> {
  try {
    await git(dir, ["rev-parse", "--git-dir"]);
    return true;
  } catch {
    return false;
  }
}

/** True when the working tree has no staged or unstaged changes. */
export async function isClean(cwd: string): Promise<boolean> {
  const out = await git(cwd, ["status", "--porcelain"]);
  return out.trim().length === 0;
}

/** Throws GitError when the working tree is dirty. */
export async function ensureClean(cwd: string): Promise<void> {
  if (!(await isClean(cwd))) {
    throw new GitError(`working tree at ${cwd} is dirty`, "git status --porcelain", "");
  }
}

export async function branchExists(cwd: string, branch: string): Promise<boolean> {
  try {
    await git(cwd, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check out `branch`. No-op if already on it. When switching with a dirty
 * tree git itself refuses — the error propagates as GitError.
 */
export async function checkoutBranch(cwd: string, branch: string): Promise<void> {
  if ((await currentBranch(cwd)) === branch) return;
  await git(cwd, ["checkout", branch]);
}

/** Create `branch` at `from` (default HEAD) and check it out. */
export async function createBranch(cwd: string, branch: string, from?: string): Promise<void> {
  const args = ["checkout", "-b", branch];
  if (from) args.push(from);
  await git(cwd, args);
}

// ---------------------------------------------------------------------------
// Worktrees (adjective-noun namer)
// ---------------------------------------------------------------------------

const ADJECTIVES = [
  "swift", "quiet", "bold", "amber", "lunar", "brisk", "calm", "clever",
  "crimson", "dapper", "eager", "fuzzy", "gentle", "golden", "hidden",
  "jolly", "keen", "lively", "mellow", "noble", "polar", "rapid", "silent",
  "sunny", "tidy", "vivid", "wild", "zesty",
];

const NOUNS = [
  "falcon", "otter", "maple", "comet", "harbor", "badger", "cedar", "delta",
  "ember", "fjord", "gecko", "heron", "iris", "jaguar", "kestrel", "lemur",
  "meadow", "nimbus", "osprey", "puffin", "quartz", "raven", "sparrow",
  "tundra", "vortex", "walrus", "yarrow", "zephyr",
];

function randomOf<T>(arr: readonly T[]): T {
  const item = arr[Math.floor(Math.random() * arr.length)];
  if (item === undefined) throw new Error("randomOf: empty array");
  return item;
}

/** Generate an adjective-noun worktree name not yet used for the project. */
export function generateWorktreeName(projectId: string): string {
  const base = worktreesDir(projectId);
  for (let i = 0; i < 50; i++) {
    const name = `${randomOf(ADJECTIVES)}-${randomOf(NOUNS)}`;
    if (!fs.existsSync(path.join(base, name))) return name;
  }
  return `${randomOf(ADJECTIVES)}-${randomOf(NOUNS)}-${Date.now().toString(36)}`;
}

/**
 * Create a worktree under ~/.friday-kanban/worktrees/<projectId>/<name> on a
 * new branch friday/<name> based at `baseRef`.
 */
export async function worktreeAdd(
  projectPath: string,
  projectId: string,
  baseRef: string,
): Promise<WorktreeInfo> {
  const name = generateWorktreeName(projectId);
  const branch = `friday/${name}`;
  const wtPath = path.join(ensureDir(worktreesDir(projectId)), name);
  await git(projectPath, ["worktree", "add", "-b", branch, wtPath, baseRef]);
  return { name, path: wtPath, branch };
}

/** Remove a worktree directory (force) and prune stale registrations. */
export async function worktreeRemove(projectPath: string, worktreePath: string): Promise<void> {
  try {
    await git(projectPath, ["worktree", "remove", "--force", worktreePath]);
  } finally {
    await git(projectPath, ["worktree", "prune"]).catch(() => undefined);
  }
}

/** Validate a previously created worktree is still usable. */
export async function worktreeIsValid(worktree: WorktreeInfo): Promise<boolean> {
  if (!fs.existsSync(worktree.path)) return false;
  try {
    const branch = await currentBranch(worktree.path);
    return branch === worktree.branch;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Commits / diffs
// ---------------------------------------------------------------------------

export async function headSha(cwd: string): Promise<string> {
  return (await git(cwd, ["rev-parse", "HEAD"])).trim();
}

/**
 * Stage everything and commit. Returns the new commit sha, or undefined when
 * there was nothing to commit.
 */
export async function commitAll(cwd: string, message: string): Promise<string | undefined> {
  await git(cwd, ["add", "-A"]);
  const staged = await git(cwd, ["diff", "--cached", "--name-only"]);
  if (staged.trim().length === 0) return undefined;
  await git(cwd, ["commit", "-m", message]);
  return headSha(cwd);
}

/** Commits reachable from `head` but not `base`, oldest first. */
export async function revList(cwd: string, base: string, head: string): Promise<string[]> {
  const out = await git(cwd, ["rev-list", "--reverse", `${base}..${head}`]);
  return out
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Unified diff between two refs (three-dot excluded on purpose: exact range). */
export async function diffRange(cwd: string, base: string, head: string): Promise<string> {
  return git(cwd, ["diff", `${base}..${head}`]);
}

/** Patch (with stats) of a single commit — used to assemble per-task diffs. */
export async function showCommit(cwd: string, sha: string): Promise<string> {
  return git(cwd, ["show", "--stat", "--patch", "--no-color", sha]);
}

/** `git log` passthrough used by the status reports. */
export async function gitLog(cwd: string, args: string[]): Promise<string> {
  return git(cwd, ["log", ...args]);
}

// ---------------------------------------------------------------------------
// Remotes / push
// ---------------------------------------------------------------------------

export async function hasRemote(cwd: string): Promise<boolean> {
  const out = await git(cwd, ["remote"]);
  return out.trim().length > 0;
}

export async function push(cwd: string, branch: string): Promise<void> {
  await git(cwd, ["push", "--set-upstream", "origin", branch]);
}

/** Remote heads matching a pattern, e.g. 'claude/*' — used by the cloud poller. */
export async function listRemoteHeads(cwd: string, pattern: string): Promise<string[]> {
  const out = await git(cwd, ["ls-remote", "--heads", "origin", pattern]);
  return out
    .split("\n")
    .map((line) => line.split("\t")[1])
    .filter((ref): ref is string => typeof ref === "string" && ref.length > 0)
    .map((ref) => ref.replace(/^refs\/heads\//, ""));
}

// ---------------------------------------------------------------------------
// gh wrappers
// ---------------------------------------------------------------------------

export interface PrSummary {
  number: number;
  url: string;
  title: string;
  headRefName: string;
  state: string;
}

export async function prCreate(
  cwd: string,
  opts: { title: string; body: string; head: string; base?: string },
): Promise<string> {
  const args = ["pr", "create", "--title", opts.title, "--body", opts.body, "--head", opts.head];
  if (opts.base) args.push("--base", opts.base);
  const out = await gh(cwd, args);
  // gh prints the PR URL as the last non-empty line.
  const lines = out
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const url = lines.reverse().find((l) => l.startsWith("http"));
  if (!url) throw new GitError("gh pr create did not return a URL", "gh pr create", out);
  return url;
}

export async function prList(
  cwd: string,
  opts: { head?: string; state?: "open" | "closed" | "merged" | "all"; search?: string } = {},
): Promise<PrSummary[]> {
  const args = ["pr", "list", "--json", "number,url,title,headRefName,state", "--limit", "50"];
  if (opts.head) args.push("--head", opts.head);
  if (opts.state) args.push("--state", opts.state);
  if (opts.search) args.push("--search", opts.search);
  const out = await gh(cwd, args);
  try {
    return JSON.parse(out) as PrSummary[];
  } catch {
    return [];
  }
}

export async function prDiff(cwd: string, ref: string | number): Promise<string> {
  return gh(cwd, ["pr", "diff", String(ref)]);
}

export async function prView(
  cwd: string,
  ref: string | number,
): Promise<PrSummary & { body: string; headRefOid: string }> {
  const out = await gh(cwd, [
    "pr",
    "view",
    String(ref),
    "--json",
    "number,url,title,headRefName,state,body,headRefOid",
  ]);
  return JSON.parse(out) as PrSummary & { body: string; headRefOid: string };
}

export async function prEditBody(cwd: string, ref: string | number, body: string): Promise<void> {
  await gh(cwd, ["pr", "edit", String(ref), "--body", body]);
}

export async function prComment(cwd: string, ref: string | number, body: string): Promise<void> {
  await gh(cwd, ["pr", "comment", String(ref), "--body", body]);
}
