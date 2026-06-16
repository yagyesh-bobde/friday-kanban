/**
 * GET /api/board — the single snapshot the UI hydrates from on load
 * (afterwards it applies BoardEvents from GET /api/events on top).
 */

import type { BoardSnapshot } from "@/lib/types";
import { listProjects } from "@/server/db/projects";
import { listTasks } from "@/server/db/tasks";
import { listBranchPrs } from "@/server/db/branchPrs";
import { getConfig } from "@/server/db/config";
import { handleRouteError } from "../_lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  try {
    const snapshot: BoardSnapshot = {
      projects: listProjects(),
      tasks: listTasks(),
      branchPrs: listBranchPrs(),
      config: getConfig(),
    };
    return Response.json(snapshot);
  } catch (err) {
    return handleRouteError(err);
  }
}
