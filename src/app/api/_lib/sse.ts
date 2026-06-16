/**
 * SSE plumbing shared by GET /api/events and GET /api/tasks/[id]/transcript.
 *
 * Wire format (docs/API.md):
 *   - unnamed messages only:  `data: <JSON>\n\n`  (clients listen on `message`)
 *   - heartbeat comment       `: ping\n\n`        every 25 seconds
 *
 * The helper owns the ReadableStream lifecycle: heartbeat interval, abort
 * handling (request.signal), idempotent teardown, and the cleanup function
 * returned by the route's init callback (typically a bus unsubscribe).
 */

export const SSE_HEARTBEAT_MS = 25_000;

export interface SseSession {
  /** Send one SSE data message (`data: <JSON>\n\n`). No-op once closed. */
  sendJson(data: unknown): void;
  /** Send an SSE comment line (`: <text>\n\n`). No-op once closed. */
  sendComment(text: string): void;
  /** Close the stream (idempotent; runs the registered cleanup). */
  close(): void;
  readonly closed: boolean;
}

/**
 * Build a `text/event-stream` Response. `init` is called once the stream
 * starts; it may return a cleanup function which runs exactly once on
 * teardown (client abort, server close, or stream cancel).
 */
export function createSseResponse(
  request: Request,
  init: (sse: SseSession) => void | (() => void) | Promise<void | (() => void)>,
): Response {
  const encoder = new TextEncoder();
  let closed = false;
  let cleanup: (() => void) | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let teardown: () => void = () => {
    closed = true;
  };

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      teardown = () => {
        if (closed) return;
        closed = true;
        if (heartbeat !== undefined) clearInterval(heartbeat);
        request.signal.removeEventListener("abort", teardown);
        try {
          cleanup?.();
        } catch (err) {
          console.error("[sse] cleanup failed:", err);
        }
        try {
          controller.close();
        } catch {
          // controller already closed/errored — nothing to do
        }
      };

      const write = (text: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          // enqueue after the client vanished — tear everything down
          teardown();
        }
      };

      const sse: SseSession = {
        get closed() {
          return closed;
        },
        sendJson: (data) => write(`data: ${JSON.stringify(data)}\n\n`),
        sendComment: (text) => write(`: ${text}\n\n`),
        close: () => teardown(),
      };

      if (request.signal.aborted) {
        teardown();
        return;
      }
      request.signal.addEventListener("abort", teardown);
      heartbeat = setInterval(() => sse.sendComment("ping"), SSE_HEARTBEAT_MS);

      try {
        const result = await init(sse);
        if (typeof result === "function") {
          cleanup = result;
          // init finished after the client already disconnected: run it now.
          if (closed) {
            cleanup = undefined;
            result();
          }
        }
      } catch (err) {
        console.error("[sse] init failed:", err);
        teardown();
      }
    },
    cancel() {
      teardown();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
