/**
 * GET /api/projects/[id]/branches — local git branches of the project
 * checkout (task-create form + Create PR dialog).
 */

import { getProject } from "@/server/db/projects";
import { apiError } from "../../../_lib/http";
import { gitErrorMessage, listBranches } from "../../../_lib/git";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  const project = getProject(id);
  if (!project) {
    return apiError(404, `Project not found: ${id}`, "not_found");
  }
  try {
    return Response.json(await listBranches(project.path));
  } catch (err) {
    return apiError(500, `git branch failed: ${gitErrorMessage(err)}`, "internal");
  }
}
