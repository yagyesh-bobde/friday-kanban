/**
 * GET /api/projects/[id]/branches — local git branches of the project
 * checkout (task-create form + Create PR dialog).
 */

import type { ProjectBranches, RepoBranches } from "@/lib/types";
import { getProject } from "@/server/db/projects";
import { apiError } from "../../../_lib/http";
import { gitErrorMessage, listBranches } from "../../../_lib/git";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  const project = getProject(id);
  if (!project) {
    return apiError(404, `Project not found: ${id}`, "not_found");
  }

  try {
    // Single-repo: `project.path` is the git root.
    if (!project.repos || project.repos.length === 0) {
      return Response.json(await listBranches(project.path));
    }

    // Multi-repo: a task may target a different branch per repo (or one shared
    // default created where missing). Return the UNION of branch names (for the
    // default picker) plus each repo's own branch list (for per-repo overrides).
    const all = new Set<string>();
    const repos: RepoBranches[] = [];
    let current = "";
    for (const repo of project.repos) {
      try {
        const res = await listBranches(repo.path);
        for (const b of res.branches) all.add(b);
        if (!current) current = res.current;
        repos.push({ path: repo.path, name: repo.name, branches: res.branches, current: res.current });
      } catch {
        // skip a repo we can't read; the others still populate the lists
        repos.push({ path: repo.path, name: repo.name, branches: [], current: repo.baseBranch });
      }
    }
    const result: ProjectBranches = {
      branches: [...all].sort((a, b) => a.localeCompare(b)),
      current: current || project.baseBranch,
      repos,
    };
    return Response.json(result);
  } catch (err) {
    return apiError(500, `git branch failed: ${gitErrorMessage(err)}`, "internal");
  }
}
