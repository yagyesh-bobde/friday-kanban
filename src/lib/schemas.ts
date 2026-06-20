/**
 * Zod schemas mirroring src/lib/types.ts. Used for:
 * - API route input validation (CreateProject/CreateTask/MoveTask/UpdateConfig inputs)
 * - Parsing the codex reviewer verdict (reviewVerdictSchema)
 * - Validating rows hydrated from SQLite JSON columns
 *
 * Keep in sync with types.ts; each schema is type-checked against the
 * corresponding interface via `satisfies z.ZodType<...>`.
 */

import { z } from "zod";
import { MAX_ATTACHMENTS } from "./constants";
import type {
  AgentRun,
  AppConfig,
  BranchPR,
  CreateProjectInput,
  CreateTaskInput,
  ModelSpec,
  MoveTaskInput,
  Project,
  ProjectRepo,
  ProjectStatusReport,
  QuickCreateInput,
  ReviewFinding,
  ReviewVerdict,
  Task,
  TaskEvent,
  TaskImageInput,
  UpdateConfigInput,
} from "./types";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const providerSchema = z.enum(["claude-code", "codex"]);
export const effortSchema = z.enum(["low", "medium", "high", "xhigh", "max"]);
export const agentColumnSchema = z.enum(["in_dev", "in_review"]);
export const columnSchema = z.enum(["todo", "in_dev", "in_review", "done"]);
export const runStateSchema = z.enum(["idle", "queued", "running", "needs_attention", "error"]);
export const workspaceModeSchema = z.enum(["branch", "worktree", "new-branch"]);
export const executionSchema = z.enum(["local", "cloud"]);
export const schedulerModeSchema = z.enum(["manual", "auto"]);
export const findingSeveritySchema = z.enum(["blocker", "major", "minor"]);
export const agentRoleSchema = z.enum(["implementer", "reviewer", "summarizer"]);
export const taskEventTypeSchema = z.enum([
  "task_created",
  "task_queued",
  "dev_started",
  "dev_completed",
  "dev_failed",
  "review_started",
  "review_approved",
  "review_changes_requested",
  "review_failed",
  "review_cap_exhausted",
  "fix_started",
  "pr_created",
  "task_retried",
  "task_canceled",
  "task_interrupted",
  "manual_move",
  "budget_exceeded",
  "error",
]);

// ---------------------------------------------------------------------------
// Core value objects
// ---------------------------------------------------------------------------

export const modelSpecSchema = z.object({
  provider: providerSchema,
  model: z.string().min(1),
  effort: effortSchema,
}) satisfies z.ZodType<ModelSpec>;

export const modelOverridesSchema = z
  .object({
    in_dev: modelSpecSchema.optional(),
    in_review: modelSpecSchema.optional(),
  })
  .partial();

export const worktreeInfoSchema = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
  branch: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

export const projectRepoSchema = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
  baseBranch: z.string().min(1),
}) satisfies z.ZodType<ProjectRepo>;

export const projectSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  path: z.string().min(1),
  baseBranch: z.string().min(1),
  defaultExecution: executionSchema,
  repos: z.array(projectRepoSchema).optional(),
  createdAt: z.string(),
}) satisfies z.ZodType<Project>;

export const taskSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  title: z.string().min(1),
  prompt: z.string().min(1),
  contextPaths: z.array(z.string()),
  scopePaths: z.array(z.string()),
  branch: z.string().min(1),
  repoBranches: z.record(z.string(), z.string().min(1)).optional(),
  workspaceMode: workspaceModeSchema,
  column: columnSchema,
  runState: runStateSchema,
  execution: executionSchema,
  modelOverrides: modelOverridesSchema.optional(),
  worktree: worktreeInfoSchema.optional(),
  claudeSessionId: z.string().optional(),
  codexThreadId: z.string().optional(),
  remoteSessionId: z.string().optional(),
  reviewCycle: z.number().int().min(0),
  commitShas: z.array(z.string()),
  prUrl: z.string().optional(),
  costUsd: z.number(),
  error: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
}) satisfies z.ZodType<Task>;

export const taskEventSchema = z.object({
  id: z.number().int(),
  taskId: z.string(),
  type: taskEventTypeSchema,
  at: z.string(),
  payload: z.unknown().optional(),
}) satisfies z.ZodType<TaskEvent>;

export const reviewFindingSchema = z.object({
  // Claude Code reviewers (no enforced output schema) sometimes emit `file:
  // null` for a finding that isn't tied to a specific file; coerce to a label
  // so a loose verdict still parses.
  file: z
    .string()
    .nullish()
    .transform((v) => v ?? "(general)"),
  // codex emits `line: null` (nullable in the strict output schema) when the
  // finding isn't tied to a line; normalize to undefined for consumers.
  line: z
    .number()
    .int()
    .nullish()
    .transform((v) => v ?? undefined),
  severity: findingSeveritySchema,
  comment: z.string(),
}) satisfies z.ZodType<ReviewFinding>;

export const reviewVerdictSchema = z.object({
  verdict: z.enum(["approve", "request_changes"]),
  summary: z.string(),
  findings: z.array(reviewFindingSchema),
}) satisfies z.ZodType<ReviewVerdict>;

export const agentRunUsageSchema = z.object({
  input: z.number(),
  output: z.number(),
  cached: z.number(),
});

export const agentRunSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  role: agentRoleSchema,
  spec: modelSpecSchema,
  argv: z.array(z.string()),
  pid: z.number().int().optional(),
  startedAt: z.string(),
  endedAt: z.string().optional(),
  exitCode: z.number().int().optional(),
  costUsd: z.number().optional(),
  usage: agentRunUsageSchema.optional(),
  transcriptPath: z.string(),
  reviewCycle: z.number().int().optional(),
}) satisfies z.ZodType<AgentRun>;

export const branchPrSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  branch: z.string().min(1),
  prUrl: z.string().min(1),
  repoPath: z.string().min(1).optional(),
  repoName: z.string().min(1).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
}) satisfies z.ZodType<BranchPR>;

export const projectStatusReportSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  summary: z.string(),
  commitCount: z.number().int(),
  prsMerged: z.number().int(),
  tasksCompleted: z.number().int(),
  createdAt: z.string(),
}) satisfies z.ZodType<ProjectStatusReport>;

export const appConfigSchema = z.object({
  schedulerMode: schedulerModeSchema,
  maxConcurrentTasks: z.number().int().min(1),
  maxReviewCycles: z.number().int().min(1),
  columnDefaults: z.object({
    in_dev: modelSpecSchema,
    in_review: modelSpecSchema,
  }),
}) satisfies z.ZodType<AppConfig>;

// ---------------------------------------------------------------------------
// API inputs
// ---------------------------------------------------------------------------

export const createProjectInputSchema = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
  baseBranch: z.string().min(1).optional(),
  defaultExecution: executionSchema.optional(),
  repos: z
    .array(
      z.object({
        name: z.string().min(1),
        path: z.string().min(1),
        baseBranch: z.string().min(1).optional(),
      }),
    )
    .optional(),
}) satisfies z.ZodType<CreateProjectInput>;

export const taskImageInputSchema = z.object({
  name: z.string().min(1),
  // data:image/<type>;base64,<payload> — content type/size enforced on decode.
  dataUrl: z.string().regex(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, "must be a base64 image data URL"),
}) satisfies z.ZodType<TaskImageInput>;

export const createTaskInputSchema = z.object({
  projectId: z.string().min(1),
  title: z.string().min(1),
  prompt: z.string().min(1),
  contextPaths: z.array(z.string()).optional(),
  scopePaths: z.array(z.string()).optional(),
  images: z.array(taskImageInputSchema).max(MAX_ATTACHMENTS).optional(),
  branch: z.string().min(1).optional(),
  repoBranches: z.record(z.string(), z.string().min(1)).optional(),
  workspaceMode: workspaceModeSchema.optional(),
  execution: executionSchema.optional(),
  modelOverrides: modelOverridesSchema.optional(),
  startNow: z.boolean().optional(),
}) satisfies z.ZodType<CreateTaskInput>;

export const moveTaskInputSchema = z.object({
  to: columnSchema,
  comment: z.string().optional(),
}) satisfies z.ZodType<MoveTaskInput>;

export const sendMessageInputSchema = z.object({
  message: z.string().min(1),
});

export const updateConfigInputSchema = appConfigSchema.partial() satisfies z.ZodType<UpdateConfigInput>;

// ── Quick task create (Cmd+K) ──────────────────────────────────────────────

/** Request body for POST /api/tasks/quick-create. */
export const quickCreateInputSchema = z.object({
  text: z.string().min(1),
  answers: z
    .array(z.object({ id: z.string().min(1), answer: z.string().min(1) }))
    .optional(),
}) satisfies z.ZodType<QuickCreateInput>;

const quickParseQuestionSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
  options: z.array(z.string()).default([]),
});

/**
 * Validates the JSON object the Haiku parser emits — either a ready-to-create
 * task or a round of clarifying questions.
 */
export const quickParseOutputSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("task"),
    task: z.object({
      projectId: z.string().min(1),
      title: z.string().min(1),
      prompt: z.string().min(1),
      branch: z.string().min(1).optional(),
      scopePaths: z.array(z.string().min(1)).optional(),
      contextPaths: z.array(z.string().min(1)).optional(),
      execution: executionSchema.optional(),
    }),
  }),
  z.object({
    kind: z.literal("questions"),
    questions: z.array(quickParseQuestionSchema).min(1),
  }),
]);
