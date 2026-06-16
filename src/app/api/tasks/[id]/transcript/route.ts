/**
 * GET /api/tasks/[id]/transcript — SSE replay + live stream of the task's
 * parsed transcript.
 *
 * 1. Replay: read every persisted agent-run NDJSON (oldest run first) and
 *    project each line into TranscriptItems (_lib/transcript.ts).
 * 2. Live: forward `transcript_item` bus events for this task.
 * 3. Close: once the task has no live run AND a final `result` item has been
 *    sent. (A task that has not run yet keeps the stream open so the drawer
 *    can be opened before starting it.)
 *
 * To avoid a replay/live gap, the bus subscription starts BEFORE the files
 * are read; live items arriving during replay are buffered and flushed after
 * (a rare duplicate item is acceptable; a hole is not).
 */

import fs from "node:fs/promises";
import type { TranscriptItem } from "@/lib/types";
import { getTask } from "@/server/db/tasks";
import { listAgentRunsByTask } from "@/server/db/agentRuns";
import { getBus } from "@/server/bus";
import { apiError } from "../../../_lib/http";
import { createSseResponse } from "../../../_lib/sse";
import { parseTranscriptLine } from "../../../_lib/transcript";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;

  const task = getTask(id);
  if (!task) {
    return apiError(404, `Task not found: ${id}`, "not_found");
  }

  return createSseResponse(request, async (sse) => {
    let replaying = true;
    let resultSent = false;
    const buffered: TranscriptItem[] = [];

    const taskIsLive = (): boolean => {
      const current = getTask(id);
      return (
        current !== undefined &&
        (current.runState === "running" || current.runState === "queued")
      );
    };

    const emit = (item: TranscriptItem) => {
      sse.sendJson(item);
      if (item.kind === "result") resultSent = true;
    };

    const maybeClose = () => {
      if (!sse.closed && resultSent && !taskIsLive()) sse.close();
    };

    // Subscribe first so nothing published during replay is lost.
    const unsubscribe = getBus().subscribe((event) => {
      if (sse.closed) return;
      if (event.type === "transcript_item" && event.taskId === id) {
        if (replaying) {
          buffered.push(event.item);
        } else {
          emit(event.item);
          maybeClose();
        }
      } else if (event.type === "task_updated" && event.task.id === id && !replaying) {
        // runState may settle slightly after the final result item.
        maybeClose();
      }
    });

    // Replay persisted transcripts, oldest run first.
    const runs = listAgentRunsByTask(id);
    for (const run of runs) {
      if (sse.closed) break;
      let content: string;
      try {
        content = await fs.readFile(run.transcriptPath, "utf8");
      } catch {
        continue; // transcript file missing/unreadable — skip this run
      }
      for (const line of content.split("\n")) {
        if (sse.closed) break;
        for (const item of parseTranscriptLine(line, run.startedAt)) {
          emit(item);
        }
      }
    }

    // Flush anything that arrived live while we were reading files.
    replaying = false;
    for (const item of buffered) {
      if (sse.closed) break;
      emit(item);
    }
    buffered.length = 0;
    maybeClose();

    return unsubscribe;
  });
}
