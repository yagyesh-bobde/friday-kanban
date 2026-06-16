/**
 * GET /api/events — the board SSE stream. The UI opens exactly one
 * EventSource here and applies BoardEvents on top of its GET /api/board
 * snapshot. Unnamed `data:` messages only; `: ping` heartbeat every 25s.
 */

import { getBus } from "@/server/bus";
import { createSseResponse } from "../_lib/sse";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  return createSseResponse(request, (sse) => {
    const unsubscribe = getBus().subscribe((event) => {
      sse.sendJson(event);
    });
    return unsubscribe;
  });
}
