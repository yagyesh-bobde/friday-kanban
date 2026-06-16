/**
 * POST /api/tasks/[id]/retry — retry a task in runState 'error' or
 * 'needs_attention' via orchestrator.retryTask.
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
  if (task.runState !== "error" && task.runState !== "needs_attention") {
    return apiError(
      409,
      `Task is '${task.runState}' — only tasks in 'error' or 'needs_attention' can be retried`,
      "invalid_transition",
    );
  }

  try {
    const updated = await getOrchestrator().retryTask(id);
    return Response.json(updated);
  } catch (err) {
    return handleRouteError(err);
  }
}
