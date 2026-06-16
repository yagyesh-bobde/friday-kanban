/**
 * POST /api/tasks/[id]/move — drag is a command (DESIGN.md decision 12).
 *
 * Dispatch table (docs/API.md):
 *   todo      -> in_dev    requires runState idle/error   -> orchestrator.startTask
 *   in_dev    -> in_review (force review)                 -> orchestrator.forceReview
 *   in_review -> in_dev    requires non-empty comment     -> orchestrator.sendBackToDev
 * Any other (from, to) pair -> 409 invalid_transition.
 */

import { moveTaskInputSchema } from "@/lib/schemas";
import { COLUMN_LABELS, LEGAL_MOVES } from "@/lib/constants";
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
  const body = await parseBody(request, moveTaskInputSchema);
  if (!body.ok) return body.response;

  const task = getTask(id);
  if (!task) {
    return apiError(404, `Task not found: ${id}`, "not_found");
  }

  const from = task.column;
  const { to, comment } = body.data;

  if (from === to) {
    return apiError(
      409,
      `Task is already in ${COLUMN_LABELS[to]}`,
      "invalid_transition",
    );
  }
  if (!LEGAL_MOVES[from].includes(to)) {
    return apiError(
      409,
      `Illegal move: ${COLUMN_LABELS[from]} → ${COLUMN_LABELS[to]}. ` +
        `Cards only move via the pipeline; legal drags are Todo → In Dev (start), ` +
        `In Dev → In Review (force review) and In Review → In Dev (send back with a comment).`,
      "invalid_transition",
    );
  }

  try {
    const orchestrator = getOrchestrator();

    if (from === "todo" && to === "in_dev") {
      if (task.runState !== "idle" && task.runState !== "error") {
        return apiError(
          409,
          `Task cannot start while its run state is '${task.runState}'`,
          "invalid_transition",
        );
      }
      return Response.json(await orchestrator.startTask(id));
    }

    if (from === "in_dev" && to === "in_review") {
      return Response.json(await orchestrator.forceReview(id));
    }

    if (from === "in_review" && to === "in_dev") {
      const trimmed = comment?.trim();
      if (!trimmed) {
        return apiError(
          400,
          "A comment is required when sending a task back to In Dev",
          "invalid_input",
        );
      }
      return Response.json(await orchestrator.sendBackToDev(id, trimmed));
    }

    // LEGAL_MOVES and the dispatch table above must stay in sync; if they
    // diverge, fail loudly rather than silently moving the card.
    return apiError(
      409,
      `Move ${COLUMN_LABELS[from]} → ${COLUMN_LABELS[to]} has no command mapped`,
      "invalid_transition",
    );
  } catch (err) {
    return handleRouteError(err);
  }
}
