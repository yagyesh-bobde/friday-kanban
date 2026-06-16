/**
 * Custom server: ONE process hosting both the Next.js app and the
 * orchestrator singleton (process manager, SQLite, SSE bus).
 *
 *   dev:  npm run dev    (tsx server.ts, NODE_ENV != production)
 *   prod: npm run build && npm start
 *
 * The orchestrator is booted BEFORE the HTTP server starts listening so
 * crash recovery / scheduler state is consistent before any request lands.
 * Route handlers reach the same orchestrator/db/bus instances through the
 * globalThis caching pattern (see src/server/*).
 */

import { createServer } from "node:http";
import { parse } from "node:url";
import next from "next";
import { PORT } from "./src/lib/constants";
import { getOrchestrator } from "./src/server/orchestrator";
import { getScheduler } from "./src/server/pipeline/scheduler";
import { killAllProcesses } from "./src/server/pipeline/processRegistry";

const dev = process.env.NODE_ENV !== "production";
const hostname = "localhost";

async function main(): Promise<void> {
  const app = next({ dev, hostname, port: PORT });
  const handle = app.getRequestHandler();

  await app.prepare();

  // Boot the orchestrator (DB open, crash recovery, scheduler) before listening.
  await getOrchestrator().boot();

  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url ?? "/", true);
    void handle(req, res, parsedUrl).catch((err: unknown) => {
      console.error("[server] request handler error:", err);
      if (!res.headersSent) {
        res.statusCode = 500;
      }
      res.end("internal server error");
    });
  });

  // SSE connections (/api/events, /api/tasks/[id]/transcript) are long-lived.
  server.keepAliveTimeout = 0;

  server.listen(PORT, () => {
    console.log(`[friday-kanban] ready at http://${hostname}:${PORT} (${dev ? "dev" : "production"})`);
  });

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[friday-kanban] ${signal} received, shutting down`);
    // Stop draining new work and kill in-flight agent processes (+ their
    // child trees) so we don't orphan claude/codex on exit. Boot-time crash
    // recovery reconciles any task left mid-run.
    try {
      getScheduler().stop();
      killAllProcesses();
    } catch (err) {
      console.error("[friday-kanban] shutdown cleanup error:", err);
    }
    server.close(() => process.exit(0));
    // Force-exit if connections (e.g. open SSE streams) keep us alive.
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err: unknown) => {
  console.error("[friday-kanban] failed to start:", err);
  process.exit(1);
});
