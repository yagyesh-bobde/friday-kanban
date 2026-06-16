/**
 * Parsed-transcript helpers shared by the runners and the transcript SSE
 * route: map raw claude stream-json / codex --json events to TranscriptItems,
 * and replay archived NDJSON transcript files.
 */

import fs from "node:fs";
import type { Provider, TranscriptItem } from "@/lib/types";
import { parseJsonLine } from "./streamParser";
import { nowIso } from "@/server/db";

const TOOL_RESULT_MAX = 4_000;
const TOOL_INPUT_MAX = 2_000;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}\n… [truncated]` : text;
}

/** Summarize a tool_use input for the live transcript (keep payloads small). */
export function summarizeToolInput(input: unknown): unknown {
  if (input === undefined || input === null) return input;
  try {
    const json = JSON.stringify(input);
    if (json.length <= TOOL_INPUT_MAX) return input;
    return { _truncated: truncate(json, TOOL_INPUT_MAX) };
  } catch {
    return { _unserializable: true };
  }
}

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        const rec = asRecord(block);
        if (!rec) return "";
        if (rec.type === "text") return str(rec.text) ?? "";
        return "";
      })
      .filter((t) => t.length > 0)
      .join("\n");
  }
  return "";
}

// ---------------------------------------------------------------------------
// Claude stream-json (claude -p --output-format stream-json --verbose)
// ---------------------------------------------------------------------------

/**
 * Map one claude stream-json event to zero or more TranscriptItems.
 * Partial-message `stream_event`s are skipped (the completed `assistant`
 * message carries the full content) to avoid duplicated text.
 */
export function claudeEventToItems(evt: unknown): TranscriptItem[] {
  const rec = asRecord(evt);
  if (!rec) return [];
  const ts = nowIso();
  const type = str(rec.type);

  if (type === "system") {
    const subtype = str(rec.subtype);
    if (subtype === "init") {
      const model = str(rec.model) ?? "unknown model";
      return [{ kind: "system", ts, text: `session started (${model})` }];
    }
    if (subtype === "api_retry") {
      return [{ kind: "system", ts, text: "API retry (rate limited)" }];
    }
    return [];
  }

  if (type === "assistant" || type === "user") {
    const message = asRecord(rec.message);
    const content = message?.content;
    if (!Array.isArray(content)) return [];
    const items: TranscriptItem[] = [];
    for (const block of content) {
      const b = asRecord(block);
      if (!b) continue;
      switch (b.type) {
        case "text": {
          const text = str(b.text);
          if (text && text.trim().length > 0) items.push({ kind: "assistant_text", ts, text });
          break;
        }
        case "thinking": {
          const text = str(b.thinking);
          if (text && text.trim().length > 0) items.push({ kind: "reasoning", ts, text });
          break;
        }
        case "tool_use": {
          items.push({
            kind: "tool_call",
            ts,
            toolName: str(b.name) ?? "unknown",
            input: summarizeToolInput(b.input),
          });
          break;
        }
        case "tool_result": {
          const output = contentToText(b.content);
          items.push({
            kind: "tool_result",
            ts,
            output: truncate(output, TOOL_RESULT_MAX),
            isError: b.is_error === true,
          });
          break;
        }
        default:
          break;
      }
    }
    return items;
  }

  if (type === "result") {
    const isError = rec.is_error === true;
    const costUsd = typeof rec.total_cost_usd === "number" ? rec.total_cost_usd : undefined;
    const summary = str(rec.result);
    return [{ kind: "result", ts, isError, costUsd, summary }];
  }

  return [];
}

// ---------------------------------------------------------------------------
// Codex --json (codex exec --json)
// ---------------------------------------------------------------------------

/** Map one codex exec --json event to zero or more TranscriptItems. */
export function codexEventToItems(evt: unknown): TranscriptItem[] {
  const rec = asRecord(evt);
  if (!rec) return [];
  const ts = nowIso();
  const type = str(rec.type);

  if (type === "thread.started") {
    return [{ kind: "system", ts, text: "review thread started" }];
  }
  if (type === "turn.failed") {
    const error = asRecord(rec.error);
    return [{ kind: "error", ts, message: str(error?.message) ?? "codex turn failed" }];
  }
  if (type === "error") {
    return [{ kind: "error", ts, message: str(rec.message) ?? "codex error" }];
  }

  if (type === "item.completed") {
    const item = asRecord(rec.item);
    if (!item) return [];
    const itemType = str(item.item_type) ?? str(item.type);
    switch (itemType) {
      case "agent_message":
        return item.text
          ? [{ kind: "assistant_text", ts, text: str(item.text) ?? "" }]
          : [];
      case "reasoning":
        return item.text ? [{ kind: "reasoning", ts, text: str(item.text) ?? "" }] : [];
      case "command_execution": {
        const items: TranscriptItem[] = [
          {
            kind: "tool_call",
            ts,
            toolName: "command",
            input: { command: str(item.command) ?? "" },
          },
        ];
        const output = str(item.aggregated_output);
        if (output !== undefined) {
          const exitCode = typeof item.exit_code === "number" ? item.exit_code : undefined;
          items.push({
            kind: "tool_result",
            ts,
            toolName: "command",
            output: truncate(output, TOOL_RESULT_MAX),
            isError: exitCode !== undefined && exitCode !== 0,
          });
        }
        return items;
      }
      case "file_change": {
        const changes = Array.isArray(item.changes) ? item.changes : [item];
        return changes
          .map((c): TranscriptItem | undefined => {
            const cr = asRecord(c);
            const file = str(cr?.path) ?? str(cr?.file);
            return file ? { kind: "file_edit", ts, file } : undefined;
          })
          .filter((i): i is TranscriptItem => i !== undefined);
      }
      case "error":
        return [{ kind: "error", ts, message: str(item.message) ?? "codex item error" }];
      default:
        return [];
    }
  }

  return [];
}

// ---------------------------------------------------------------------------
// Replay
// ---------------------------------------------------------------------------

/**
 * Re-parse an archived raw NDJSON transcript file into TranscriptItems.
 * Used by GET /api/tasks/[id]/transcript to replay finished runs.
 */
export function readTranscriptItems(transcriptPath: string, provider: Provider): TranscriptItem[] {
  let raw: string;
  try {
    raw = fs.readFileSync(transcriptPath, "utf8");
  } catch {
    return [];
  }
  const items: TranscriptItem[] = [];
  for (const line of raw.split("\n")) {
    const obj = parseJsonLine(line);
    if (obj === undefined) continue;
    const mapped = provider === "codex" ? codexEventToItems(obj) : claudeEventToItems(obj);
    items.push(...mapped);
  }
  return items;
}
