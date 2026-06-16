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

  if (!getProject(body.data.projectId)) {
    return apiError(404, `Project not found: ${body.data.projectId}`, "not_found");
  }

  try {
    const task = await getOrchestrator().createTask(body.data);
    return Response.json(task, { status: 201 });
  } catch (err) {
    return handleRouteError(err);
  }
}
