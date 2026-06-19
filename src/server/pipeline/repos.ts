/**
 * Multi-repo helpers. A project is either single-repo (`project.path` is the
 * git root) or multi-repo (`project.repos` lists git roots under the parent
 * `project.path`). These helpers let the pipeline treat both uniformly: a
 * single-repo project is just a list of one repo.
 *
 * For multi-repo projects the agent runs at the parent `project.path` (so it
 * sees every repo), while branch/commit/PR operations run per-repo against the
 * roots returned here. Multi-repo projects are constrained to `branch`
 * workspace mode + `local` execution (enforced at task creation).
 */

import type { Project, ProjectRepo, Task } from "@/lib/types";
import {
  branchExists,
  checkoutBranch,
  commitAll,
  createBranch,
  headSha,
  revList,
} from "@/server/git";

export function isMultiRepo(project: Project): boolean {
  return Array.isArray(project.repos) && project.repos.length > 0;
}

/**
 * The git repos a project's work touches. Single-repo projects collapse to a
 * one-element list pointing at `project.path`, so callers can always iterate.
 */
export function projectRepos(project: Project): ProjectRepo[] {
  if (project.repos && project.repos.length > 0) {
    return project.repos.map((r) => ({ name: r.name, path: r.path, baseBranch: r.baseBranch }));
  }
  return [{ name: project.name, path: project.path, baseBranch: project.baseBranch }];
}

/**
 * Working dirs whose commits make up a task's changes (for diffing/review).
 * Single-repo worktree tasks use the dedicated worktree path; everything else
 * uses the project's repo roots.
 */
export function taskRepoDirs(task: Task, project: Project): string[] {
  if (!isMultiRepo(project) && task.workspaceMode === "worktree" && task.worktree) {
    return [task.worktree.path];
  }
  return projectRepos(project).map((r) => r.path);
}

/**
 * The branch a task targets in a specific repo: the per-repo override when set,
 * else the task's default `branch`.
 */
export function taskBranchForRepo(task: Task, repoPath: string): string {
  return task.repoBranches?.[repoPath] ?? task.branch;
}

/** Ensure `branch` exists and is checked out in a single repo (creating it from base). */
async function ensureBranch(repo: ProjectRepo, branch: string): Promise<void> {
  if (await branchExists(repo.path, branch)) {
    await checkoutBranch(repo.path, branch);
  } else {
    const from = (await branchExists(repo.path, repo.baseBranch)) ? repo.baseBranch : undefined;
    await createBranch(repo.path, branch, from);
  }
}

/** Ensure the same `branch` exists and is checked out in every repo (branch mode). */
export async function prepareBranchInRepos(
  repos: ProjectRepo[],
  branch: string,
): Promise<void> {
  for (const repo of repos) await ensureBranch(repo, branch);
}

/**
 * Ensure each repo is on the branch the task targets there (per-repo override
 * or the task default), creating it from that repo's base where missing.
 */
export async function prepareTaskBranches(repos: ProjectRepo[], task: Task): Promise<void> {
  for (const repo of repos) await ensureBranch(repo, taskBranchForRepo(task, repo.path));
}

/** HEAD sha per repo (undefined for an unborn branch / empty repo). */
export async function repoHeadShas(
  repos: ProjectRepo[],
): Promise<Map<string, string | undefined>> {
  const map = new Map<string, string | undefined>();
  for (const repo of repos) {
    map.set(repo.path, await headSha(repo.path).catch(() => undefined));
  }
  return map;
}

/**
 * Commit any outstanding work in each repo and return the new commit shas
 * across all of them (relative to the per-repo base captured before the run).
 */
export async function commitAllRepos(
  repos: ProjectRepo[],
  message: string,
  baseShas: Map<string, string | undefined>,
): Promise<string[]> {
  const shas: string[] = [];
  for (const repo of repos) {
    await commitAll(repo.path, message);
    const base = baseShas.get(repo.path);
    if (base) shas.push(...(await revList(repo.path, base, "HEAD")));
  }
  return shas;
}
