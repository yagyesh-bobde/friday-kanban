"use client";

/**
 * Past tasks: Done cards that have aged off the active board (untouched for
 * more than PAST_TASK_AGE_DAYS). Read-only — grouped by the day they were last
 * touched, latest day first, newest card first within each day. Clicking a
 * card opens its drawer, same as the board.
 */

import { useMemo } from "react";
import type { Task } from "@/lib/types";
import { useBoard } from "@/store/board";
import { useUi } from "@/store/ui";
import {
  PAST_TASK_AGE_DAYS,
  dateGroupKey,
  dateGroupLabel,
  isPastTask,
} from "@/components/util";
import { TaskCardBody } from "./TaskCard";
import { IconArchive } from "@/components/ui/icons";

interface DayGroup {
  key: string;
  label: string;
  tasks: Task[];
}

export function PastTasksPane() {
  const tasks = useBoard((s) => s.tasks);
  const projects = useBoard((s) => s.projects);
  const config = useBoard((s) => s.config);
  const openDrawer = useUi((s) => s.openDrawer);

  const groups = useMemo<DayGroup[]>(() => {
    const past = Object.values(tasks).filter(isPastTask);
    const byDay = new Map<string, DayGroup>();
    for (const task of past) {
      const key = dateGroupKey(task.updatedAt);
      let group = byDay.get(key);
      if (!group) {
        group = { key, label: dateGroupLabel(task.updatedAt), tasks: [] };
        byDay.set(key, group);
      }
      group.tasks.push(task);
    }
    const ordered = [...byDay.values()].sort((a, b) => b.key.localeCompare(a.key));
    for (const group of ordered) {
      group.tasks.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }
    return ordered;
  }, [tasks]);

  const projectById = useMemo(
    () => new Map(projects.map((p) => [p.id, p])),
    [projects],
  );

  if (groups.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <IconArchive size={32} className="text-faint" />
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight">No past tasks</h2>
          <p className="mt-1 max-w-sm text-[12.5px] leading-relaxed text-mute">
            Done tasks move here once they&rsquo;ve been untouched for more than{" "}
            {PAST_TASK_AGE_DAYS} days, keeping the board focused on recent work.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto px-4 py-5">
      <div className="mx-auto max-w-5xl space-y-7">
        {groups.map((group) => (
          <section key={group.key}>
            <header className="sticky top-0 z-10 -mx-1 mb-3 flex items-center gap-2 bg-panel/80 px-1 py-1 backdrop-blur">
              <h3 className="text-[12px] font-semibold uppercase tracking-[0.1em] text-mute">
                {group.label}
              </h3>
              <span className="h-px flex-1 bg-edge" />
              <span className="rounded bg-overlay px-1.5 py-px font-mono text-[10px] text-faint">
                {group.tasks.length}
              </span>
            </header>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {group.tasks.map((task) => (
                <button
                  key={task.id}
                  type="button"
                  onClick={() => openDrawer(task.id)}
                  className="cursor-pointer text-left"
                >
                  <TaskCardBody
                    task={task}
                    project={projectById.get(task.projectId)}
                    config={config}
                  />
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
