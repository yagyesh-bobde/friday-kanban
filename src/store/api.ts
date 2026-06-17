/**
 * Thin typed client over the friday-kanban HTTP API (docs/API.md).
 * Every non-2xx response carries the ApiError envelope { error, code? } —
 * surfaced here as a thrown ApiHttpError so callers can branch on `code`
 * (e.g. 501 not_implemented during scaffold phase, 409 invalid_transition).
 */

import type {
  AppConfig,
  BoardSnapshot,
  BranchPR,
  Column,
  CreateProjectInput,
  CreateTaskInput,
  Project,
  ProjectBranches,
  ProjectStatusReport,
  Task,
  TaskDetail,
  UpdateConfigInput,
} from "@/lib/types";

export class ApiHttpError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "ApiHttpError";
    this.status = status;
    this.code = code;
  }

  /** Human-friendly one-liner for toasts. */
  get friendly(): string {
    if (this.status === 501 || this.code === "not_implemented") {
      return "Pipeline not wired up yet (501 not_implemented)";
    }
    return this.message;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: {
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    });
  } catch {
    throw new ApiHttpError(0, "Server unreachable — is friday running?");
  }

  if (res.status === 204) return undefined as T;

  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    let code: string | undefined;
    try {
      const body = (await res.json()) as { error?: string; code?: string };
      if (body.error) message = body.error;
      code = body.code;
    } catch {
      // non-JSON error body; keep status text
    }
    throw new ApiHttpError(res.status, message, code);
  }

  return (await res.json()) as T;
}

const post = (body: unknown): RequestInit => ({
  method: "POST",
  body: JSON.stringify(body),
});

export const api = {
  // board ---------------------------------------------------------------
  board: () => request<BoardSnapshot>("/api/board"),

  // projects ------------------------------------------------------------
  projects: () => request<Project[]>("/api/projects"),
  createProject: (input: CreateProjectInput) =>
    request<Project>("/api/projects", post(input)),
  branches: (projectId: string) =>
    request<ProjectBranches>(`/api/projects/${projectId}/branches`),
  createPr: (projectId: string, branch: string) =>
    request<BranchPR>(`/api/projects/${projectId}/create-pr`, post({ branch })),

  // tasks ---------------------------------------------------------------
  createTask: (input: CreateTaskInput) =>
    request<Task>("/api/tasks", post(input)),
  taskDetail: (taskId: string) => request<TaskDetail>(`/api/tasks/${taskId}`),
  moveTask: (taskId: string, to: Column, comment?: string) =>
    request<Task>(
      `/api/tasks/${taskId}/move`,
      post(comment !== undefined ? { to, comment } : { to }),
    ),
  retryTask: (taskId: string) =>
    request<Task>(`/api/tasks/${taskId}/retry`, { method: "POST" }),
  sendMessage: (taskId: string, message: string) =>
    request<Task>(`/api/tasks/${taskId}/message`, post({ message })),
  /**
   * NOTE: cancel is referenced by DESIGN/orchestrator (cancelTask) but is not
   * in docs/API.md's route list yet — the api agent must expose this route.
   */
  cancelTask: (taskId: string) =>
    request<Task>(`/api/tasks/${taskId}/cancel`, { method: "POST" }),
  deleteTask: (taskId: string) =>
    request<void>(`/api/tasks/${taskId}`, { method: "DELETE" }),

  // config ----------------------------------------------------------------
  config: () => request<AppConfig>("/api/config"),
  updateConfig: (patch: UpdateConfigInput) =>
    request<AppConfig>("/api/config", {
      method: "PUT",
      body: JSON.stringify(patch),
    }),

  // status reports ----------------------------------------------------------
  statusReports: () => request<ProjectStatusReport[]>("/api/status-reports"),
};
