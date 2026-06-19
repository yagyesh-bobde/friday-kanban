/**
 * Ephemeral UI state: modals, drawer, status pane, toasts.
 * Kept separate from the board data store so SSE churn never re-renders
 * modal internals and vice versa.
 */

import { create } from "zustand";

export type ToastKind = "info" | "success" | "error";

export interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  message?: string;
  /** Optional task to open when the toast is clicked. */
  taskId?: string;
}

let toastSeq = 1;

export type BoardView = "board" | "past";

interface UiStore {
  // active board vs. past (aged-out done) tasks
  boardView: BoardView;
  setBoardView: (view: BoardView) => void;

  // new task modal
  newTaskOpen: boolean;
  newTaskProjectId?: string;
  newTaskInitialPrompt?: string;
  openNewTask: (projectId?: string, initialPrompt?: string) => void;
  closeNewTask: () => void;

  // quick-create modal (Cmd+K)
  quickCreateOpen: boolean;
  openQuickCreate: () => void;
  closeQuickCreate: () => void;

  // add project modal
  addProjectOpen: boolean;
  openAddProject: () => void;
  closeAddProject: () => void;

  // task detail drawer
  drawerTaskId: string | null;
  openDrawer: (taskId: string) => void;
  closeDrawer: () => void;

  // send-back-to-dev comment dialog (in_review -> in_dev)
  sendBackTaskId: string | null;
  openSendBack: (taskId: string) => void;
  closeSendBack: () => void;

  // bottom status pane
  statusPaneOpen: boolean;
  toggleStatusPane: () => void;

  // toasts
  toasts: Toast[];
  toast: (kind: ToastKind, title: string, message?: string, taskId?: string) => void;
  dismissToast: (id: number) => void;
}

export const useUi = create<UiStore>()((set, get) => ({
  boardView: "board",
  setBoardView: (view) => set({ boardView: view }),

  newTaskOpen: false,
  newTaskProjectId: undefined,
  newTaskInitialPrompt: undefined,
  openNewTask: (projectId, initialPrompt) =>
    set({ newTaskOpen: true, newTaskProjectId: projectId, newTaskInitialPrompt: initialPrompt }),
  closeNewTask: () =>
    set({ newTaskOpen: false, newTaskProjectId: undefined, newTaskInitialPrompt: undefined }),

  quickCreateOpen: false,
  openQuickCreate: () => set({ quickCreateOpen: true }),
  closeQuickCreate: () => set({ quickCreateOpen: false }),

  addProjectOpen: false,
  openAddProject: () => set({ addProjectOpen: true }),
  closeAddProject: () => set({ addProjectOpen: false }),

  drawerTaskId: null,
  openDrawer: (taskId) => set({ drawerTaskId: taskId }),
  closeDrawer: () => set({ drawerTaskId: null }),

  sendBackTaskId: null,
  openSendBack: (taskId) => set({ sendBackTaskId: taskId }),
  closeSendBack: () => set({ sendBackTaskId: null }),

  statusPaneOpen: false,
  toggleStatusPane: () => set((s) => ({ statusPaneOpen: !s.statusPaneOpen })),

  toasts: [],
  toast: (kind, title, message, taskId) => {
    const id = toastSeq++;
    set((s) => ({ toasts: [...s.toasts.slice(-4), { id, kind, title, message, taskId }] }));
    window.setTimeout(() => {
      get().dismissToast(id);
    }, kind === "error" ? 8000 : 5000);
  },
  dismissToast: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
