"use client";

/**
 * Board column. During a drag it signals whether it's a legal drop target
 * (ember ring) or not (dimmed) — drag is a command, only real transitions
 * are accepted.
 */

import { useDroppable } from "@dnd-kit/core";
import type { AppConfig, Column as ColumnId, Project, Task } from "@/lib/types";
import { COLUMN_LABELS } from "@/lib/constants";
import { cn } from "@/components/util";
import { IconPlus } from "@/components/ui/icons";
import { TaskCard } from "./TaskCard";

const COLUMN_ACCENT: Record<ColumnId, string> = {
  todo: "#8b909c",
  in_dev: "var(--color-ember)",
  in_review: "var(--color-review)",
  done: "var(--color-ok)",
};

const COLUMN_HINT: Record<ColumnId, string> = {
  todo: "Queued work. Drag a card to In Dev to start the implementer.",
  in_dev: "Claude Code is implementing. Cards arrive here from Todo.",
  in_review: "Codex reviews the diff. Blockers bounce cards back.",
  done: "Approved — commits on the branch, ready to bundle into a PR.",
};

export function BoardColumn({
  column,
  tasks,
  projects,
  config,
  dragTargets,
  onOpenTask,
  onNewTask,
}: {
  column: ColumnId;
  tasks: Task[];
  projects: Project[];
  config: AppConfig;
  /** null = no active drag; otherwise the set of legal target columns. */
  dragTargets: ColumnId[] | null;
  onOpenTask: (taskId: string) => void;
  onNewTask?: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column, data: { column } });
  const isTarget = dragTargets !== null && dragTargets.includes(column);
  const isMuted = dragTargets !== null && !isTarget;
  const runningCount = tasks.filter((t) => t.runState === "running").length;

  const projectById = new Map(projects.map((p) => [p.id, p]));

  return (
    <section
      ref={setNodeRef}
      className={cn(
        "flex h-full w-[300px] shrink-0 flex-col rounded-xl border bg-panel/70 transition-all",
        isTarget
          ? isOver
            ? "border-ember/70 bg-ember/[0.04] shadow-[0_0_24px_rgba(242,163,60,0.12)]"
            : "border-ember/35"
          : "border-edge",
        isMuted && "opacity-45",
      )}
    >
      {/* header */}
      <header className="flex items-center gap-2 px-3 pb-2 pt-3">
        <span
          className="h-2 w-2 rounded-full"
          style={{ background: COLUMN_ACCENT[column] }}
        />
        <h3 className="text-[12px] font-semibold uppercase tracking-[0.1em] text-mute">
          {COLUMN_LABELS[column]}
        </h3>
        <span className="rounded bg-overlay px-1.5 py-px font-mono text-[10px] text-faint">
          {tasks.length}
        </span>
        {runningCount > 0 ? (
          <span className="inline-flex items-center gap-1 font-mono text-[10px] text-ember">
            <span className="h-1 w-1 rounded-full bg-ember animate-pulse-glow" />
            {runningCount}
          </span>
        ) : null}
        <span className="flex-1" />
        {column === "todo" && onNewTask ? (
          <button
            onClick={onNewTask}
            className="rounded p-1 text-faint transition-colors hover:bg-hover hover:text-ink"
            title="New task"
          >
            <IconPlus size={13} />
          </button>
        ) : null}
      </header>

      {/* cards */}
      <div className="flex-1 space-y-2 overflow-y-auto px-2.5 pb-3">
        {tasks.length === 0 ? (
          <div className="mx-0.5 mt-1 rounded-lg border border-dashed border-edge px-3 py-5 text-center">
            <p className="text-[11px] leading-relaxed text-faint">{COLUMN_HINT[column]}</p>
          </div>
        ) : (
          tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              project={projectById.get(task.projectId)}
              config={config}
              onOpen={onOpenTask}
            />
          ))
        )}
      </div>
    </section>
  );
}
