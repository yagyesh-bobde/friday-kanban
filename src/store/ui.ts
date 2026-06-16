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

interface UiStore {
  // new task modal
  newTaskOpen: boolean;
  newTaskProjectId?: string;
  openNewTask: (projectId?: string) => void;
  closeNewTask: () => void;

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
  newTaskOpen: false,
  newTaskProjectId: undefined,
  openNewTask: (projectId) =>
    set({ newTaskOpen: true, newTaskProjectId: projectId }),
  closeNewTask: () => set({ newTaskOpen: false, newTaskProjectId: undefined }),

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
