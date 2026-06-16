/**
 * Shared presentational helpers for the UI layer.
 */

import { clsx, type ClassValue } from "clsx";
import { LEGAL_MOVES } from "@/lib/constants";
import type { AgentColumn, AppConfig, Column, ModelSpec, Task } from "@/lib/types";

export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export function formatCost(usd: number): string {
  if (!usd || usd <= 0) return "";
  if (usd < 0.01) return "<$0.01";
  return `$${usd.toFixed(2)}`;
}

export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (secs < 45) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function formatClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/** Truncate a one-line preview of arbitrary tool input/output. */
export function previewJson(value: unknown, max = 140): string {
  let text: string;
  if (typeof value === "string") text = value;
  else {
    try {
      text = JSON.stringify(value);
    } catch {
      text = String(value);
    }
  }
  if (!text) return "";
  text = text.replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

// ---------------------------------------------------------------------------
// Project chip color — stable hue from the project id
// ---------------------------------------------------------------------------

export function projectHue(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return hash % 360;
}

export function projectColor(id: string): string {
  return `hsl(${projectHue(id)} 65% 62%)`;
}

// ---------------------------------------------------------------------------
// Model spec resolution (task override -> column default)
// ---------------------------------------------------------------------------

export function resolveSpec(
  task: Task,
  config: AppConfig,
  column: AgentColumn,
): ModelSpec {
  return task.modelOverrides?.[column] ?? config.columnDefaults[column];
}

/** Which agent column's model is relevant for the card's current position. */
export function activeAgentColumn(column: Column): AgentColumn {
  return column === "in_review" ? "in_review" : "in_dev";
}

export function specLabel(spec: ModelSpec): string {
  return `${spec.model}·${spec.effort}`;
}

// ---------------------------------------------------------------------------
// Drag legality (drag is a command — DESIGN.md decision 12)
// ---------------------------------------------------------------------------

/**
 * Columns this task may legally be dragged to right now. Mirrors the
 * dispatch-table requirements in docs/API.md; the server remains the
 * authority (optimistic moves roll back on 409).
 */
export function legalTargetsFor(task: Task): Column[] {
  const targets = LEGAL_MOVES[task.column];
  if (task.column === "todo") {
    // start requires runState idle/error
    return task.runState === "idle" || task.runState === "error"
      ? [...targets]
      : [];
  }
  return [...targets];
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

export function todayLabel(): string {
  return new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}
