/**
 * POST /api/tasks/quick-create — natural-language quick task creation (Cmd+K).
 *
 * Runs the Haiku parser over the user's text. If the parser needs clarification
 * it returns { status: "needs_input", questions } (200). If it produces a task
 * it is normalized (branch/execution defaulted from the project), created via
 * the orchestrator, and returned as { status: "created", task } (201). A parse
 * failure returns 422 so the client can fall back to the full New Task editor.
 */

import { createTaskInputSchema, quickCreateInputSchema } from "@/lib/schemas";
import type { QuickCreateResponse } from "@/lib/types";
import { listProjects } from "@/server/db/projects";
import { runTaskParser, toCreateTaskInput } from "@/server/agents/taskParser";
import { getOrchestrator } from "@/server/orchestrator";
import { apiError, handleRouteError, parseBody } from "../../_lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const body = await parseBody(request, quickCreateInputSchema);
  if (!body.ok) return body.response;

  const projects = listProjects();
  if (projects.length === 0) {
    return apiError(400, "Add a project before creating tasks.", "no_projects");
  }

  try {
    const result = await runTaskParser({
      rawText: body.data.text,
      projects,
      answers: body.data.answers,
      cwd: process.cwd(),
    });

    if (result.kind === "error") {
      return apiError(422, `Could not understand the task: ${result.reason}`, "parse_failed");
    }

    if (result.kind === "questions") {
      const payload: QuickCreateResponse = { status: "needs_input", questions: result.questions };
      return Response.json(payload, { status: 200 });
    }

    const project = projects.find((p) => p.id === result.task.projectId);
    if (!project) {
      return apiError(422, "Resolved project no longer exists.", "parse_failed");
    }

    const input = toCreateTaskInput(result.task, project);
    const validated = createTaskInputSchema.safeParse(input);
    if (!validated.success) {
      return apiError(422, "Could not build a valid task from your input.", "parse_failed");
    }

    const task = await getOrchestrator().createTask(validated.data);
    const payload: QuickCreateResponse = { status: "created", task };
    return Response.json(payload, { status: 201 });
  } catch (err) {
    return handleRouteError(err);
  }
}
