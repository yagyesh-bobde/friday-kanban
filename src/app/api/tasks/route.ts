/**
 * POST /api/tasks — create a task in todo/idle via orchestrator.createTask
 * (persists, publishes task_created, auto-scheduler may pick it up).
 */

import { createTaskInputSchema } from "@/lib/schemas";
import { getProject } from "@/server/db/projects";
import { getOrchestrator } from "@/server/orchestrator";
import { apiError, handleRouteError, parseBody } from "../_lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const body = await parseBody(request, createTaskInputSchema);
  if (!body.ok) return body.response;

  const project = getProject(body.data.projectId);
  if (!project) {
    return apiError(404, `Project not found: ${body.data.projectId}`, "not_found");
  }

  // Multi-repo projects run a single agent across all sub-repos: only `branch`
  // workspace mode + `local` execution are supported (worktrees/cloud assume a
  // single git root). Coerce rather than reject so older clients keep working.
  const input =
    project.repos && project.repos.length > 0
      ? { ...body.data, workspaceMode: "branch" as const, execution: "local" as const }
      : body.data;

  try {
    const task = await getOrchestrator().createTask(input);
    return Response.json(task, { status: 201 });
  } catch (err) {
    return handleRouteError(err);
  }
}
