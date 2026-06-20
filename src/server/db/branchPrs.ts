/**
 * Repository for `branch_prs` — one open PR per (project, branch) that bundles
 * all done tasks' commits (DESIGN.md decision 6).
 */

import { ulid } from "ulid";
import type { BranchPR } from "@/lib/types";
import { getDb, nowIso } from "./index";

interface BranchPrRow {
  id: string;
  project_id: string;
  branch: string;
  pr_url: string;
  repo_path: string;
  repo_name: string;
  created_at: string;
  updated_at: string;
}

function rowToBranchPr(row: BranchPrRow): BranchPR {
  return {
    id: row.id,
    projectId: row.project_id,
    branch: row.branch,
    prUrl: row.pr_url,
    ...(row.repo_path ? { repoPath: row.repo_path } : {}),
    ...(row.repo_name ? { repoName: row.repo_name } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getBranchPr(
  projectId: string,
  branch: string,
  repoPath = "",
): BranchPR | undefined {
  const row = getDb()
    .prepare(`SELECT * FROM branch_prs WHERE project_id = ? AND branch = ? AND repo_path = ?`)
    .get(projectId, branch, repoPath) as BranchPrRow | undefined;
  return row ? rowToBranchPr(row) : undefined;
}

export function listBranchPrs(): BranchPR[] {
  const rows = getDb().prepare(`SELECT * FROM branch_prs ORDER BY updated_at DESC`).all() as BranchPrRow[];
  return rows.map(rowToBranchPr);
}

export function listBranchPrsByProject(projectId: string): BranchPR[] {
  const rows = getDb()
    .prepare(`SELECT * FROM branch_prs WHERE project_id = ? ORDER BY updated_at DESC`)
    .all(projectId) as BranchPrRow[];
  return rows.map(rowToBranchPr);
}

/**
 * Insert or refresh the PR record for (project, branch, repo). `repoPath`/
 * `repoName` are set only for multi-repo projects; single-repo callers omit
 * them (stored as '').
 */
export function upsertBranchPr(
  projectId: string,
  branch: string,
  prUrl: string,
  repoPath = "",
  repoName = "",
): BranchPR {
  const now = nowIso();
  const existing = getBranchPr(projectId, branch, repoPath);
  if (existing) {
    getDb()
      .prepare(`UPDATE branch_prs SET pr_url = ?, updated_at = ? WHERE id = ?`)
      .run(prUrl, now, existing.id);
    return { ...existing, prUrl, updatedAt: now };
  }
  const id = ulid();
  getDb()
    .prepare(
      `INSERT INTO branch_prs (id, project_id, branch, pr_url, repo_path, repo_name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, projectId, branch, prUrl, repoPath, repoName, now, now);
  return {
    id,
    projectId,
    branch,
    prUrl,
    ...(repoPath ? { repoPath } : {}),
    ...(repoName ? { repoName } : {}),
    createdAt: now,
    updatedAt: now,
  };
}

export function deleteBranchPr(id: string): boolean {
  const res = getDb().prepare(`DELETE FROM branch_prs WHERE id = ?`).run(id);
  return res.changes > 0;
}
