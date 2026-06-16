"use client";

/**
 * Kanban card. Dense, single-glance status: project chip, title, model badge,
 * runState (pulsing when running), review-cycle badge, cost, needs-attention,
 * local/cloud marker. Draggable only when a legal move exists from its column.
 */

import { useEffect, useRef } from "react";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import type { AppConfig, Project, Task } from "@/lib/types";
import {
  activeAgentColumn,
  cn,
  formatCost,
  legalTargetsFor,
  projectColor,
  resolveSpec,
  specLabel,
} from "@/components/util";
import { IconAlert, IconBranch, IconCloud, IconTerminal, IconWorktree } from "@/components/ui/icons";

export function RunStateDot({ task }: { task: Task }) {
  switch (task.runState) {
    case "running":
      return (
        <span className="inline-flex items-center gap-1.5 font-mono text-[10px] text-ember">
          <span className="h-1.5 w-1.5 rounded-full bg-ember animate-pulse-glow" />
          running
        </span>
      );
    case "queued":
      return (
        <span className="inline-flex items-center gap-1.5 font-mono text-[10px] text-queue">
          <span className="h-1.5 w-1.5 rounded-full bg-queue/80" />
          queued
        </span>
      );
    case "error":
      return (
        <span className="inline-flex items-center gap-1.5 font-mono text-[10px] text-danger">
          <span className="h-1.5 w-1.5 rounded-full bg-danger" />
          error
        </span>
      );
    case "needs_attention":
      return (
        <span className="inline-flex items-center gap-1 font-mono text-[10px] text-attention">
          <IconAlert size={11} />
          attention
        </span>
      );
    default:
      return null;
  }
}

export function TaskCardBody({
  task,
  project,
  config,
  overlay,
}: {
  task: Task;
  project?: Project;
  config: AppConfig;
  overlay?: boolean;
}) {
  const spec = resolveSpec(task, config, activeAgentColumn(task.column));
  const cost = formatCost(task.costUsd);
  const accent =
    task.runState === "running"
      ? "var(--color-ember)"
      : task.runState === "error"
        ? "var(--color-danger)"
        : task.runState === "needs_attention"
          ? "var(--color-attention)"
          : "transparent";

  return (
    <div
      className={cn(
        "group relative rounded-lg border border-edge bg-raised p-3 transition-colors",
        !overlay && "hover:border-edge-bright",
        overlay && "rotate-[1.5deg] border-edge-bright shadow-[0_16px_48px_rgba(0,0,0,0.55)]",
      )}
      style={{ boxShadow: accent !== "transparent" ? `inset 2px 0 0 0 ${accent}` : undefined }}
    >
      {/* top row: project chip + execution + review cycle */}
      <div className="mb-1.5 flex items-center gap-1.5">
        {project ? (
          <span className="inline-flex min-w-0 items-center gap-1.5 rounded bg-overlay px-1.5 py-0.5">
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ background: projectColor(project.id) }}
            />
            <span className="truncate font-mono text-[10px] text-mute">{project.name}</span>
          </span>
        ) : null}
        <span className="min-w-0 flex-1" />
        {task.reviewCycle > 0 || task.column === "in_review" ? (
          <span
            title={`Review round ${Math.min(task.reviewCycle + (task.column === "in_review" ? 1 : 0), config.maxReviewCycles)} of ${config.maxReviewCycles}`}
            className="rounded border border-review/30 bg-review/10 px-1 py-px font-mono text-[9.5px] text-review"
          >
            R{Math.min(task.reviewCycle + (task.column === "in_review" ? 1 : 0), config.maxReviewCycles)}/
            {config.maxReviewCycles}
          </span>
        ) : null}
        <span
          className={cn("shrink-0", task.execution === "cloud" ? "text-queue" : "text-faint")}
          title={task.execution === "cloud" ? "Cloud (claude --remote)" : "Local execution"}
        >
          {task.execution === "cloud" ? <IconCloud size={12} /> : <IconTerminal size={12} />}
        </span>
      </div>

      {/* title */}
      <p className="line-clamp-2 text-[13px] font-medium leading-snug tracking-tight">
        {task.title}
      </p>

      {/* needs attention strip */}
      {task.runState === "needs_attention" ? (
        <p className="mt-1.5 rounded border border-attention/25 bg-attention/10 px-1.5 py-1 text-[10.5px] leading-snug text-attention">
          Review cap exhausted — needs your call
        </p>
      ) : null}
      {task.runState === "error" && task.error ? (
        <p className="mt-1.5 line-clamp-2 rounded border border-danger/20 bg-danger/10 px-1.5 py-1 font-mono text-[10px] leading-snug text-danger/90">
          {task.error}
        </p>
      ) : null}

      {/* bottom row: branch + model + cost + state */}
      <div className="mt-2 flex items-center gap-2 text-faint">
        <span className="inline-flex min-w-0 items-center gap-1 font-mono text-[10px]">
          {task.workspaceMode === "worktree" ? (
            <IconWorktree size={11} className="shrink-0" />
          ) : (
            <IconBranch size={11} className="shrink-0" />
          )}
          <span className="truncate">
            {task.workspaceMode === "worktree" && task.worktree
              ? task.worktree.branch
              : task.branch}
          </span>
        </span>
        <span className="flex-1" />
        {cost ? <span className="font-mono text-[10px] text-mute">{cost}</span> : null}
        <span
          className="rounded border border-edge bg-overlay px-1 py-px font-mono text-[9.5px] text-mute"
          title={`${spec.provider} · ${spec.model} · effort ${spec.effort}`}
        >
          {specLabel(spec)}
        </span>
      </div>

      {/* run state line (only when noteworthy) */}
      {task.runState !== "idle" ? (
        <div className="mt-1.5">
          <RunStateDot task={task} />
        </div>
      ) : null}
    </div>
  );
}

export function TaskCard({
  task,
  project,
  config,
  onOpen,
}: {
  task: Task;
  project?: Project;
  config: AppConfig;
  onOpen: (taskId: string) => void;
}) {
  const draggable = legalTargetsFor(task).length > 0;
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
    data: { task },
    disabled: !draggable,
  });

  // Suppress the click that fires on pointerup after a real drag — otherwise
  // dropping a card would also open its drawer.
  const wasDragged = useRef(false);
  useEffect(() => {
    if (isDragging) wasDragged.current = true;
  }, [isDragging]);

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform) }}
      className={cn(
        draggable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
        isDragging && "opacity-30",
      )}
      onClick={() => {
        if (wasDragged.current) {
          wasDragged.current = false;
          return;
        }
        onOpen(task.id);
      }}
      {...listeners}
      {...attributes}
    >
      <TaskCardBody task={task} project={project} config={config} />
    </div>
  );
}
