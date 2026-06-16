/**
 * Shared pipeline helpers: model-spec resolution (task override -> column
 * default), workspace directory resolution, and prompt-building utilities.
 */

import type { AgentColumn, ModelSpec, Project, ReviewVerdict, Task } from "@/lib/types";
import { getConfig } from "@/server/db/config";
import { getProject } from "@/server/db/projects";
import { TaskNotFoundError } from "./stateMachine";

/** Resolution: task override -> column default (config). */
export function resolveModelSpec(task: Task, column: AgentColumn): ModelSpec {
  return task.modelOverrides?.[column] ?? getConfig().columnDefaults[column];
}

export function requireProject(projectId: string): Project {
  const project = getProject(projectId);
  if (!project) {
    // Reuse the not_found error shape; the API maps code 'not_found' -> 404.
    throw new TaskNotFoundError(`project:${projectId}`);
  }
  return project;
}

/** Directory the task's agents run in: worktree path or the main checkout. */
export function workspaceDir(task: Task, project: Project): string {
  if (task.workspaceMode === "worktree" && task.worktree) {
    return task.worktree.path;
  }
  return project.path;
}

/** Render review findings as markdown for the implementer fix prompt. */
export function renderFindingsMarkdown(verdict: ReviewVerdict): string {
  const lines: string[] = [];
  if (verdict.summary.trim().length > 0) {
    lines.push(`**Reviewer summary:** ${verdict.summary.trim()}`, "");
  }
  const blockers = verdict.findings.filter((f) => f.severity === "blocker");
  const rest = verdict.findings.filter((f) => f.severity !== "blocker");
  if (blockers.length > 0) {
    lines.push("**Blocking findings (must fix):**", "");
    for (const f of blockers) {
      lines.push(`- \`${f.file}${f.line !== undefined ? `:${f.line}` : ""}\` — ${f.comment}`);
    }
    lines.push("");
  }
  if (rest.length > 0) {
    lines.push("**Non-blocking findings (fix if quick, otherwise note why not):**", "");
    for (const f of rest) {
      lines.push(
        `- [${f.severity}] \`${f.file}${f.line !== undefined ? `:${f.line}` : ""}\` — ${f.comment}`,
      );
    }
    lines.push("");
  }
  return lines.join("\n");
}
