"use client";

/**
 * Board header: brand + connection state, scheduler mode toggle + concurrency
 * cap (PUT /api/config), Create PR menu, settings, Add Project, New Task.
 */

import { useEffect, useState } from "react";
import { useBoard } from "@/store/board";
import { useUi } from "@/store/ui";
import { useFeatureFlag } from "@/lib/featureFlags";
import { cn, isPastTask } from "@/components/util";
import { Segmented, Stepper } from "@/components/ui/fields";
import { IconGear, IconPlus, IconSpark } from "@/components/ui/icons";
import { CreatePrMenu } from "./CreatePrMenu";

/** ⌘ on macOS, Ctrl elsewhere. Resolved after mount to avoid SSR mismatch. */
function useModKey() {
  const [mod, setMod] = useState("⌘");
  useEffect(() => {
    setMod(/Mac|iPhone|iPad|iPod/.test(navigator.platform) ? "⌘" : "Ctrl");
  }, []);
  return mod;
}

export function BoardHeader() {
  const config = useBoard((s) => s.config);
  const connection = useBoard((s) => s.connection);
  const updateConfig = useBoard((s) => s.updateConfig);
  const projects = useBoard((s) => s.projects);
  const pastCount = useBoard((s) =>
    Object.values(s.tasks).reduce((n, t) => n + (isPastTask(t) ? 1 : 0), 0),
  );
  const openNewTask = useUi((s) => s.openNewTask);
  const openAddProject = useUi((s) => s.openAddProject);
  const openSettings = useUi((s) => s.openSettings);
  const boardView = useUi((s) => s.boardView);
  const setBoardView = useUi((s) => s.setBoardView);
  const keyboardHints = useFeatureFlag("keyboardHints");
  const mod = useModKey();

  return (
    <header className="relative z-40 flex h-12 shrink-0 items-center gap-3 border-b border-edge bg-panel/80 px-4 backdrop-blur">
      {/* brand */}
      <div className="flex items-center gap-2">
        <IconSpark size={16} className="text-ember" />
        <span className="text-[14px] font-semibold tracking-tight">friday</span>
        <span
          className={cn(
            "ml-1 inline-flex items-center gap-1.5 rounded-full border px-2 py-px font-mono text-[9.5px] uppercase tracking-wider",
            connection === "online"
              ? "border-ok/25 text-ok"
              : connection === "connecting"
                ? "border-edge text-faint"
                : "border-danger/30 text-danger",
          )}
          title="SSE event stream"
        >
          <span
            className={cn(
              "h-1 w-1 rounded-full",
              connection === "online"
                ? "bg-ok"
                : connection === "connecting"
                  ? "bg-faint"
                  : "bg-danger animate-pulse-glow",
            )}
          />
          {connection === "online" ? "live" : connection}
        </span>
      </div>

      <div className="mx-1 h-5 w-px bg-edge" />

      {/* scheduler */}
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-faint">
          Scheduler
        </span>
        <Segmented
          size="sm"
          value={config.schedulerMode}
          onChange={(mode) => void updateConfig({ schedulerMode: mode })}
          options={[
            { value: "manual", label: "Manual", title: "Drag Todo → In Dev to start a task" },
            { value: "auto", label: "Auto", title: "Drain Todo up to the concurrency cap" },
          ]}
        />
        {config.schedulerMode === "auto" ? (
          <Stepper
            label="cap"
            value={config.maxConcurrentTasks}
            min={1}
            max={20}
            onChange={(v) => void updateConfig({ maxConcurrentTasks: v })}
          />
        ) : null}
      </div>

      <span className="flex-1" />

      <Segmented
        size="sm"
        value={boardView}
        onChange={setBoardView}
        options={[
          { value: "board", label: "Board", title: "Active kanban" },
          {
            value: "past",
            title: "Done tasks untouched for over a week, by date",
            label: (
              <span className="inline-flex items-center gap-1.5">
                Past
                {pastCount > 0 ? (
                  <span className="rounded bg-overlay px-1 py-px font-mono text-[9px] text-faint">
                    {pastCount}
                  </span>
                ) : null}
              </span>
            ),
          },
        ]}
      />

      <div className="mx-1 h-5 w-px bg-edge" />

      {keyboardHints ? (
        <span className="hidden items-center gap-1.5 text-[11px] text-faint lg:flex">
          <kbd>{mod}K</kbd>
          <span>create</span>
          <kbd>{mod}P</kbd>
          <span>settings</span>
        </span>
      ) : null}

      <CreatePrMenu />
      <button
        onClick={() => openSettings()}
        className="rounded-md border border-edge p-[7px] text-mute transition-colors hover:border-edge-bright hover:text-ink"
        title={`Settings (${mod}P)`}
        aria-label="Settings"
      >
        <IconGear size={14} />
      </button>

      <div className="mx-1 h-5 w-px bg-edge" />

      <button
        onClick={openAddProject}
        className="inline-flex items-center gap-1.5 rounded-md border border-edge px-2.5 py-1.5 text-xs font-medium text-mute transition-colors hover:border-edge-bright hover:text-ink"
      >
        <IconPlus size={12} />
        Add project
      </button>
      <button
        onClick={() => openNewTask()}
        disabled={projects.length === 0}
        className="inline-flex items-center gap-1.5 rounded-md bg-ember px-3 py-1.5 text-xs font-semibold text-[#1a1206] shadow-[0_0_16px_rgba(242,163,60,0.18)] transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
        title={projects.length === 0 ? "Add a project first" : "Create a task"}
      >
        <IconPlus size={12} />
        New task
      </button>
    </header>
  );
}
