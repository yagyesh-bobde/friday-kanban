/**
 * POST /api/tasks/[id]/cancel — kill any live agent process for the task,
 * release its queue slot, and mark it idle in its current column via
 * orchestrator.cancelTask. Requires runState 'running' or 'queued'.
 */

import { getTask } from "@/server/db/tasks";
import { getOrchestrator } from "@/server/orchestrator";
import { apiError, handleRouteError } from "../../../_lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;

  const task = getTask(id);
  if (!task) {
    return apiError(404, `Task not found: ${id}`, "not_found");
  }
  if (task.runState !== "running" && task.runState !== "queued") {
    return apiError(
      409,
      `Task is '${task.runState}' — only 'running' or 'queued' tasks can be canceled`,
      "invalid_transition",
    );
  }

  try {
    const updated = await getOrchestrator().cancelTask(id);
    return Response.json(updated);
  } catch (err) {
    return handleRouteError(err);
  }
}
