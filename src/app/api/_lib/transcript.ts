/**
 * Best-effort projection of persisted agent-run NDJSON lines into
 * `TranscriptItem`s for the replay phase of GET /api/tasks/[id]/transcript.
 *
 * AgentRun.transcriptPath points at the raw NDJSON we captured per run
 * (DESIGN.md decision 10/11 — raw events archived so transcripts can be
 * re-projected later). Three line shapes are recognized:
 *
 *  1. An already-parsed `TranscriptItem` (if the pipeline persists parsed
 *     items) — passed through.
 *  2. Claude Code `--output-format stream-json` events
 *     (system / assistant / user / result; partial `stream_event`s skipped —
 *     their content arrives again in the complete assistant message).
 *  3. codex `exec --json` JSONL events
 *     (thread.started / item.completed / turn.completed / turn.failed / error).
 *
 * Unrecognized lines are silently dropped — replay must never break the
 * stream.
 */

import type { TranscriptItem } from "@/lib/types";

type JsonObject = Record<string, unknown>;

const TRANSCRIPT_KINDS = new Set<string>([
  "system",
  "assistant_text",
  "reasoning",
  "tool_call",
  "tool_result",
  "file_edit",
  "error",
  "result",
]);

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Flatten claude message content (string or content-block array) to text. */
function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === "string") return block;
        if (isObject(block)) {
          const text = asString(block.text);
          if (text !== undefined) return text;
          return JSON.stringify(block);
        }
        return String(block);
      })
      .join("");
  }
  if (content === undefined || content === null) return "";
  return JSON.stringify(content);
}

// ---------------------------------------------------------------------------
// Claude Code stream-json events
// ---------------------------------------------------------------------------

function claudeEventToItems(obj: JsonObject, ts: string): TranscriptItem[] | undefined {
  const type = asString(obj.type);
  switch (type) {
    case "stream_event":
      // Partial-message deltas; the complete assistant message follows.
      return [];
    case "system": {
      if (asString(obj.subtype) === "init") {
        const model = asString(obj.model);
        const sessionId = asString(obj.session_id);
        const parts = ["session started"];
        if (model) parts.push(`model ${model}`);
        if (sessionId) parts.push(`session ${sessionId}`);
        return [{ kind: "system", ts, text: parts.join(" — ") }];
      }
      const text = asString(obj.message) ?? asString(obj.subtype) ?? "system event";
      return [{ kind: "system", ts, text }];
    }
    case "assistant": {
      const message = isObject(obj.message) ? obj.message : undefined;
      const content = message?.content;
      if (!Array.isArray(content)) {
        const text = contentToText(content);
        return text ? [{ kind: "assistant_text", ts, text }] : [];
      }
      const items: TranscriptItem[] = [];
      for (const block of content) {
        if (!isObject(block)) continue;
        switch (asString(block.type)) {
          case "text": {
            const text = asString(block.text) ?? "";
            if (text) items.push({ kind: "assistant_text", ts, text });
            break;
          }
          case "thinking": {
            const text = asString(block.thinking) ?? asString(block.text) ?? "";
            if (text) items.push({ kind: "reasoning", ts, text });
            break;
          }
          case "tool_use":
            items.push({
              kind: "tool_call",
              ts,
              toolName: asString(block.name) ?? "tool",
              input: block.input,
            });
            break;
          default:
            break;
        }
      }
      return items;
    }
    case "user": {
      const message = isObject(obj.message) ? obj.message : undefined;
      const content = message?.content;
      if (!Array.isArray(content)) return [];
      const items: TranscriptItem[] = [];
      for (const block of content) {
        if (!isObject(block) || asString(block.type) !== "tool_result") continue;
        items.push({
          kind: "tool_result",
          ts,
          output: contentToText(block.content),
          isError: block.is_error === true,
        });
      }
      return items;
    }
    case "result":
      return [
        {
          kind: "result",
          ts,
          isError: obj.is_error === true,
          costUsd: asNumber(obj.total_cost_usd),
          summary: asString(obj.result),
        },
      ];
    default:
      return undefined; // not a claude event
  }
}

// ---------------------------------------------------------------------------
// codex exec --json events
// ---------------------------------------------------------------------------

function codexItemToItems(item: JsonObject, ts: string): TranscriptItem[] {
  switch (asString(item.type ?? item.item_type)) {
    case "agent_message": {
      const text = asString(item.text) ?? "";
      return text ? [{ kind: "assistant_text", ts, text }] : [];
    }
    case "reasoning": {
      const text = asString(item.text) ?? "";
      return text ? [{ kind: "reasoning", ts, text }] : [];
    }
    case "command_execution": {
      const command = asString(item.command) ?? "";
      const output = asString(item.aggregated_output) ?? "";
      const exitCode = asNumber(item.exit_code);
      const items: TranscriptItem[] = [
        { kind: "tool_call", ts, toolName: "shell", input: { command } },
      ];
      if (output || exitCode !== undefined) {
        items.push({
          kind: "tool_result",
          ts,
          toolName: "shell",
          output,
          isError: exitCode !== undefined && exitCode !== 0,
        });
      }
      return items;
    }
    case "file_change": {
      const changes = Array.isArray(item.changes) ? item.changes : [];
      const items: TranscriptItem[] = [];
      for (const change of changes) {
        if (!isObject(change)) continue;
        const file = asString(change.path);
        if (file) items.push({ kind: "file_edit", ts, file });
      }
      return items;
    }
    case "mcp_tool_call":
      return [
        {
          kind: "tool_call",
          ts,
          toolName:
            [asString(item.server), asString(item.tool)].filter(Boolean).join(".") || "mcp",
          input: item.arguments,
        },
      ];
    case "error": {
      const message = asString(item.message) ?? "codex error";
      return [{ kind: "error", ts, message }];
    }
    default:
      return [];
  }
}

function codexEventToItems(obj: JsonObject, ts: string): TranscriptItem[] | undefined {
  const type = asString(obj.type);
  switch (type) {
    case "thread.started": {
      const threadId = asString(obj.thread_id);
      return [{ kind: "system", ts, text: `codex thread started${threadId ? `: ${threadId}` : ""}` }];
    }
    case "turn.started":
    case "item.started":
    case "item.updated":
      return []; // item.completed carries the final content
    case "item.completed":
      return isObject(obj.item) ? codexItemToItems(obj.item, ts) : [];
    case "turn.completed":
      return [{ kind: "result", ts, isError: false }];
    case "turn.failed": {
      const error = isObject(obj.error) ? asString(obj.error.message) : asString(obj.error);
      const message = error ?? "codex turn failed";
      return [
        { kind: "error", ts, message },
        { kind: "result", ts, isError: true, summary: message },
      ];
    }
    case "error": {
      const message = asString(obj.message) ?? "codex error";
      return [{ kind: "error", ts, message }];
    }
    default:
      return undefined; // not a codex event
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Project one raw JSON value into zero or more TranscriptItems. */
export function rawEventToItems(raw: unknown, fallbackTs: string): TranscriptItem[] {
  if (!isObject(raw)) return [];

  // Case 1: already a parsed TranscriptItem.
  const kind = asString(raw.kind);
  if (kind && TRANSCRIPT_KINDS.has(kind)) {
    const item = { ...raw, ts: asString(raw.ts) ?? fallbackTs };
    return [item as unknown as TranscriptItem];
  }

  const ts = asString(raw.ts) ?? asString(raw.timestamp) ?? fallbackTs;

  // Case 2: claude stream-json.
  const claude = claudeEventToItems(raw, ts);
  if (claude !== undefined) return claude;

  // Case 3: codex exec --json.
  const codex = codexEventToItems(raw, ts);
  if (codex !== undefined) return codex;

  return [];
}

/** Parse one NDJSON line; malformed/unknown lines yield no items. */
export function parseTranscriptLine(line: string, fallbackTs: string): TranscriptItem[] {
  const trimmed = line.trim();
  if (!trimmed) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    return [];
  }
  return rawEventToItems(raw, fallbackTs);
}
