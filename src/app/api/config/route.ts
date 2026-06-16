/**
 * GET /api/config — current AppConfig (defaults deep-merged on read).
 * PUT /api/config — partial update; persist, notify the orchestrator,
 *                   publish config_updated, return the full merged config.
 */

import { updateConfigInputSchema } from "@/lib/schemas";
import { getConfig, setConfig } from "@/server/db/config";
import { getOrchestrator } from "@/server/orchestrator";
import { publish } from "@/server/bus";
import { handleRouteError, isNotImplementedError, parseBody } from "../_lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  try {
    return Response.json(getConfig());
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function PUT(request: Request): Promise<Response> {
  const body = await parseBody(request, updateConfigInputSchema);
  if (!body.ok) return body.response;

  try {
    // Persist first (docs/API.md): the config change must stick even if the
    // orchestrator hook is unimplemented or fails.
    const next = setConfig(body.data);

    try {
      getOrchestrator().onConfigChanged(next);
    } catch (err) {
      if (isNotImplementedError(err)) {
        console.warn("[api/config] orchestrator.onConfigChanged not implemented yet (scaffold phase)");
      } else {
        // Config is persisted; surface the hook failure in logs, not as a 5xx.
        console.error("[api/config] orchestrator.onConfigChanged failed:", err);
      }
    }

    publish({ type: "config_updated", config: next });
    return Response.json(next);
  } catch (err) {
    return handleRouteError(err);
  }
}
