/**
 * GET /api/status-reports — today's per-project standup pane. Delegates to
 * orchestrator.getOrGenerateStatusReports() (may take seconds on the first
 * board load of the day while haiku summarizes).
 */

import { getOrchestrator } from "@/server/orchestrator";
import { handleRouteError } from "../_lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  try {
    const reports = await getOrchestrator().getOrGenerateStatusReports();
    return Response.json(reports);
  } catch (err) {
    return handleRouteError(err);
  }
}
