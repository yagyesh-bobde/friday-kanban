/**
 * GET  /api/projects — list registered projects.
 * POST /api/projects — register a local git repo as a project.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ProjectRepo } from "@/lib/types";
import { createProjectInputSchema } from "@/lib/schemas";
import { createProject, listProjects } from "@/server/db/projects";
import { publish } from "@/server/bus";
import { apiError, handleRouteError, parseBody } from "../_lib/http";
import { detectDefaultBranch, isGitRepo } from "../_lib/git";

/** Expand a leading ~ and resolve to an absolute path. */
function resolvePath(p: string): string {
  let out = p;
  if (out === "~" || out.startsWith("~/")) {
    out = path.join(os.homedir(), out.slice(1));
  }
  return path.resolve(out);
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  try {
    return Response.json(listProjects());
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function POST(request: Request): Promise<Response> {
  const body = await parseBody(request, createProjectInputSchema);
  if (!body.ok) return body.response;

  try {
    const rootPath = resolvePath(body.data.path);

    if (!path.isAbsolute(body.data.path) && !body.data.path.startsWith("~")) {
      return apiError(400, `path must be absolute: ${body.data.path}`, "invalid_input");
    }
    let stat: fs.Stats;
    try {
      stat = fs.statSync(rootPath);
    } catch {
      return apiError(400, `path does not exist: ${rootPath}`, "invalid_input");
    }
    if (!stat.isDirectory()) {
      return apiError(400, `path is not a directory: ${rootPath}`, "invalid_input");
    }

    // Multi-repo: `path` is a parent folder (need not be a git repo); validate
    // each listed sub-repo and detect its base branch. Constrained to local.
    if (body.data.repos && body.data.repos.length > 0) {
      const repos: ProjectRepo[] = [];
      for (const input of body.data.repos) {
        const repoPath = resolvePath(input.path);
        let rstat: fs.Stats;
        try {
          rstat = fs.statSync(repoPath);
        } catch {
          return apiError(400, `repo path does not exist: ${repoPath}`, "invalid_input");
        }
        if (!rstat.isDirectory()) {
          return apiError(400, `repo path is not a directory: ${repoPath}`, "invalid_input");
        }
        if (!(await isGitRepo(repoPath))) {
          return apiError(400, `repo path is not a git repository: ${repoPath}`, "invalid_input");
        }
        repos.push({
          name: input.name || path.basename(repoPath),
          path: repoPath,
          baseBranch: input.baseBranch ?? (await detectDefaultBranch(repoPath)),
        });
      }

      const project = createProject({
        name: body.data.name,
        path: rootPath,
        defaultExecution: "local", // cloud not supported for multi-repo
        repos,
      });
      publish({ type: "project_created", project });
      return Response.json(project, { status: 201 });
    }

    // Single-repo: `path` must itself be a git repo.
    if (!(await isGitRepo(rootPath))) {
      return apiError(400, `path is not a git repository: ${rootPath}`, "invalid_input");
    }

    const baseBranch = body.data.baseBranch ?? (await detectDefaultBranch(rootPath));

    const project = createProject({
      name: body.data.name,
      path: rootPath,
      baseBranch,
      defaultExecution: body.data.defaultExecution ?? "local",
    });
    publish({ type: "project_created", project });
    return Response.json(project, { status: 201 });
  } catch (err) {
    return handleRouteError(err);
  }
}
