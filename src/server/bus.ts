/**
 * In-process event bus feeding the SSE endpoint (GET /api/events) and any
 * server-side listeners. globalThis-cached so server.ts and Next route
 * handlers (separate module graphs, HMR re-evaluation) share ONE emitter.
 */

import { EventEmitter } from "node:events";
import type { BoardEvent } from "@/lib/types";

const BOARD_EVENT = "board-event" as const;

export class BoardBus extends EventEmitter {
  constructor() {
    super();
    // Each open SSE connection registers a listener; don't warn at 10.
    this.setMaxListeners(100);
  }

  publish(event: BoardEvent): void {
    this.emit(BOARD_EVENT, event);
  }

  /** Subscribe to all board events. Returns an unsubscribe function. */
  subscribe(listener: (event: BoardEvent) => void): () => void {
    this.on(BOARD_EVENT, listener);
    return () => this.off(BOARD_EVENT, listener);
  }
}

const GLOBAL_KEY = "__fridayKanbanBus" as const;

type GlobalWithBus = typeof globalThis & {
  [GLOBAL_KEY]?: BoardBus;
};

export function getBus(): BoardBus {
  const g = globalThis as GlobalWithBus;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new BoardBus();
  }
  return g[GLOBAL_KEY];
}

/** Convenience: publish a BoardEvent on the shared bus. */
export function publish(event: BoardEvent): void {
  getBus().publish(event);
}
