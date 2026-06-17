"use client";

/**
 * Task detail drawer (right side). Live transcript stream, review-round
 * history, commits, error display and actions (retry / send back / cancel /
 * delete). Refetches GET /api/tasks/[id] whenever the board store's task row
 * changes (the SSE stream keeps that fresh).
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { TaskDetail } from "@/lib/types";
import { useBoard } from "@/store/board";
import { useUi } from "@/store/ui";
import { api, ApiHttpError } from "@/store/api";
import {
  activeAgentColumn,
  cn,
  formatCost,
  projectColor,
  resolveSpec,
  shortSha,
  specLabel,
  timeAgo,
} from "@/components/util";
import { COLUMN_LABELS } from "@/lib/constants";
import { Button, Textarea } from "@/components/ui/fields";
import {
  IconAlert,
  IconArrowLeft,
  IconBranch,
  IconCloud,
  IconCommit,
  IconExternal,
  IconRetry,
  IconStop,
  IconTerminal,
  IconTrash,
  IconWorktree,
  IconX,
  Spinner,
} from "@/components/ui/icons";
import { RunStateDot } from "@/components/board/TaskCard";
import { Transcript } from "./Transcript";
import { ReviewRounds } from "./ReviewRounds";

type Tab = "transcript" | "reviews" | "commits";

function CommitsList({ shas }: { shas: string[] }) {
  if (shas.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center">
        <p className="font-mono text-[11px] leading-relaxed text-faint">
          No commits yet.
          <br />
          Commits land here as the implementer finishes work.
        </p>
      </div>
    );
  }
  return (
    <ul className="space-y-1 overflow-y-auto px-4 py-3">
      {shas.map((sha) => (
        <li
          key={sha}
          className="flex items-center gap-2.5 rounded-md border border-edge bg-raised/60 px-2.5 py-2"
        >
          <IconCommit size={12} className="shrink-0 text-ok" />
          <span className="font-mono text-[11.5px] text-ink">{shortSha(sha)}</span>
          <span className="truncate font-mono text-[10px] text-faint">{sha}</span>
        </li>
      ))}
    </ul>
  );
}

export function TaskDrawer() {
  const taskId = useUi((s) => s.drawerTaskId);
  const close = useUi((s) => s.closeDrawer);
  const openSendBack = useUi((s) => s.openSendBack);
  const toast = useUi((s) => s.toast);

  const task = useBoard((s) => (taskId ? s.tasks[taskId] : undefined));
  const project = useBoard((s) =>
    task ? s.projects.find((p) => p.id === task.projectId) : undefined,
  );
  const config = useBoard((s) => s.config);
  const retryTask = useBoard((s) => s.retryTask);
  const sendMessage = useBoard((s) => s.sendMessage);
  const cancelTask = useBoard((s) => s.cancelTask);
  const deleteTask = useBoard((s) => s.deleteTask);

  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("transcript");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  // reset per task
  useEffect(() => {
    setDetail(null);
    setDetailError(null);
    setTab("transcript");
    setConfirmDelete(false);
    setMessage("");
    setSending(false);
  }, [taskId]);

  // fetch + refetch on task row updates (SSE keeps updatedAt fresh)
  useEffect(() => {
    if (!taskId) return;
    let live = true;
    api
      .taskDetail(taskId)
      .then((d) => {
        if (live) {
          setDetail(d);
          setDetailError(null);
        }
      })
      .catch((err: unknown) => {
        if (live)
          setDetailError(err instanceof ApiHttpError ? err.friendly : "Failed to load task");
      });
    return () => {
      live = false;
    };
  }, [taskId, task?.updatedAt]);

  // esc closes
  useEffect(() => {
    if (!taskId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [taskId, close]);

  if (!taskId || typeof document === "undefined") return null;

  const spec = task ? resolveSpec(task, config, activeAgentColumn(task.column)) : null;
  const isLive = task?.runState === "running" || task?.runState === "queued";
  const verdictCount = detail?.verdicts.length ?? 0;
  const canMessage =
    task?.runState === "error" || task?.runState === "needs_attention";

  const submitMessage = async () => {
    if (!task || message.trim() === "" || sending) return;
    setSending(true);
    const ok = await sendMessage(task.id, message.trim());
    setSending(false);
    if (ok) setMessage("");
  };

  return createPortal(
    <div className="fixed inset-0 z-40">
      {/* backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={close} />

      {/* panel */}
      <aside className="animate-slide-in absolute right-0 top-0 flex h-full w-[640px] max-w-[92vw] flex-col border-l border-edge bg-panel shadow-[-24px_0_80px_rgba(0,0,0,0.5)]">
        {!task ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-faint">
            <p className="font-mono text-xs">task no longer exists</p>
            <Button variant="ghost" onClick={close}>
              Close
            </Button>
          </div>
        ) : (
          <>
            {/* header */}
            <header className="border-b border-edge px-5 pb-3.5 pt-4">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="mb-1.5 flex flex-wrap items-center gap-2">
                    {project ? (
                      <span className="inline-flex items-center gap-1.5 rounded bg-overlay px-1.5 py-0.5">
                        <span
                          className="h-1.5 w-1.5 rounded-full"
                          style={{ background: projectColor(project.id) }}
                        />
                        <span className="font-mono text-[10px] text-mute">{project.name}</span>
                      </span>
                    ) : null}
                    <span className="rounded border border-edge bg-raised px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-mute">
                      {COLUMN_LABELS[task.column]}
                    </span>
                    <RunStateDot task={task} />
                    <span className="flex-1" />
                    <span className="font-mono text-[10px] text-faint">
                      updated {timeAgo(task.updatedAt)}
                    </span>
                  </div>
                  <h2 className="text-[16px] font-semibold leading-snug tracking-tight">
                    {task.title}
                  </h2>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10.5px] text-faint">
                    <span className="inline-flex items-center gap-1">
                      {task.workspaceMode === "worktree" ? (
                        <IconWorktree size={11} />
                      ) : (
                        <IconBranch size={11} />
                      )}
                      {task.workspaceMode === "worktree" && task.worktree
                        ? task.worktree.branch
                        : task.branch}
                      <span className="text-faint/70">({task.workspaceMode})</span>
                    </span>
                    <span className="inline-flex items-center gap-1">
                      {task.execution === "cloud" ? (
                        <>
                          <IconCloud size={11} className="text-queue" /> cloud
                        </>
                      ) : (
                        <>
                          <IconTerminal size={11} /> local
                        </>
                      )}
                    </span>
                    {spec ? (
                      <span
                        className="rounded border border-edge bg-overlay px-1 py-px"
                        title={`${spec.provider} · effort ${spec.effort}`}
                      >
                        {specLabel(spec)}
                      </span>
                    ) : null}
                    {task.reviewCycle > 0 || task.column === "in_review" ? (
                      <span className="text-review">
                        R
                        {Math.min(
                          task.reviewCycle + (task.column === "in_review" ? 1 : 0),
                          config.maxReviewCycles,
                        )}
                        /{config.maxReviewCycles}
                      </span>
                    ) : null}
                    {formatCost(task.costUsd) ? (
                      <span className="text-mute">{formatCost(task.costUsd)}</span>
                    ) : null}
                  </div>
                </div>
                <button
                  onClick={close}
                  className="rounded-md p-1 text-faint transition-colors hover:bg-hover hover:text-ink"
                  aria-label="Close"
                >
                  <IconX size={15} />
                </button>
              </div>

              {/* error banner */}
              {task.runState === "error" && task.error ? (
                <div className="mt-3 flex items-start gap-2 rounded-md border border-danger/30 bg-danger/10 px-3 py-2">
                  <IconAlert size={13} className="mt-0.5 shrink-0 text-danger" />
                  <p className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-danger">
                    {task.error}
                  </p>
                </div>
              ) : null}
              {task.runState === "needs_attention" ? (
                <div className="mt-3 flex items-start gap-2 rounded-md border border-attention/30 bg-attention/10 px-3 py-2">
                  <IconAlert size={13} className="mt-0.5 shrink-0 text-attention" />
                  <p className="text-[12px] leading-relaxed text-attention">
                    Review cap exhausted after {config.maxReviewCycles} rounds. Send it back
                    with guidance, or retry.
                  </p>
                </div>
              ) : null}

              {/* actions */}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {task.runState === "error" || task.runState === "needs_attention" ? (
                  <Button variant="subtle" onClick={() => void retryTask(task.id)}>
                    <IconRetry size={12} />
                    Retry
                  </Button>
                ) : null}
                {task.column === "in_review" && !isLive ? (
                  <Button variant="subtle" onClick={() => openSendBack(task.id)}>
                    <IconArrowLeft size={12} />
                    Send back
                  </Button>
                ) : null}
                {isLive ? (
                  <Button variant="danger" onClick={() => void cancelTask(task.id)}>
                    <IconStop size={12} />
                    Cancel
                  </Button>
                ) : null}
                {task.prUrl ? (
                  <a
                    href={task.prUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-md border border-queue/30 bg-queue/10 px-3 py-1.5 text-[13px] font-medium text-queue transition-colors hover:bg-queue/20"
                  >
                    <IconExternal size={12} />
                    Remote PR
                  </a>
                ) : null}
                <span className="flex-1" />
                {!isLive ? (
                  confirmDelete ? (
                    <span className="inline-flex items-center gap-2">
                      <span className="text-[11px] text-danger">delete task?</span>
                      <Button
                        variant="danger"
                        onClick={async () => {
                          const ok = await deleteTask(task.id);
                          if (ok) {
                            toast("info", "Task deleted", task.title);
                            close();
                          }
                        }}
                      >
                        Confirm
                      </Button>
                      <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
                        Keep
                      </Button>
                    </span>
                  ) : (
                    <button
                      onClick={() => setConfirmDelete(true)}
                      className="rounded-md p-1.5 text-faint transition-colors hover:bg-danger/10 hover:text-danger"
                      title="Delete task"
                    >
                      <IconTrash size={13} />
                    </button>
                  )
                ) : null}
              </div>

              {/* mid-task message composer — direct the agent on a stopped task */}
              {canMessage ? (
                <div className="mt-3 rounded-md border border-edge bg-base/40 p-2">
                  <Textarea
                    rows={2}
                    placeholder="Send a message into this task's session — tell the agent what to do, then it resumes. (⌘↵)"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    onKeyDown={(e) => {
                      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void submitMessage();
                    }}
                  />
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="text-[11px] text-faint">
                      Resumes the agent{" "}
                      {task.column === "in_review" ? "in a fix round" : "in the same session"} with
                      your instructions.
                    </span>
                    <Button
                      variant="primary"
                      disabled={message.trim() === ""}
                      loading={sending}
                      onClick={() => void submitMessage()}
                    >
                      Send message
                    </Button>
                  </div>
                </div>
              ) : null}
            </header>

            {/* prompt (collapsed preview) */}
            <details className="group border-b border-edge px-5 py-2">
              <summary className="cursor-pointer list-none font-mono text-[10.5px] uppercase tracking-wider text-faint transition-colors hover:text-mute">
                prompt <span className="text-faint/60 group-open:hidden">· {task.prompt.slice(0, 80)}…</span>
              </summary>
              <pre className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-md border border-edge bg-bg p-2.5 font-mono text-[11px] leading-relaxed text-mute">
                {task.prompt}
                {task.contextPaths.length > 0
                  ? `\n\ncontext: ${task.contextPaths.join(", ")}`
                  : ""}
              </pre>
            </details>

            {/* tabs */}
            <nav className="flex items-center gap-1 border-b border-edge px-3 pt-1.5">
              {(
                [
                  { id: "transcript", label: "Transcript" },
                  { id: "reviews", label: `Reviews${verdictCount ? ` ${verdictCount}` : ""}` },
                  {
                    id: "commits",
                    label: `Commits${task.commitShas.length ? ` ${task.commitShas.length}` : ""}`,
                  },
                ] as { id: Tab; label: string }[]
              ).map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={cn(
                    "rounded-t-md border-b-2 px-3 py-1.5 text-[12px] font-medium transition-colors",
                    tab === t.id
                      ? "border-ember text-ink"
                      : "border-transparent text-faint hover:text-mute",
                  )}
                >
                  {t.label}
                </button>
              ))}
              <span className="flex-1" />
              {detail === null && !detailError ? (
                <Spinner size={12} className="mr-2 text-faint" />
              ) : null}
            </nav>

            {/* body */}
            <div className="min-h-0 flex-1">
              {detailError ? (
                <div className="flex h-full items-center justify-center">
                  <p className="font-mono text-[11px] text-danger">{detailError}</p>
                </div>
              ) : tab === "transcript" ? (
                <Transcript task={task} />
              ) : tab === "reviews" ? (
                <ReviewRounds
                  verdicts={detail?.verdicts ?? []}
                  maxReviewCycles={config.maxReviewCycles}
                />
              ) : (
                <CommitsList shas={task.commitShas} />
              )}
            </div>
          </>
        )}
      </aside>
    </div>,
    document.body,
  );
}
