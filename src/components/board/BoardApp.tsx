"use client";

/**
 * Top-level board shell: hydrates the store, wires DnD (drag is a command —
 * only legal pipeline transitions are accepted as drop targets), and mounts
 * the header, columns, status pane, drawer, modals and toasts.
 */

import { useEffect, useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import type { Column as ColumnId, Task } from "@/lib/types";
import { COLUMNS } from "@/lib/constants";
import { useBoard } from "@/store/board";
import { useUi } from "@/store/ui";
import { isPastTask, legalTargetsFor } from "@/components/util";
import { BoardHeader } from "./BoardHeader";
import { BoardColumn } from "./Column";
import { PastTasksPane } from "./PastTasksPane";
import { TaskCardBody } from "./TaskCard";
import { StatusPane } from "@/components/StatusPane";
import { Toasts } from "@/components/ui/Toasts";
import { NewTaskModal } from "@/components/modals/NewTaskModal";
import { QuickCreateModal } from "@/components/modals/QuickCreateModal";
import { AddProjectModal } from "@/components/modals/AddProjectModal";
import { SendBackDialog } from "@/components/modals/SendBackDialog";
import { TaskDrawer } from "@/components/task/TaskDrawer";
import { SettingsView } from "@/components/settings/SettingsView";
import { FireVibes } from "@/components/effects/FireVibes";
import { IconFolder, IconSpark, Spinner } from "@/components/ui/icons";
import { Button } from "@/components/ui/fields";

function NoProjects() {
  const openAddProject = useUi((s) => s.openAddProject);
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
      <div className="relative">
        <IconSpark size={40} className="text-ember/80" />
        <div className="absolute inset-0 -z-10 blur-2xl" style={{ background: "rgba(242,163,60,0.15)" }} />
      </div>
      <div>
        <h2 className="text-lg font-semibold tracking-tight">No projects yet</h2>
        <p className="mt-1 max-w-sm text-[13px] leading-relaxed text-mute">
          Register a local git repo and friday will run Claude Code + Codex agents
          against it — implemented, reviewed, and committed on a kanban.
        </p>
      </div>
      <Button variant="primary" onClick={openAddProject}>
        <IconFolder size={13} />
        Add your first project
      </Button>
    </div>
  );
}

function BoardColumns() {
  const tasks = useBoard((s) => s.tasks);
  const projects = useBoard((s) => s.projects);
  const config = useBoard((s) => s.config);
  const moveTask = useBoard((s) => s.moveTask);
  const openDrawer = useUi((s) => s.openDrawer);
  const openNewTask = useUi((s) => s.openNewTask);
  const openSendBack = useUi((s) => s.openSendBack);

  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const byColumn = useMemo(() => {
    const map: Record<ColumnId, Task[]> = { todo: [], in_dev: [], in_review: [], done: [] };
    // Done cards aged past the cutoff live in the Past view, not the board.
    for (const task of Object.values(tasks)) {
      if (isPastTask(task)) continue;
      map[task.column].push(task);
    }
    // todo: FIFO order (oldest first, matches queue order); done: newest first;
    // active columns: most recently touched first.
    map.todo.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    map.in_dev.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    map.in_review.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    map.done.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return map;
  }, [tasks]);

  const dragTargets = activeTask ? legalTargetsFor(activeTask) : null;

  const onDragStart = (event: DragStartEvent) => {
    const task = event.active.data.current?.task as Task | undefined;
    setActiveTask(task ?? null);
  };

  const onDragEnd = (event: DragEndEvent) => {
    const task = activeTask;
    setActiveTask(null);
    if (!task || !event.over) return;
    const to = event.over.id as ColumnId;
    if (to === task.column) return;
    if (!legalTargetsFor(task).includes(to)) return;

    if (task.column === "in_review" && to === "in_dev") {
      // typed comment required — dialog sends the move command itself
      openSendBack(task.id);
      return;
    }
    void moveTask(task.id, to);
  };

  const activeProject = activeTask
    ? projects.find((p) => p.id === activeTask.projectId)
    : undefined;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActiveTask(null)}
    >
      <div className="flex h-full gap-3 overflow-x-auto px-4 py-3.5">
        {COLUMNS.map((column) => (
          <BoardColumn
            key={column}
            column={column}
            tasks={byColumn[column]}
            projects={projects}
            config={config}
            dragTargets={dragTargets}
            onOpenTask={openDrawer}
            onNewTask={column === "todo" ? () => openNewTask() : undefined}
          />
        ))}
      </div>
      <DragOverlay dropAnimation={null}>
        {activeTask ? (
          <div className="w-[284px]">
            <TaskCardBody task={activeTask} project={activeProject} config={config} overlay />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

export default function BoardApp() {
  const init = useBoard((s) => s.init);
  const refresh = useBoard((s) => s.refresh);
  const loaded = useBoard((s) => s.loaded);
  const loadError = useBoard((s) => s.loadError);
  const hasProjects = useBoard((s) => s.projects.length > 0);
  const boardView = useUi((s) => s.boardView);
  const openQuickCreate = useUi((s) => s.openQuickCreate);
  const settingsOpen = useUi((s) => s.settingsOpen);
  const openSettings = useUi((s) => s.openSettings);
  const closeSettings = useUi((s) => s.closeSettings);
  const anyModalOpen = useUi(
    (s) =>
      s.quickCreateOpen ||
      s.newTaskOpen ||
      s.addProjectOpen ||
      s.sendBackTaskId !== null ||
      s.drawerTaskId !== null,
  );

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
    const onKey = (e: KeyboardEvent) => {
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (!mod || e.shiftKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === "k") {
        e.preventDefault();
        if (!anyModalOpen && !settingsOpen) openQuickCreate();
      } else if (key === "p") {
        // Cmd/Ctrl+P toggles the full-page settings view.
        e.preventDefault();
        if (settingsOpen) closeSettings();
        else if (!anyModalOpen) openSettings();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [anyModalOpen, settingsOpen, openQuickCreate, openSettings, closeSettings]);

  return (
    <div className="board-grid flex h-screen flex-col overflow-hidden">
      <BoardHeader />

      <main className="min-h-0 flex-1">
        {!loaded ? (
          <div className="flex h-full flex-col items-center justify-center gap-3">
            {loadError ? (
              <>
                <p className="font-mono text-[12px] text-danger">{loadError}</p>
                <Button variant="ghost" onClick={() => void refresh()}>
                  Retry
                </Button>
              </>
            ) : (
              <>
                <Spinner size={20} className="text-ember" />
                <p className="font-mono text-[11px] text-faint">loading board…</p>
              </>
            )}
          </div>
        ) : !hasProjects ? (
          <NoProjects />
        ) : boardView === "past" ? (
          <PastTasksPane />
        ) : (
          <BoardColumns />
        )}
      </main>

      <StatusPane />

      {/* overlays */}
      <SettingsView />
      <TaskDrawer />
      <NewTaskModal />
      <QuickCreateModal />
      <AddProjectModal />
      <SendBackDialog />
      <Toasts />

      {/* just for the vibes */}
      <FireVibes />
    </div>
  );
}
