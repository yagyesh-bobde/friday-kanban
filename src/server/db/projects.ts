/** Repository for the `projects` table. */

import { ulid } from "ulid";
import type { CreateProjectInput, Project, ProjectRepo } from "@/lib/types";
import { getDb, nowIso } from "./index";

interface ProjectRow {
  id: string;
  name: string;
  path: string;
  base_branch: string;
  default_execution: Project["defaultExecution"];
  repos: string | null;
  created_at: string;
}

function parseRepos(json: string | null): ProjectRepo[] | undefined {
  if (!json) return undefined;
  try {
    const parsed = JSON.parse(json) as ProjectRepo[];
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function rowToProject(row: ProjectRow): Project {
  const repos = parseRepos(row.repos);
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    baseBranch: row.base_branch,
    defaultExecution: row.default_execution,
    ...(repos ? { repos } : {}),
    createdAt: row.created_at,
  };
}

export function createProject(input: CreateProjectInput): Project {
  const repos: ProjectRepo[] | undefined =
    input.repos && input.repos.length > 0
      ? input.repos.map((r) => ({
          name: r.name,
          path: r.path,
          baseBranch: r.baseBranch ?? "main",
        }))
      : undefined;
  const project: Project = {
    id: ulid(),
    name: input.name,
    path: input.path,
    baseBranch: input.baseBranch ?? repos?.[0]?.baseBranch ?? "main",
    defaultExecution: input.defaultExecution ?? "local",
    ...(repos ? { repos } : {}),
    createdAt: nowIso(),
  };
  getDb()
    .prepare(
      `INSERT INTO projects (id, name, path, base_branch, default_execution, repos, created_at)
       VALUES (@id, @name, @path, @baseBranch, @defaultExecution, @repos, @createdAt)`,
    )
    .run({ ...project, repos: repos ? JSON.stringify(repos) : null });
  return project;
}

export function getProject(id: string): Project | undefined {
  const row = getDb().prepare(`SELECT * FROM projects WHERE id = ?`).get(id) as
    | ProjectRow
    | undefined;
  return row ? rowToProject(row) : undefined;
}

export function listProjects(): Project[] {
  const rows = getDb().prepare(`SELECT * FROM projects ORDER BY created_at ASC`).all() as ProjectRow[];
  return rows.map(rowToProject);
}

export function updateProject(
  id: string,
  patch: Partial<Pick<Project, "name" | "path" | "baseBranch" | "defaultExecution">>,
): Project | undefined {
  const existing = getProject(id);
  if (!existing) return undefined;
  const next: Project = { ...existing, ...patch };
  getDb()
    .prepare(
      `UPDATE projects
       SET name = @name, path = @path, base_branch = @baseBranch, default_execution = @defaultExecution
       WHERE id = @id`,
    )
    .run(next);
  return next;
}

/** Deletes the project and (via FK cascade) its tasks, events, runs, PRs, reports. */
export function deleteProject(id: string): boolean {
  const res = getDb().prepare(`DELETE FROM projects WHERE id = ?`).run(id);
  return res.changes > 0;
}
