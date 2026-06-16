/**
 * GET    /api/tasks/[id] — full task detail (events, runs, review verdicts).
 * DELETE /api/tasks/[id] — delete a task; refused while an agent is live.
 */

import type { ReviewVerdict, TaskDetail } from "@/lib/types";
import { reviewVerdictSchema } from "@/lib/schemas";
import {
  deleteTask,
  getTask,
  listTaskEvents,
} from "@/server/db/tasks";
import { listAgentRunsByTask } from "@/server/db/agentRuns";
import { publish } from "@/server/bus";
import { apiError, handleRouteError } from "../../_lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * A review_* payload may be the verdict itself or wrap it (e.g. alongside the
 * round number) — accept both, skip anything unparseable.
 */
function extractVerdict(payload: unknown): ReviewVerdict | undefined {
  const direct = reviewVerdictSchema.safeParse(payload);
  if (direct.success) return direct.data;
  if (typeof payload === "object" && payload !== null && "verdict" in payload) {
    const nested = reviewVerdictSchema.safeParse(
      (payload as { verdict: unknown }).verdict,
    );
    if (nested.success) return nested.data;
  }
  return undefined;
}

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params;
  try {
    const task = getTask(id);
    if (!task) {
      return apiError(404, `Task not found: ${id}`, "not_found");
    }
    const events = listTaskEvents(id); // oldest-first
    const runs = listAgentRunsByTask(id); // oldest-first
    const verdicts = events
      .filter(
        (event) =>
          event.type === "review_approved" || event.type === "review_changes_requested",
      )
      .map((event) => extractVerdict(event.payload))
      .filter((verdict): verdict is ReviewVerdict => verdict !== undefined);

    const detail: TaskDetail = { task, events, runs, verdicts };
    return Response.json(detail);
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function DELETE(_request: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params;
  try {
    const task = getTask(id);
    if (!task) {
      return apiError(404, `Task not found: ${id}`, "not_found");
    }
    if (task.runState === "running" || task.runState === "queued") {
      return apiError(
        409,
        `Task is ${task.runState} — cancel it before deleting`,
        "task_running",
      );
    }
    deleteTask(id); // events/runs cascade
    publish({ type: "task_deleted", taskId: id });
    return new Response(null, { status: 204 });
  } catch (err) {
    return handleRouteError(err);
  }
}
