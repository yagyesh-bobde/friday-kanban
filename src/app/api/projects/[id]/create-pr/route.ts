/**
 * POST /api/projects/[id]/create-pr — manual "Create PR" per project/branch
 * (DESIGN.md decision 6): bundles all done tasks' commits on the branch into
 * one PR via orchestrator.createPrForProject.
 */

import { z } from "zod";
import { getProject } from "@/server/db/projects";
import { getOrchestrator } from "@/server/orchestrator";
import { listDonePrTasks } from "@/server/pipeline/prCreator";
import { apiError, handleRouteError, parseBody } from "../../../_lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const createPrBodySchema = z.object({
  branch: z.string().min(1),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  const body = await parseBody(request, createPrBodySchema);
  if (!body.ok) return body.response;

  const project = getProject(id);
  if (!project) {
    return apiError(404, `Project not found: ${id}`, "not_found");
  }

  const { branch } = body.data;
  const doneTasks = listDonePrTasks(id, branch);
  if (doneTasks.length === 0) {
    return apiError(
      409,
      `No done tasks on ${project.name}#${branch} — nothing to bundle into a PR`,
      "invalid_transition",
    );
  }

  try {
    const branchPr = await getOrchestrator().createPrForProject(id, branch);
    return Response.json(branchPr);
  } catch (err) {
    return handleRouteError(err);
  }
}
