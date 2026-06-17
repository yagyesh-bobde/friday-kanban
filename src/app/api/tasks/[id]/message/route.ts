/**
 * POST /api/tasks/[id]/message — resume a stopped task (runState 'error' or
 * 'needs_attention') with a free-form user message handed to the agent as a
 * directive, via orchestrator.resumeWithMessage. Like retry, but the user says
 * what to do instead of a blind re-run.
 */

import { sendMessageInputSchema } from "@/lib/schemas";
import { getTask } from "@/server/db/tasks";
import { getOrchestrator } from "@/server/orchestrator";
import { apiError, handleRouteError, parseBody } from "../../../_lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  const body = await parseBody(request, sendMessageInputSchema);
  if (!body.ok) return body.response;

  const task = getTask(id);
  if (!task) {
    return apiError(404, `Task not found: ${id}`, "not_found");
  }
  if (task.runState !== "error" && task.runState !== "needs_attention") {
    return apiError(
      409,
      `Task is '${task.runState}' — a message can only be sent to a task in 'error' or 'needs_attention'`,
      "invalid_transition",
    );
  }

  try {
    const updated = await getOrchestrator().resumeWithMessage(id, body.data.message);
    return Response.json(updated);
  } catch (err) {
    return handleRouteError(err);
  }
}
