/**
 * GET  /api/projects — list registered projects.
 * POST /api/projects — register a local git repo as a project.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createProjectInputSchema } from "@/lib/schemas";
import { createProject, listProjects } from "@/server/db/projects";
import { publish } from "@/server/bus";
import { apiError, handleRouteError, parseBody } from "../_lib/http";
import { detectDefaultBranch, isGitRepo } from "../_lib/git";

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
    // Convenience: expand a leading ~ before the absolute-path check.
    let repoPath = body.data.path;
    if (repoPath === "~" || repoPath.startsWith("~/")) {
      repoPath = path.join(os.homedir(), repoPath.slice(1));
    }
    repoPath = path.resolve(repoPath);

    if (!path.isAbsolute(body.data.path) && !body.data.path.startsWith("~")) {
      return apiError(400, `path must be absolute: ${body.data.path}`, "invalid_input");
    }
    let stat: fs.Stats;
    try {
      stat = fs.statSync(repoPath);
    } catch {
      return apiError(400, `path does not exist: ${repoPath}`, "invalid_input");
    }
    if (!stat.isDirectory()) {
      return apiError(400, `path is not a directory: ${repoPath}`, "invalid_input");
    }
    if (!(await isGitRepo(repoPath))) {
      return apiError(400, `path is not a git repository: ${repoPath}`, "invalid_input");
    }

    const baseBranch = body.data.baseBranch ?? (await detectDefaultBranch(repoPath));

    const project = createProject({
      name: body.data.name,
      path: repoPath,
      baseBranch,
      defaultExecution: body.data.defaultExecution ?? "local",
    });
    publish({ type: "project_created", project });
    return Response.json(project, { status: 201 });
  } catch (err) {
    return handleRouteError(err);
  }
}
