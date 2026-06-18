/**
 * Shared constants. This module is imported by BOTH server code and client
 * components — it must stay free of node-only imports (fs/os/path). Runtime
 * filesystem paths are resolved in `src/server/paths.ts`.
 */

import type {
  AgentColumn,
  AppConfig,
  Column,
  Effort,
  ModelSpec,
} from "./types";

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

export const PORT = 4517;
export const APP_NAME = "friday-kanban";

/** Directory name under the user's home dir holding all runtime state. */
export const FRIDAY_HOME_DIRNAME = ".friday-kanban";
export const DB_FILENAME = "friday.db";
export const WORKTREES_DIRNAME = "worktrees";
export const TRANSCRIPTS_DIRNAME = "transcripts";
export const LOGS_DIRNAME = "logs";
export const ATTACHMENTS_DIRNAME = "attachments";

// ---------------------------------------------------------------------------
// Prompt image attachments
// ---------------------------------------------------------------------------

/** Image mime types accepted as task prompt attachments → file extension. */
export const ATTACHMENT_MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

/** Max images attachable to a single task prompt. */
export const MAX_ATTACHMENTS = 6;

/** Max decoded size per attachment (10 MiB). */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------

export const COLUMNS: readonly Column[] = ["todo", "in_dev", "in_review", "done"] as const;

export const COLUMN_LABELS: Record<Column, string> = {
  todo: "Todo",
  in_dev: "In Dev",
  in_review: "In Review",
  done: "Done",
};

/**
 * Legal drag transitions (drag is a command — DESIGN.md decision 12):
 * - todo -> in_dev:        start the implementer (manual-mode start)
 * - in_dev -> in_review:   force review
 * - in_review -> in_dev:   send back with a typed comment
 * Everything else is driven by the pipeline, not by drags.
 */
export const LEGAL_MOVES: Record<Column, readonly Column[]> = {
  todo: ["in_dev"],
  in_dev: ["in_review"],
  in_review: ["in_dev"],
  done: [],
};

// ---------------------------------------------------------------------------
// Models / efforts
// ---------------------------------------------------------------------------

export const COLUMN_DEFAULTS: Record<AgentColumn, ModelSpec> = {
  in_dev: { provider: "claude-code", model: "opus", effort: "high" },
  in_review: { provider: "claude-code", model: "haiku", effort: "medium" },
};

/**
 * Normalized effort -> codex `model_reasoning_effort` value.
 * Claude Code accepts the normalized values directly via --effort.
 */
export const EFFORT_TO_CODEX: Record<Effort, string> = {
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "xhigh",
  max: "xhigh",
};

export const EFFORTS: readonly Effort[] = ["low", "medium", "high", "xhigh", "max"] as const;

// ---------------------------------------------------------------------------
// App config defaults
// ---------------------------------------------------------------------------

export const DEFAULT_APP_CONFIG: AppConfig = {
  schedulerMode: "manual",
  maxConcurrentTasks: 5,
  maxReviewCycles: 3,
  columnDefaults: COLUMN_DEFAULTS,
};

// ---------------------------------------------------------------------------
// Review verdict JSON schema — single source of truth for codex --output-schema.
// Mirrors ReviewVerdict in src/lib/types.ts / reviewVerdictSchema in schemas.ts.
// ---------------------------------------------------------------------------

export const REVIEW_VERDICT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["verdict", "summary", "findings"],
  properties: {
    verdict: { type: "string", enum: ["approve", "request_changes"] },
    summary: { type: "string" },
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        // OpenAI strict structured outputs require EVERY key in `properties` to
        // appear in `required`; genuinely-optional fields are expressed as
        // nullable instead (model emits null when there's no line).
        required: ["file", "line", "severity", "comment"],
        properties: {
          file: { type: "string" },
          line: { type: ["number", "null"] },
          severity: { type: "string", enum: ["blocker", "major", "minor"] },
          comment: { type: "string" },
        },
      },
    },
  },
} as const;
