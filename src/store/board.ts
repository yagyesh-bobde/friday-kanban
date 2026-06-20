/**
 * Board data store.
 *
 * Hydrates once from GET /api/board, then applies BoardEvents from the single
 * app-wide EventSource on GET /api/events incrementally. Drag moves are
 * optimistic: the card jumps immediately, and on a rejected move (4xx/5xx)
 * the previous task row is restored and an error toast is raised.
 */

import { create } from "zustand";
import type {
  AppConfig,
  BoardEvent,
  BranchPR,
  Column,
  CreateProjectInput,
  CreateTaskInput,
  Project,
  ProjectStatusReport,
  Task,
  UpdateConfigInput,
} from "@/lib/types";
import { DEFAULT_APP_CONFIG } from "@/lib/constants";
import { api, ApiHttpError } from "./api";
import { useUi } from "./ui";

export type Connection = "connecting" | "online" | "offline";

interface BoardStore {
  loaded: boolean;
  loadError: string | null;
  connection: Connection;

  projects: Project[];
  /** Keyed by task id; column membership derived in selectors. */
  tasks: Record<string, Task>;
  branchPrs: BranchPR[];
  config: AppConfig;

  /** null = never fetched; [] = fetched, empty. */
  statusReports: ProjectStatusReport[] | null;
  statusReportsLoading: boolean;
  statusReportsError: string | null;

  init: () => Promise<void>;
  refresh: () => Promise<void>;
  applyEvent: (event: BoardEvent) => void;

  moveTask: (taskId: string, to: Column, comment?: string) => Promise<boolean>;
  retryTask: (taskId: string) => Promise<void>;
  sendMessage: (taskId: string, message: string) => Promise<boolean>;
  cancelTask: (taskId: string) => Promise<void>;
  deleteTask: (taskId: string) => Promise<boolean>;
  createTask: (input: CreateTaskInput) => Promise<Task>;
  createProject: (input: CreateProjectInput) => Promise<Project>;
  updateConfig: (patch: UpdateConfigInput) => Promise<void>;
  createPr: (projectId: string, branch: string) => Promise<BranchPR[]>;
  loadStatusReports: () => Promise<void>;
}

// Module-level singletons so React StrictMode double-effects / HMR don't open
// a second EventSource.
let initStarted = false;
let eventSource: EventSource | null = null;

function toastError(title: string, err: unknown) {
  const message =
    err instanceof ApiHttpError ? err.friendly : err instanceof Error ? err.message : String(err);
  useUi.getState().toast("error", title, message);
}

export const useBoard = create<BoardStore>()((set, get) => ({
  loaded: false,
  loadError: null,
  connection: "connecting",

  projects: [],
  tasks: {},
  branchPrs: [],
  config: DEFAULT_APP_CONFIG,

  statusReports: null,
  statusReportsLoading: false,
  statusReportsError: null,

  init: async () => {
    if (initStarted) return;
    initStarted = true;

    await get().refresh();

    eventSource = new EventSource("/api/events");
    eventSource.onopen = () => set({ connection: "online" });
    eventSource.onerror = () => set({ connection: "offline" });
    eventSource.onmessage = (msg) => {
      try {
        const event = JSON.parse(msg.data as string) as BoardEvent;
        get().applyEvent(event);
      } catch {
        // malformed frame — ignore
      }
    };

    // Prefetch the daily status in the background so the pane is ready to
    // display the moment it's expanded. Not awaited: report generation can
    // take seconds (haiku summarizer) and must not block the board. Live
    // status_report_ready events still patch in any reports that finish later.
    void get().loadStatusReports();
  },

  refresh: async () => {
    try {
      const snapshot = await api.board();
      const tasks: Record<string, Task> = {};
      for (const t of snapshot.tasks) tasks[t.id] = t;
      set({
        loaded: true,
        loadError: null,
        projects: snapshot.projects,
        tasks,
        branchPrs: snapshot.branchPrs,
        config: snapshot.config,
      });
    } catch (err) {
      set({
        loaded: false,
        loadError:
          err instanceof ApiHttpError ? err.friendly : "Failed to load the board",
      });
    }
  },

  applyEvent: (event) => {
    switch (event.type) {
      case "task_created":
      case "task_updated":
        set((s) => ({ tasks: { ...s.tasks, [event.task.id]: event.task } }));
        break;
      case "task_deleted":
        set((s) => {
          const tasks = { ...s.tasks };
          delete tasks[event.taskId];
          return { tasks };
        });
        break;
      case "task_event_appended":
      case "transcript_item":
        // Drawer-level concerns; the drawer keeps its own SSE/refetch cycle.
        break;
      case "project_created":
      case "project_updated":
        set((s) => {
          const exists = s.projects.some((p) => p.id === event.project.id);
          return {
            projects: exists
              ? s.projects.map((p) => (p.id === event.project.id ? event.project : p))
              : [...s.projects, event.project],
          };
        });
        break;
      case "project_deleted":
        set((s) => ({
          projects: s.projects.filter((p) => p.id !== event.projectId),
          tasks: Object.fromEntries(
            Object.entries(s.tasks).filter(([, t]) => t.projectId !== event.projectId),
          ),
        }));
        break;
      case "branch_pr_updated":
        set((s) => {
          const exists = s.branchPrs.some((b) => b.id === event.branchPr.id);
          return {
            branchPrs: exists
              ? s.branchPrs.map((b) => (b.id === event.branchPr.id ? event.branchPr : b))
              : [...s.branchPrs, event.branchPr],
          };
        });
        break;
      case "status_report_ready":
        set((s) => {
          const reports = s.statusReports ?? [];
          const exists = reports.some((r) => r.id === event.report.id);
          return {
            statusReports: exists
              ? reports.map((r) => (r.id === event.report.id ? event.report : r))
              : [...reports, event.report],
          };
        });
        break;
      case "config_updated":
        set({ config: event.config });
        break;
      case "notification":
        useUi
          .getState()
          .toast("info", event.title, event.message, event.taskId);
        break;
    }
  },

  moveTask: async (taskId, to, comment) => {
    const prev = get().tasks[taskId];
    if (!prev) return false;

    // optimistic: jump column; transitions out of a drag always pass through
    // a queued/working phase server-side.
    const optimistic: Task = {
      ...prev,
      column: to,
      runState: prev.runState === "running" ? prev.runState : "queued",
      updatedAt: new Date().toISOString(),
    };
    set((s) => ({ tasks: { ...s.tasks, [taskId]: optimistic } }));

    try {
      const updated = await api.moveTask(taskId, to, comment);
      set((s) => ({ tasks: { ...s.tasks, [updated.id]: updated } }));
      return true;
    } catch (err) {
      // rollback
      set((s) => ({ tasks: { ...s.tasks, [taskId]: prev } }));
      toastError("Move rejected", err);
      return false;
    }
  },

  retryTask: async (taskId) => {
    try {
      const updated = await api.retryTask(taskId);
      set((s) => ({ tasks: { ...s.tasks, [updated.id]: updated } }));
      useUi.getState().toast("info", "Retrying task");
    } catch (err) {
      toastError("Retry failed", err);
    }
  },

  sendMessage: async (taskId, message) => {
    try {
      const updated = await api.sendMessage(taskId, message);
      set((s) => ({ tasks: { ...s.tasks, [updated.id]: updated } }));
      useUi.getState().toast("info", "Message sent — resuming task");
      return true;
    } catch (err) {
      toastError("Send failed", err);
      return false;
    }
  },

  cancelTask: async (taskId) => {
    try {
      const updated = await api.cancelTask(taskId);
      set((s) => ({ tasks: { ...s.tasks, [updated.id]: updated } }));
      useUi.getState().toast("info", "Task canceled");
    } catch (err) {
      toastError("Cancel failed", err);
    }
  },

  deleteTask: async (taskId) => {
    try {
      await api.deleteTask(taskId);
      set((s) => {
        const tasks = { ...s.tasks };
        delete tasks[taskId];
        return { tasks };
      });
      return true;
    } catch (err) {
      toastError("Delete failed", err);
      return false;
    }
  },

  createTask: async (input) => {
    const task = await api.createTask(input);
    set((s) => ({ tasks: { ...s.tasks, [task.id]: task } }));
    return task;
  },

  createProject: async (input) => {
    const project = await api.createProject(input);
    set((s) => ({
      projects: s.projects.some((p) => p.id === project.id)
        ? s.projects
        : [...s.projects, project],
    }));
    return project;
  },

  updateConfig: async (patch) => {
    const prev = get().config;
    // optimistic for snappy toggles
    set({ config: { ...prev, ...patch } as AppConfig });
    try {
      const next = await api.updateConfig(patch);
      set({ config: next });
    } catch (err) {
      set({ config: prev });
      toastError("Config update failed", err);
    }
  },

  createPr: async (projectId, branch) => {
    const prs = await api.createPr(projectId, branch);
    set((s) => {
      const byId = new Map(s.branchPrs.map((b) => [b.id, b]));
      for (const pr of prs) byId.set(pr.id, pr);
      return { branchPrs: [...byId.values()] };
    });
    return prs;
  },

  loadStatusReports: async () => {
    if (get().statusReportsLoading) return;
    set({ statusReportsLoading: true, statusReportsError: null });
    try {
      const reports = await api.statusReports();
      set({ statusReports: reports, statusReportsLoading: false });
    } catch (err) {
      set({
        statusReportsLoading: false,
        statusReportsError:
          err instanceof ApiHttpError ? err.friendly : "Failed to load status reports",
      });
    }
  },
}));
