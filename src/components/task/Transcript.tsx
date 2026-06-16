"use client";

/**
 * Live transcript view. Opens its own EventSource on
 * GET /api/tasks/[id]/transcript — the server replays captured items then
 * forwards live ones. EventSource reconnects replay from the start, so the
 * buffer is cleared on every `open`; once a final `result` has been seen and
 * the task is no longer live, the stream is closed client-side to stop the
 * reconnect loop.
 */

import { useEffect, useRef, useState } from "react";
import type { Task, TranscriptItem } from "@/lib/types";
import { cn, formatClock, previewJson } from "@/components/util";
import { Markdown } from "@/components/ui/Markdown";
import {
  IconAlert,
  IconBrain,
  IconCheck,
  IconFile,
  IconTerminal,
  IconWrench,
  Spinner,
} from "@/components/ui/icons";

const MAX_ITEMS = 3000;

function ToolRow({ item }: { item: Extract<TranscriptItem, { kind: "tool_call" }> }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div
      className="cursor-pointer rounded-md border border-edge bg-raised/60 px-2 py-1.5 transition-colors hover:border-edge-bright"
      onClick={() => setExpanded((v) => !v)}
    >
      <div className="flex items-center gap-2">
        <IconWrench size={11} className="shrink-0 text-queue" />
        <span className="font-mono text-[11px] font-medium text-ink">{item.toolName}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-faint">
          {previewJson(item.input)}
        </span>
        <span className="shrink-0 font-mono text-[9px] text-faint">{formatClock(item.ts)}</span>
      </div>
      {expanded ? (
        <pre className="mt-1.5 max-h-64 overflow-auto rounded bg-bg p-2 font-mono text-[10.5px] leading-relaxed text-mute">
          {typeof item.input === "string" ? item.input : JSON.stringify(item.input, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}

function ToolResultRow({
  item,
}: {
  item: Extract<TranscriptItem, { kind: "tool_result" }>;
}) {
  const [expanded, setExpanded] = useState(false);
  const long = item.output.length > 300;
  return (
    <div
      className={cn(
        "rounded-md border px-2 py-1.5",
        item.isError ? "border-danger/25 bg-danger/[0.06]" : "border-edge/60 bg-panel",
        long && "cursor-pointer",
      )}
      onClick={() => long && setExpanded((v) => !v)}
    >
      <pre
        className={cn(
          "overflow-x-auto whitespace-pre-wrap break-words font-mono text-[10.5px] leading-relaxed",
          item.isError ? "text-danger/90" : "text-faint",
          !expanded && long && "line-clamp-3",
        )}
      >
        {expanded || !long ? item.output : item.output.slice(0, 300)}
      </pre>
      {long && !expanded ? (
        <span className="font-mono text-[9.5px] text-faint">
          … {item.output.length.toLocaleString()} chars — click to expand
        </span>
      ) : null}
    </div>
  );
}

function ReasoningRow({ item }: { item: Extract<TranscriptItem, { kind: "reasoning" }> }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <button
      type="button"
      onClick={() => setExpanded((v) => !v)}
      className="block w-full rounded-md px-2 py-1 text-left transition-colors hover:bg-raised/60"
    >
      <span className="flex items-center gap-2 text-faint">
        <IconBrain size={11} />
        <span className="font-mono text-[10px] italic">
          {expanded ? "reasoning" : `reasoning · ${previewJson(item.text, 80)}`}
        </span>
      </span>
      {expanded ? (
        <p className="mt-1 whitespace-pre-wrap pl-5 text-[11.5px] italic leading-relaxed text-mute">
          {item.text}
        </p>
      ) : null}
    </button>
  );
}

function DiffBlock({ diff }: { diff: string }) {
  return (
    <pre className="mt-1.5 max-h-72 overflow-auto rounded bg-bg p-2 font-mono text-[10.5px] leading-relaxed">
      {diff.split("\n").map((line, i) => (
        <div
          key={i}
          className={
            line.startsWith("+") && !line.startsWith("+++")
              ? "text-ok"
              : line.startsWith("-") && !line.startsWith("---")
                ? "text-danger"
                : line.startsWith("@@")
                  ? "text-review"
                  : "text-faint"
          }
        >
          {line || " "}
        </div>
      ))}
    </pre>
  );
}

function FileEditRow({ item }: { item: Extract<TranscriptItem, { kind: "file_edit" }> }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div
      className={cn(
        "rounded-md border border-ember/20 bg-ember/[0.04] px-2 py-1.5",
        item.diff && "cursor-pointer",
      )}
      onClick={() => item.diff && setExpanded((v) => !v)}
    >
      <div className="flex items-center gap-2">
        <IconFile size={11} className="shrink-0 text-ember" />
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink">
          {item.file}
        </span>
        <span className="rounded bg-ember/15 px-1 py-px font-mono text-[9px] text-ember">
          edit
        </span>
      </div>
      {expanded && item.diff ? <DiffBlock diff={item.diff} /> : null}
    </div>
  );
}

function TranscriptRow({ item }: { item: TranscriptItem }) {
  switch (item.kind) {
    case "assistant_text":
      return (
        <div className="px-0.5 text-[12.5px] text-ink">
          <Markdown text={item.text} />
        </div>
      );
    case "reasoning":
      return <ReasoningRow item={item} />;
    case "tool_call":
      return <ToolRow item={item} />;
    case "tool_result":
      return <ToolResultRow item={item} />;
    case "file_edit":
      return <FileEditRow item={item} />;
    case "system":
      return (
        <p className="flex items-center gap-2 px-1 font-mono text-[10px] text-faint">
          <IconTerminal size={10} className="shrink-0" />
          <span className="truncate">{item.text}</span>
        </p>
      );
    case "error":
      return (
        <div className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/10 px-2.5 py-2">
          <IconAlert size={12} className="mt-0.5 shrink-0 text-danger" />
          <p className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-danger">
            {item.message}
          </p>
        </div>
      );
    case "result":
      return (
        <div
          className={cn(
            "flex items-start gap-2 rounded-md border px-2.5 py-2",
            item.isError ? "border-danger/30 bg-danger/[0.07]" : "border-ok/25 bg-ok/[0.06]",
          )}
        >
          {item.isError ? (
            <IconAlert size={12} className="mt-0.5 shrink-0 text-danger" />
          ) : (
            <IconCheck size={12} className="mt-0.5 shrink-0 text-ok" />
          )}
          <div className="min-w-0 flex-1">
            <p
              className={cn(
                "font-mono text-[10.5px] font-semibold uppercase tracking-wider",
                item.isError ? "text-danger" : "text-ok",
              )}
            >
              {item.isError ? "run failed" : "run complete"}
              {item.costUsd !== undefined ? (
                <span className="ml-2 font-normal normal-case text-mute">
                  ${item.costUsd.toFixed(2)}
                </span>
              ) : null}
            </p>
            {item.summary ? (
              <div className="mt-1 text-[12px] text-mute">
                <Markdown text={item.summary} />
              </div>
            ) : null}
          </div>
        </div>
      );
  }
}

export function Transcript({ task }: { task: Task }) {
  const [items, setItems] = useState<TranscriptItem[]>([]);
  const [ended, setEnded] = useState(false);
  const [connected, setConnected] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const live = task.runState === "running" || task.runState === "queued";
  const liveRef = useRef(live);
  liveRef.current = live;

  // (Re)open the stream per task — and whenever liveness flips, so a task that
  // starts running while the drawer is open gets a fresh replay+live stream.
  useEffect(() => {
    setItems([]);
    setEnded(false);

    const es = new EventSource(`/api/tasks/${task.id}/transcript`);

    es.onopen = () => {
      // reconnects replay the full transcript — start clean
      setItems([]);
      setConnected(true);
      setEnded(false);
    };
    es.onmessage = (msg) => {
      try {
        const item = JSON.parse(msg.data as string) as TranscriptItem;
        setItems((prev) =>
          prev.length >= MAX_ITEMS ? [...prev.slice(-MAX_ITEMS + 1), item] : [...prev, item],
        );
      } catch {
        // ignore malformed frames
      }
    };
    es.onerror = () => {
      setConnected(false);
      // The server closes the stream once the task has no live run and the
      // final result was sent — don't reconnect-loop against a finished task.
      // (A later run start flips `live`, which re-runs this effect.)
      if (!liveRef.current) {
        es.close();
        setEnded(true);
      }
    };

    return () => es.close();
  }, [task.id, live]);

  // autoscroll while pinned to the bottom
  useEffect(() => {
    const el = containerRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [items]);

  return (
    <div className="flex h-full flex-col">
      <div
        ref={containerRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="flex-1 space-y-1.5 overflow-y-auto px-4 py-3"
      >
        {items.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-faint">
            {live ? (
              <>
                <Spinner size={16} />
                <p className="font-mono text-[11px]">waiting for agent output…</p>
              </>
            ) : (
              <p className="max-w-60 text-center font-mono text-[11px] leading-relaxed">
                no transcript yet — agent output streams here once the task runs
              </p>
            )}
          </div>
        ) : (
          items.map((item, i) => <TranscriptRow key={i} item={item} />)
        )}
      </div>
      <div className="flex items-center gap-2 border-t border-edge px-4 py-1.5">
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            live && connected
              ? "bg-ember animate-pulse-glow"
              : ended
                ? "bg-faint"
                : connected
                  ? "bg-ok"
                  : "bg-faint",
          )}
        />
        <span className="font-mono text-[10px] text-faint">
          {live ? "streaming live" : ended ? "stream ended" : connected ? "replayed" : "disconnected"}
          {" · "}
          {items.length} item{items.length === 1 ? "" : "s"}
        </span>
      </div>
    </div>
  );
}
