/**
 * Runtime filesystem paths (server-only — uses node:os/path).
 * All friday-kanban state lives under ~/.friday-kanban/.
 */

import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import {
  DB_FILENAME,
  FRIDAY_HOME_DIRNAME,
  LOGS_DIRNAME,
  TRANSCRIPTS_DIRNAME,
  WORKTREES_DIRNAME,
} from "@/lib/constants";

export function fridayHome(): string {
  return path.join(os.homedir(), FRIDAY_HOME_DIRNAME);
}

export function dbPath(): string {
  return path.join(fridayHome(), DB_FILENAME);
}

export function worktreesDir(projectId?: string): string {
  const base = path.join(fridayHome(), WORKTREES_DIRNAME);
  return projectId ? path.join(base, projectId) : base;
}

export function transcriptsDir(taskId?: string): string {
  const base = path.join(fridayHome(), TRANSCRIPTS_DIRNAME);
  return taskId ? path.join(base, taskId) : base;
}

export function logsDir(): string {
  return path.join(fridayHome(), LOGS_DIRNAME);
}

/** Create a directory (and parents) if missing; returns the path. */
export function ensureDir(dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Ensure the full runtime directory layout exists. */
export function ensureRuntimeDirs(): void {
  ensureDir(fridayHome());
  ensureDir(worktreesDir());
  ensureDir(transcriptsDir());
  ensureDir(logsDir());
}
