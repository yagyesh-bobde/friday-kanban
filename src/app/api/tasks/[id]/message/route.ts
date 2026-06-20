/**
 * POST /api/tasks/[id]/message — send a free-form user message to a task.
 *
 * - runState 'running': mid-task chat. The live agent is interrupted and the
 *   pipeline resumes the same session with the message (orchestrator.messageRunningTask).
 * - runState 'error' | 'needs_attention': resume the stopped task with the
 *   message as a directive (orchestrator.resumeWithMessage). Like retry, but the
 *   user says what to do instead of a blind re-run.
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
  if (
    task.runState !== "running" &&
    task.runState !== "error" &&
    task.runState !== "needs_attention"
  ) {
    return apiError(
      409,
      `Task is '${task.runState}' — a message can only be sent to a task that is 'running', 'error', or 'needs_attention'`,
      "invalid_transition",
    );
  }

  try {
    const orchestrator = getOrchestrator();
    const updated =
      task.runState === "running"
        ? await orchestrator.messageRunningTask(id, body.data.message)
        : await orchestrator.resumeWithMessage(id, body.data.message);
    return Response.json(updated);
  } catch (err) {
    return handleRouteError(err);
  }
}
