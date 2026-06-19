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

/**
 * One git repo inside a multi-repo project. The agent runs at the project's
 * parent `path` (so it sees every repo at once); branch/commit/PR operations
 * run per-repo against these roots.
 */
export interface ProjectRepo {
  /** Display name — the repo folder's last path segment, e.g. 'api'. */
  name: string;
  /** Absolute path to this repo's git root. */
  path: string;
  /** This repo's default base branch, e.g. 'main'. */
  baseBranch: string;
}

export interface Project {
  id: string; // ulid
  name: string;
  /**
   * Absolute path to the project root. Single-repo: the git repo root.
   * Multi-repo (`repos` non-empty): the parent folder that contains the repos —
   * not itself a git repo. Agents run here.
   */
  path: string;
  /** Branch tasks target by default, e.g. 'main'. */
  baseBranch: string;
  defaultExecution: Execution;
  /**
   * When present and non-empty this is a multi-repo project: `path` is a parent
   * folder and each entry is a git repo under it. Absent/empty = single-repo.
   */
  repos?: ProjectRepo[];
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
  /**
   * Target branch in the project checkout (defaults to the project's
   * baseBranch). For a multi-repo project this is the DEFAULT branch applied to
   * every repo that has no explicit override in `repoBranches`.
   */
  branch: string;
  /**
   * Multi-repo only: per-repo branch overrides keyed by repo path. A repo not
   * listed here uses `branch`. Absent for single-repo projects.
   */
  repoBranches?: Record<string, string>;
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
  /** Multi-repo: absolute path of the sub-repo this PR belongs to. Absent for single-repo. */
  repoPath?: string;
  /** Multi-repo: the sub-repo's display name. Absent for single-repo. */
  repoName?: string;
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
  /**
   * Multi-repo: the git repos under `path` to register. When present and
   * non-empty, `path` is treated as the parent folder (need not be a git repo)
   * and each repo is validated/branch-detected individually. baseBranch is
   * detected per-repo on the server when omitted.
   */
  repos?: { name: string; path: string; baseBranch?: string }[];
}

/**
 * One image attached to a task prompt. Transient transport shape only — sent
 * with CreateTaskInput, decoded server-side and written to disk under
 * ~/.friday-kanban/attachments/<taskId>/; never stored on the Task row.
 */
export interface TaskImageInput {
  /** Original filename (used to derive the saved file's name). */
  name: string;
  /** `data:image/<type>;base64,<...>` URL produced by the browser FileReader. */
  dataUrl: string;
}

export interface CreateTaskInput {
  projectId: string;
  title: string;
  prompt: string;
  contextPaths?: string[];
  /** Prompt image attachments (local execution only — read by the agent's Read tool). */
  images?: TaskImageInput[];
  branch?: string; // default: project.baseBranch (multi-repo: the default applied to all repos)
  /** Multi-repo only: per-repo branch overrides keyed by repo path. */
  repoBranches?: Record<string, string>;
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

/** One subdirectory entry returned by the directory browser. */
export interface FsEntry {
  /** Folder name (last path segment). */
  name: string;
  /** Absolute path. */
  path: string;
  /** True when the folder is a git repo (has a .git entry). */
  isGitRepo: boolean;
}

/** GET /api/fs/browse response shape — used by the Add Project folder picker. */
export interface FsBrowseResult {
  /** Resolved absolute path being listed. */
  path: string;
  /** Parent directory, or null at the filesystem root. */
  parent: string | null;
  /** The user's home directory (a handy starting point in the UI). */
  home: string;
  /** True when `path` itself is a git repo. */
  isGitRepo: boolean;
  /** Subdirectories of `path`, sorted; git repos flagged. */
  entries: FsEntry[];
}

/** Per-repo branch list (multi-repo projects only). */
export interface RepoBranches {
  /** Absolute repo path (matches Project.repos[].path / Task.repoBranches keys). */
  path: string;
  name: string;
  branches: string[];
  current: string;
}

/** GET /api/projects/[id]/branches response shape. */
export interface ProjectBranches {
  /** Local branch names; for multi-repo this is the UNION across repos. */
  branches: string[];
  /** Currently checked-out branch (first repo for multi-repo). */
  current: string;
  /** Multi-repo only: per-repo branch lists for per-repo branch selection. */
  repos?: RepoBranches[];
}

/** Standard error envelope returned by all API routes on failure. */
export interface ApiError {
  error: string;
  /** Optional machine-readable code, e.g. 'invalid_transition', 'not_found'. */
  code?: string;
}
