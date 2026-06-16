/**
 * friday-kanban domain model.
 *
 * Canonical TypeScript types for every entity. The zod validation schemas in
 * `src/lib/schemas.ts` mirror these; keep both in sync. Source of design truth:
 * DESIGN.md + docs/research/architecture-proposal.md §5 (with interview deltas).
 */

// ---------------------------------------------------------------------------
// Model / provider specs
// ---------------------------------------------------------------------------

export type Provider = "claude-code" | "codex";

/**
 * Effort levels are normalized; `max` maps to codex `xhigh` when the provider
 * is codex (see EFFORT_TO_CODEX in constants.ts).
 */
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface ModelSpec {
  provider: Provider;
  /** Provider-native model slug, e.g. 'opus', 'sonnet', 'haiku', 'gpt-5.5'. */
  model: string;
  effort: Effort;
}

/** The two columns that run agents and therefore carry model defaults. */
export type AgentColumn = "in_dev" | "in_review";

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export type Execution = "local" | "cloud";

export interface Project {
  id: string; // ulid
  name: string;
  /** Absolute path to the local repo root. */
  path: string;
  /** Branch tasks target by default, e.g. 'main'. */
  baseBranch: string;
  defaultExecution: Execution;
  createdAt: string; // ISO 8601
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export type Column = "todo" | "in_dev" | "in_review" | "done";

/**
 * Run-state of the task's pipeline, denormalized onto the task row.
 * - idle:            nothing running (Todo before start, Done, or between steps)
 * - queued:          waiting for the per-project-branch mutex / concurrency cap
 * - running:         an agent process is live for this task
 * - needs_attention: review cap (3 rounds) exhausted — human input required
 * - error:           an agent run failed (see Task.error); manual retry available
 */
export type RunState = "idle" | "queued" | "running" | "needs_attention" | "error";

/**
 * - branch:     work directly in the project checkout on Task.branch (default;
 *               commits stack across tasks; same project+branch tasks queue FIFO)
 * - worktree:   git worktree under ~/.friday-kanban/worktrees/<projectId>/<adjective-noun>
 *               on branch friday/<name>
 * - new-branch: new branch created in the main checkout
 */
export type WorkspaceMode = "branch" | "worktree" | "new-branch";

export interface WorktreeInfo {
  /** adjective-noun, e.g. 'swift-falcon' */
  name: string;
  /** Absolute path of the worktree directory. */
  path: string;
  /** e.g. 'friday/swift-falcon' */
  branch: string;
}

export interface Task {
  id: string; // ulid
  projectId: string;
  title: string;
  prompt: string;
  /** Extra repo files/dirs referenced in the prompt (paths relative to repo root). */
  contextPaths: string[];
  /** Target branch in the project checkout (defaults to the project's baseBranch). */
  branch: string;
  workspaceMode: WorkspaceMode;
  /** Derived from task_events, denormalized for queries. */
  column: Column;
  /** Derived from task_events, denormalized for queries. */
  runState: RunState;
  execution: Execution;
  /** Per-task model overrides; resolution: task override -> column default. */
  modelOverrides?: Partial<Record<AgentColumn, ModelSpec>>;
  /** Present only when workspaceMode === 'worktree'. */
  worktree?: WorktreeInfo;
  /** Pre-allocated UUID passed as --session-id; --resume target for fix rounds. */
  claudeSessionId?: string;
  /** Captured from codex `thread.started`; `codex exec resume` target. */
  codexThreadId?: string;
  /** cse_... session id when execution === 'cloud' (claude --remote). */
  remoteSessionId?: string;
  /** 0-based count of completed review rounds; bounded by AppConfig.maxReviewCycles. */
  reviewCycle: number;
  /** Commits this task produced on the branch — used for PR bundling. */
  commitShas: string[];
  /** Cloud tasks only — local tasks' PRs hang off BranchPR records instead. */
  prUrl?: string;
  /** Accumulated cost across all agent runs for this task. */
  costUsd: number;
  /** Human-readable failure detail when runState === 'error'. */
  error?: string;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}

// ---------------------------------------------------------------------------
// Task events (append-only source of truth)
// ---------------------------------------------------------------------------

export type TaskEventType =
  | "task_created"
  | "task_queued"
  | "dev_started"
  | "dev_completed"
  | "dev_failed"
  | "review_started"
  | "review_approved"
  | "review_changes_requested"
  | "review_failed"
  | "review_cap_exhausted"
  | "fix_started"
  | "pr_created"
  | "task_retried"
  | "task_canceled"
  | "manual_move"
  | "budget_exceeded"
  | "error";

export interface TaskEvent {
  /** SQLite rowid — monotonically increasing per table. */
  id: number;
  taskId: string;
  type: TaskEventType;
  at: string; // ISO 8601
  /** e.g. ReviewVerdict for review_* events, error detail, commit shas, cost. */
  payload?: unknown;
}

// ---------------------------------------------------------------------------
// Review verdicts (enforced via codex --output-schema)
// ---------------------------------------------------------------------------

export type FindingSeverity = "blocker" | "major" | "minor";

export interface ReviewFinding {
  file: string;
  line?: number;
  /** Only 'blocker' (bugs/security) bounces a task back to In Dev. */
  severity: FindingSeverity;
  comment: string;
}

export interface ReviewVerdict {
  verdict: "approve" | "request_changes";
  summary: string;
  findings: ReviewFinding[];
}

// ---------------------------------------------------------------------------
// Agent runs (one CLI invocation each; raw NDJSON archived on disk)
// ---------------------------------------------------------------------------

export type AgentRole = "implementer" | "reviewer" | "summarizer";

export interface AgentRunUsage {
  input: number;
  output: number;
  cached: number;
}

export interface AgentRun {
  id: string; // ulid
  taskId: string;
  role: AgentRole;
  spec: ModelSpec;
  /** Exact argv used to spawn the process (argv[0] = binary). */
  argv: string[];
  pid?: number;
  startedAt: string; // ISO 8601
  endedAt?: string; // ISO 8601
  exitCode?: number;
  costUsd?: number;
  usage?: AgentRunUsage;
  /** Path to our captured raw NDJSON transcript on disk. */
  transcriptPath: string;
  /** Which review round this run belongs to (implementer fix rounds + reviewer rounds). */
  reviewCycle?: number;
}

// ---------------------------------------------------------------------------
// Branch PRs (Decision 6: one PR per project/branch bundles done tasks)
// ---------------------------------------------------------------------------

export interface BranchPR {
  id: string; // ulid
  projectId: string;
  branch: string;
  prUrl: string;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}

// ---------------------------------------------------------------------------
// Status reports (morning pane, Haiku-summarized, cached per project+date)
// ---------------------------------------------------------------------------

export interface ProjectStatusReport {
  id: string; // ulid
  projectId: string;
  date: string; // YYYY-MM-DD
  /** Markdown produced by the haiku summarizer. */
  summary: string;
  commitCount: number;
  prsMerged: number;
  tasksCompleted: number;
  createdAt: string; // ISO 8601
}

// ---------------------------------------------------------------------------
// App config
// ---------------------------------------------------------------------------

export type SchedulerMode = "manual" | "auto";

export interface AppConfig {
  /** 'manual' (default): drag Todo->In Dev starts a task. 'auto': drain Todo. */
  schedulerMode: SchedulerMode;
  /** Concurrency cap for auto mode (default 5). */
  maxConcurrentTasks: number;
  /** Review/fix round cap (default 3); on exhaustion -> needs_attention. */
  maxReviewCycles: number;
  columnDefaults: Record<AgentColumn, ModelSpec>;
}

// ---------------------------------------------------------------------------
// Transcript items (parsed stream-json/JSONL, streamed to the browser)
// ---------------------------------------------------------------------------

export type TranscriptItem =
  | { kind: "system"; ts: string; text: string }
  | { kind: "assistant_text"; ts: string; text: string }
  | { kind: "reasoning"; ts: string; text: string }
  | { kind: "tool_call"; ts: string; toolName: string; input: unknown }
  | { kind: "tool_result"; ts: string; toolName?: string; output: string; isError?: boolean }
  | { kind: "file_edit"; ts: string; file: string; diff?: string }
  | { kind: "error"; ts: string; message: string }
  | {
      kind: "result";
      ts: string;
      isError: boolean;
      costUsd?: number;
      summary?: string;
    };

// ---------------------------------------------------------------------------
// SSE board events (GET /api/events)
// ---------------------------------------------------------------------------

export type BoardEvent =
  | { type: "task_created"; task: Task }
  | { type: "task_updated"; task: Task }
  | { type: "task_deleted"; taskId: string }
  | { type: "task_event_appended"; taskId: string; event: TaskEvent }
  | { type: "transcript_item"; taskId: string; runId: string; item: TranscriptItem }
  | { type: "project_created"; project: Project }
  | { type: "project_updated"; project: Project }
  | { type: "project_deleted"; projectId: string }
  | { type: "branch_pr_updated"; branchPr: BranchPR }
  | { type: "status_report_ready"; report: ProjectStatusReport }
  | { type: "config_updated"; config: AppConfig }
  | { type: "notification"; title: string; message: string; taskId?: string };

export type BoardEventType = BoardEvent["type"];

// ---------------------------------------------------------------------------
// API input/output shapes (the contract in docs/API.md references these)
// ---------------------------------------------------------------------------

export interface CreateProjectInput {
  name: string;
  path: string;
  baseBranch?: string; // default: detected / 'main'
  defaultExecution?: Execution; // default 'local'
}

export interface CreateTaskInput {
  projectId: string;
  title: string;
  prompt: string;
  contextPaths?: string[];
  branch?: string; // default: project.baseBranch
  workspaceMode?: WorkspaceMode; // default 'branch'
  execution?: Execution; // default: project.defaultExecution
  modelOverrides?: Partial<Record<AgentColumn, ModelSpec>>;
  startNow?: boolean; // start the implementer immediately (on-demand) instead of parking in Todo
}

export interface MoveTaskInput {
  to: Column;
  /** Required for in_review -> in_dev (the typed send-back comment). */
  comment?: string;
}

export type UpdateConfigInput = Partial<AppConfig>;

/** GET /api/board response shape. */
export interface BoardSnapshot {
  projects: Project[];
  tasks: Task[];
  branchPrs: BranchPR[];
  config: AppConfig;
}

/** GET /api/tasks/[id] response shape. */
export interface TaskDetail {
  task: Task;
  events: TaskEvent[];
  runs: AgentRun[];
  /** Verdicts extracted from review_* event payloads, oldest first. */
  verdicts: ReviewVerdict[];
}

/** GET /api/projects/[id]/branches response shape. */
export interface ProjectBranches {
  /** Local branch names, e.g. ['main', 'feat/x']. */
  branches: string[];
  /** Currently checked-out branch in the project checkout. */
  current: string;
}

/** Standard error envelope returned by all API routes on failure. */
export interface ApiError {
  error: string;
  /** Optional machine-readable code, e.g. 'invalid_transition', 'not_found'. */
  code?: string;
}
