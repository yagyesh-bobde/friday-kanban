# friday-kanban — Research & Architecture

## 1. How nimbalyst works

Nimbalyst is a local-first Electron app that runs multiple AI coding sessions in parallel with a session kanban, git-worktree isolation, and diff review. All execution is local; mobile is a remote-control relay, not cloud execution.

**Spawning.** Two-tier abstraction: a normalized `AgentProtocol` interface (`createSession / resumeSession / forkSession / sendMessage -> AsyncIterable<ProtocolEvent> / abortSession`, closed event vocabulary: `text | reasoning | tool_call | tool_result | usage | raw_event | error | complete`) with all CLI quirks pushed into per-transport adapters, and `BaseAgentProvider` subclasses on top adding permissions, MCP injection, system prompts. Six transports behind one streaming loop:

- **Claude (default):** in-process `@anthropic-ai/claude-agent-sdk` `query()` — the SDK spawns the `claude` binary itself. Key options: `resume: claudeSessionId` + `forkSession: true`, `permissionMode` mapping, `canUseTool` callback, hooks, env with `ANTHROPIC_API_KEY` stripped, `CLAUDE_CODE_ENTRYPOINT: 'cli'` (avoids sdk-ts rate-limit deprioritization), `CLAUDE_CODE_EFFORT_LEVEL`. Prompt is always a persistent `AsyncIterable` + 30s grace timer so late permission requests don't hit a closed stdin.
- **Claude subscription path:** genuine interactive `claude` in a PTY with `--session-id <pre-allocated ulid>` / `--resume`, `--mcp-config <tempfile>`, `--settings` injecting a PreToolUse hook that POSTs to a loopback permission endpoint. Status reconstructed via an `ANTHROPIC_BASE_URL` SSE proxy and/or tailing `~/.claude/projects/.../<session>.jsonl`.
- **Codex (default transport):** one long-lived `codex app-server --listen stdio://` child per session speaking JSON-RPC: `initialize` → `thread/start {model, sandbox, cwd, approvalPolicy:'never', config:{model_reasoning_effort}}` → `turn/start` per message; resume = fresh spawn + `thread/resume`. Approval RPCs are routed to the app's permission UI. `fileChange` notifications carry full unified diffs (reverse-applied for pre-edit baselines) — the stated reason this beats `codex exec --experimental-json`.

**Status.** Central `SessionStateManager` with a small enum — `idle | running | waiting_for_input | error` — persisted to DB and broadcast. Driven by multiple signals: stream completion events (`type:'result'` / `turn/completed` / `turn/failed`), permission-prompt lifecycle flipping `waiting_for_input`, PID-file polling of `~/.claude/sessions/{pid}.json` for the PTY path, chokidar file watching for untracked edits, and boot-time stale-`running` recovery that deliberately preserves `waiting_for_input` rows.

**Data model.** PGLite (migrating to better-sqlite3): `ai_sessions` (provider, model, status, provider_session_id, worktree_id, `metadata` JSONB carrying the kanban `phase`), `ai_agent_messages` (full raw transcript incl. `raw_event` passthrough so transcripts can be re-projected later), `worktrees` (adjective-noun name, `worktree/<name>` branch, `../<project>_worktrees/<name>` dir), `queued_prompts` (prompts queued against a busy session are dispatched on idle). Kanban columns are pure metadata — moving a card never triggers execution.

**Review-adjacent machinery.** No cross-agent review pipeline, but: `MetaAgentService` routes child-session completion as a structured `[Child Session Update]` prompt (status, last response, edited files) into the parent's prompt queue; Blitz fans one prompt to N worktrees with per-worktree models, then auto-creates a judge session (atomic jsonb_set guard against double-creation); Super Loops do fresh-context iterations gated by a `progress.json` MCP tool.

**What to steal:** protocol-adapter layer + normalized event stream with raw passthrough; the 4-state status machine fed by multiple signals with stale-run recovery; queued-prompts-on-idle; worktree-per-card with `gh` CLI (not octokit) for PR ops; `provider:model` identifiers with effort mapping (`max`→codex `xhigh`); strip API keys from inherited env; the child-completes→structured-prompt-back-to-parent pattern as the seed of our review loop; per-session loopback MCP URL with bearer token so agent tool calls land on the right card.

## 2. How agent-teams-ai works

Agent Teams AI orchestrates persistent agent teams (lead + teammates) over a **bundled fork** of Claude Code (`claude-multimodel`) that natively does `--provider anthropic|codex|gemini|opencode` per teammate. We can't use the fork, but its coordination design is the most directly relevant prior art.

**Spawning.** One long-lived lead process: `claude --print --input-format stream-json --output-format stream-json --verbose --mcp-config <file> --team-bootstrap-spec <json> --model M --effort E` with `stdio: ['pipe','pipe','pipe']` — no PTY. User messages are injected as NDJSON stdin lines `{type:'user',message:{role:'user',content:[{type:'text',text}]}}`. Permission prompts arrive as `control_request` stream events. Teammates spawn as tmux panes or detached headless processes; exit codes recovered via a printed `__CLAUDE_TEAMMATE_EXIT__:<code>` sentinel. One-shot scheduled tasks use `claude -p ... --output-format stream-json --max-turns N --no-session-persistence [--max-budget-usd X]` — good hygiene flags for queue-style execution. Codex is managed via a real `@openai/codex` binary: `codex app-server` JSON-RPC for auth/models/rate-limits, `codex exec --json` for execution.

**Filesystem as coordination bus.** No database. Tasks are one JSON file each (`~/.claude/tasks/<team>/<id>.json`) written with per-path locks + atomic temp-file writes, carrying an **append-only `historyEvents` log** (`task_created, status_changed, review_requested, review_started, review_changes_requested, review_approved`). Review state (`none | review | needsFix | approved`) and kanban column are **derived** from events, with a small kanban overlay file. The app file-watches the directories (fs.watch + polling fallback, 300ms coalesce) to drive the realtime board. Agents mutate the same store through an MCP toolbelt (~40 tools: `task_create/start/complete`, `review_request/start/approve/request_changes`, `message_send`, `kanban_*`) backed by the same locked library the UI uses — one source of truth.

**Implementer/reviewer loop (the part we're copying).** `review_request` is gated on task status `completed`; it sets kanban column `review`, appends `review_requested` with an assigned reviewer, and drops a message into the reviewer's inbox. `review_start` opens a review interval and enforces only the assigned reviewer may review. `review_approve` → column `approved`. `review_request_changes` atomically: appends the event (→ derived `needsFix`), adds a review comment, sets task status back to `pending`, and sends the **owner** an inbox message with explicit resume instructions ("review the task context, implement the fixes, mark it completed, and request review again"). A reconciler (`MemberWorkSyncReconciler` + `ActionableWorkAgenda`) computes per-member obligations from settled-turn events and inserts **deduplicated** nudges when a review sits unclaimed.

**Status.** Layered: NDJSON stdout parsing with a carry buffer for split lines; a Stop-hook spool (injected via inline `--settings` JSON) so every settled Claude turn writes an event file the app drains; an env-pointed spool for codex (no hook system); stall watchdogs comparing open `workIntervals` against transcript freshness; transcript tailing of `~/.claude/projects/.../*.jsonl` to attribute edits to tasks; filesystem polling that outranks stdout during provisioning.

**Worktrees/git.** Opt-in per member: branch `agent-teams/<team>/<member>-<repoHash>` under an app-owned worktrees dir, with validation of existing worktrees before reuse. **No PR creation or gh integration** — a gap we fill.

**What to steal:** the entire review state machine (events + derived state + feedback-as-message-to-owner + dedup nudges); append-only event log as the source of truth; gating review on "implementation complete"; stream-json stdin injection; don't trust a single status signal. **Cautionary tale:** their per-teammate flags only exist because they forked Claude Code — with stock CLIs you get the same effect by spawning each task as an independent `claude -p` / `codex exec` run keyed to a task record, which is also simpler to status-track. That's exactly friday-kanban's model.

## 3. Claude Code CLI orchestration surface

Verified against v2.1.170. The exact surface friday-kanban uses:

**Implementation run (In Dev):**
```bash
claude -p "<task prompt + repo context>" \
  --output-format stream-json --verbose --include-partial-messages \
  --session-id <pre-allocated-uuid> \
  --model opus --effort high \
  --permission-mode acceptEdits \
  --allowedTools "Bash,Read,Edit,Write,Glob,Grep" \
  --max-budget-usd 15
```
spawned with `cwd` = the task's worktree, `stdio: ['pipe','pipe','pipe']` (no TTY needed for `-p`).

- **Stream events:** `system/init` first (model, tools — fail fast on `plugin_errors`), `assistant`/`user` per turn, `system/api_retry` on rate limits, final `result` with `is_error`, `session_id`, `total_cost_usd`, `usage`, `modelUsage`, `permission_denials`, `terminal_reason`. NDJSON — use a line-buffered reader.
- **Resume (the fix loop):** `claude -p "Address this review feedback:\n<codex findings>" --resume <session_id> ...` — full context carries over across processes, and model is preserved. Prefer explicit `--resume <uuid>` over `--continue` (racy across concurrent jobs in one cwd). `--session-id <uuid>` lets the orchestrator know the ID before launch; `--fork-session` branches alternate fix strategies.
- **Models/effort:** `--model fable|opus|sonnet|haiku` (opus → Opus 4.8), `--effort low|medium|high|xhigh|max` or `CLAUDE_CODE_EFFORT_LEVEL` env (highest precedence). `--fallback-model sonnet,haiku` for resilience.
- **Permissions:** no prompts exist in `-p` — uncovered tool calls **abort the turn** and show up in `permission_denials`. Pre-approve everything the task needs (`--permission-mode acceptEdits` + scoped `--allowedTools "Bash(git diff *),Bash(git commit *)"`, space before `*` matters). `--dangerously-skip-permissions` only inside worktree sandboxes we control.
- **Determinism:** `--bare` for utility runs (no hooks/plugins/CLAUDE.md/keychain — but then it strictly needs `ANTHROPIC_API_KEY`; subscription auth returns `is_error:true` JSON, so check `.is_error`, not exit code). For dev tasks we keep project settings (CLAUDE.md is valuable) but pass `--setting-sources project`.
- **Monitoring extras:** hooks with **`type:"http"` handlers** can POST Stop/Notification/StopFailure events straight to the daemon (injected via inline `--settings`); transcript JSONL at `~/.claude/projects/<cwd-slug>/<session-id>.jsonl` is tailable; `claude agents --json` lists background sessions without a TTY.
- **Cloud:** `claude --remote "<prompt>"` creates a session on Anthropic VMs from the cwd's GitHub remote at current branch (push first). **Hard-requires a TTY** — verified error when piped. The orchestrator must spawn it under **node-pty**. Results land as branches/PRs on GitHub (primary channel); `claude --teleport <session-id>` pulls a session back locally. `CLAUDE_CODE_REMOTE_SESSION_ID` inside the session yields a transcript URL to embed in PR bodies.
- **Gotchas to encode:** parallel runs in one repo clobber each other → worktree per task; 10MB stdin cap → pass big context as file paths; background processes killed ~5s after result; from June 15 2026 `-p` on subscriptions draws from a separate Agent SDK credit.

## 4. Codex CLI orchestration surface

Verified against codex-cli 0.133.0. Used as the **reviewer** by default:

**Review run (In Review):**
```bash
codex exec --json \
  -C <worktree> --skip-git-repo-check \
  -s read-only -c approval_policy="never" \
  -m gpt-5.5 -c model_reasoning_effort="medium" \
  --output-schema /tmp/review-schema.json -o /tmp/last-message.txt \
  "Review the following diff for task <id>. Verdict: approve or request_changes with findings. <diff / instructions>" \
  </dev/null
```
spawned with `stdio: ['ignore','pipe','pipe']` — codex reads stdin when it's not a TTY, so close it or it can stall.

- **Event stream (`--json`, pure JSONL on stdout):** `thread.started` (capture `thread_id` for resume) → `turn.started` → `item.started`/`item.completed` (`agent_message`, `command_execution` with exit_code, `file_change`, `reasoning`, `error`) → `turn.completed` with `usage` token counts, or `error` + `turn.failed`. Exit code 0/1 maps to success/turn-failure (verified) — but also validate output shape via `--output-schema`.
- **Structured verdict:** `--output-schema` constrains the final message to e.g. `{"verdict":"approve"|"request_changes","findings":[{"file","line","severity","comment"}],"summary"}`; read it from the `-o` file. There is also a purpose-built `codex review` / `codex exec review` for non-interactive code review worth evaluating.
- **Resume:** `codex exec resume <thread_id> --json "..."` — context carries across processes (verified). Don't use `--ephemeral` on runs you may resume; resume by explicit thread_id (the picker filters by cwd).
- **Models/effort:** `-m gpt-5.5` (current slugs: gpt-5.5, gpt-5.4, gpt-5.4-mini, gpt-5.3-codex-spark), effort via `-c model_reasoning_effort="minimal|low|medium|high|xhigh"`. Per-invocation `-c key=value` overrides any config.toml key; `--profile-v2` for named presets.
- **Sandbox/permissions:** `-s read-only` for review (it only needs to read the diff and run read-only commands), `workspace-write` if we ever let codex implement; `approval_policy="never"` returns failures to the model instead of prompting. `--ignore-user-config` + explicit flags for determinism (auth still read from `CODEX_HOME`).
- **Isolation:** parallel execs are fine (separate session UUIDs) but share `~/.codex` state — heavy parallelism gets per-worker `CODEX_HOME` dirs. Auth: `~/.codex/auth.json` from `codex login`, or `CODEX_API_KEY`.
- **Cloud:** `codex cloud exec --env <ENV_ID> "task" [--attempts N]` → poll `codex cloud status <TASK_ID>` / `codex cloud list --json` → `codex cloud diff` / `codex cloud apply`. Fully scriptable (no TTY problem), but requires a configured cloud environment per repo.
- **Long-lived alternative:** `codex app-server` (JSON-RPC stdio, `generate-ts` emits TypeScript bindings) beats respawning exec per turn and gives diff-bearing `fileChange` events — noted as a v2 upgrade path; each exec spawn costs ~14k input tokens of re-sent context.

## 5. Proposed friday-kanban architecture

### Stack & process model

- **Orchestrator daemon:** Node 22 + TypeScript. **Hono** HTTP server serving the API, a WebSocket endpoint for board updates, and the built UI as static files. One process: `friday daemon` (launchd plist for auto-start). This is agent-teams-ai's `standalone.ts` shape (web server, no Electron) — we're a web app, so we skip Electron entirely.
- **Web UI:** React + Vite + Zustand + Tailwind. Talks to the daemon at `http://127.0.0.1:4517`; board state pushed over WebSocket.
- **Persistence:** **better-sqlite3** (copying nimbalyst's destination, not its PGLite starting point — synchronous, single-file, zero-ops; and not agent-teams' JSON-files-in-~/.claude, because we span many projects and want cross-project queries for the board and the morning summary). DB at `~/.friday-kanban/friday.db`. We keep agent-teams' best idea **inside** SQLite: an append-only `task_events` table from which review state is derived.
- **Agent execution:** stock CLIs spawned per run — `claude -p` / `codex exec` keyed to a task row (the "spawn each task yourself" approach the agent-teams report itself recommends over their fork). `execFile`/`spawn` with arg arrays, never shell strings. **node-pty** is included for exactly one purpose: `claude --remote` requires a TTY.
- **Realtime + monitoring:** stream-json/JSONL parsing (line-buffered, carry buffer for split lines — copied from agent-teams) is the primary signal; a Claude `http` Stop/Notification hook POSTing to `http://127.0.0.1:4517/hooks/claude` is the secondary signal; exit codes + a stall watchdog (no stdout activity for N minutes) are the backstop. Multi-signal status is the one lesson both repos agree on.

### Task state machine

Columns are **statuses that drive execution** (unlike nimbalyst's metadata-only phases — our board is the orchestrator, so a column transition *is* a pipeline step):

```
Todo ──(scheduler picks up)──► In Dev ──(implementer result, success)──► In Review
                                  ▲                                          │
                                  │   codex verdict = request_changes        │
                                  └──────────(fix cycle)─────────────────────┤
                                                                              │ verdict = approve
                                                                              ▼
                                                                  Done (PR created via gh)
   (any step) ──► Error (surfaced on card; manual retry/resume)
```

Per-task substates (`idle | running | error`, plus `awaiting_pickup` in Todo) mirror nimbalyst's session states. Transitions, concretely:

1. **Todo → In Dev.** Scheduler claims the task (respecting a global concurrency limit), creates the worktree, pre-allocates a UUID, spawns the implementer: `claude -p "<prompt + attached context file paths>" --session-id <uuid> --model <col default or task override> --effort high --output-format stream-json --verbose --permission-mode acceptEdits --allowedTools ... --max-budget-usd <cap>` with `cwd` = worktree. Appends `dev_started` event.
2. **In Dev → In Review.** On `result` with `is_error:false`: commit any uncommitted changes (`git add -A && git commit`), compute `git diff <base>...HEAD`, append `dev_completed`, spawn the reviewer: `codex exec --json -s read-only -C <worktree> -m gpt-5.5 -c model_reasoning_effort="medium" --output-schema <verdict-schema> -o <file> "<review prompt incl. task prompt + diff>"`. Capture `thread_id` on first review; subsequent review rounds use `codex exec resume <thread_id>` so the reviewer remembers its earlier findings (and can check they were addressed).
3. **In Review → In Dev (feedback loop).** If verdict = `request_changes`: append `review_changes_requested` with the findings JSON, move card back to In Dev, and **inject feedback via session resume** — `claude -p "A code reviewer examined your diff and requested changes. Address each item, then summarize what you changed:\n\n<findings rendered as markdown>" --resume <claude_session_id> --output-format stream-json --verbose ...`. Same Claude session continues with full implementation context. This is agent-teams' `review_request_changes` → owner-inbox-message pattern, implemented with Claude Code's native `--resume` instead of an inbox file, wrapped in nimbalyst's `[Child Session Update]` structured-prompt style. Loop bounded by `maxReviewCycles` (default 3); on exhaustion the card goes to Error/needs-human.
4. **In Review → Done.** Verdict = `approve`: push branch, `gh pr create --title <subject> --body <summary + review trail + cloud transcript URL if remote> --base <baseBranch>`, store PR URL on the task, append `pr_created`. PR creation via `gh` CLI — copied from nimbalyst (agent-teams has no PR story at all).

Every transition is an appended `task_events` row; current column + review state are derived (agent-teams' derivation model), which makes crash recovery trivial: on boot, mark stale `running` tasks as `error:stale` (nimbalyst's recovery, minus its `waiting_for_input` carve-out since headless runs can't wait).

### Per-column model config & overrides

Column defaults live in config and resolve at spawn time; a task can override per-field. Resolution: task override → column default → hardcoded fallback.

```ts
type Provider = 'claude-code' | 'codex';
interface ModelSpec { provider: Provider; model: string; effort: 'low'|'medium'|'high'|'xhigh'|'max'; }

// defaults shipped:
const COLUMN_DEFAULTS: Record<string, ModelSpec> = {
  in_dev:    { provider: 'claude-code', model: 'opus',    effort: 'high' },   // alias → latest Opus
  in_review: { provider: 'codex',       model: 'gpt-5.5', effort: 'medium' },
};
```

Effort maps to `--effort` for Claude and `-c model_reasoning_effort=` for codex (`max` → codex `xhigh`, nimbalyst's mapping). Identifiers stored as `provider:model` (nimbalyst's `ModelIdentifier` convention).

### Data model

```ts
interface Project {
  id: string;
  name: string;
  path: string;                  // local repo root
  baseBranch: string;            // default 'main', detected at add time
  defaultExecution: 'local' | 'cloud';
  remoteEnvId?: string;          // codex cloud env, if used
  createdAt: string;
}

type Column = 'todo' | 'in_dev' | 'in_review' | 'done';
type RunState = 'idle' | 'awaiting_pickup' | 'running' | 'error';

interface Task {
  id: string;                    // ulid
  projectId: string;
  title: string;
  prompt: string;
  contextPaths: string[];        // extra repo files/dirs referenced in the prompt
  column: Column;                // derived from events, denormalized for queries
  runState: RunState;
  execution: 'local' | 'cloud';
  modelOverrides?: Partial<Record<'in_dev'|'in_review', ModelSpec>>;
  worktree?: { name: string; path: string; branch: string };  // 'swift-falcon', friday/swift-falcon
  claudeSessionId?: string;      // pre-allocated UUID; --resume target for the fix loop
  codexThreadId?: string;        // from thread.started; codex exec resume target
  remoteSessionId?: string;      // cse_... when execution='cloud'
  reviewCycle: number;           // 0-based; bounded by config.maxReviewCycles
  prUrl?: string;
  costUsd: number;               // accumulated from result.total_cost_usd + codex usage
  createdAt: string; updatedAt: string;
}

type TaskEventType =
  | 'task_created' | 'dev_started' | 'dev_completed' | 'dev_failed'
  | 'review_started' | 'review_approved' | 'review_changes_requested'
  | 'fix_started' | 'pr_created' | 'budget_exceeded' | 'manual_move';

interface TaskEvent {                 // append-only; source of truth
  id: number; taskId: string; type: TaskEventType;
  at: string;
  payload?: unknown;                  // e.g. ReviewVerdict, error detail, cost
}

interface ReviewVerdict {             // enforced via codex --output-schema
  verdict: 'approve' | 'request_changes';
  summary: string;
  findings: { file: string; line?: number; severity: 'blocker'|'major'|'minor'; comment: string }[];
}

interface AgentRun {                  // one CLI invocation; raw NDJSON archived
  id: string; taskId: string;
  role: 'implementer' | 'reviewer' | 'summarizer';
  spec: ModelSpec; argv: string[];
  pid?: number; startedAt: string; endedAt?: string;
  exitCode?: number; costUsd?: number;
  usage?: { input: number; output: number; cached: number };
  transcriptPath: string;             // our captured NDJSON, plus ~/.claude jsonl path for claude runs
}

interface ProjectStatusReport {       // morning pane
  id: string; projectId: string; date: string;  // YYYY-MM-DD
  summary: string;                    // markdown from haiku
  commitCount: number; prsMerged: number; tasksCompleted: number;
}

interface AppConfig {
  columnDefaults: Record<'in_dev'|'in_review', ModelSpec>;
  maxConcurrentTasks: number;         // default 2
  maxReviewCycles: number;            // default 3
  maxBudgetUsdPerTask: number;        // → --max-budget-usd
  statusCron: string;                 // default '0 7 * * *'
}
```

### Local vs cloud execution

- **Local (default):** everything above — worktree, `claude -p`, `codex exec`, `gh pr create`.
- **Cloud (per-task toggle):** In Dev runs as `claude --remote "<prompt>"` spawned under **node-pty** (the verified TTY requirement), after pushing the task branch. The daemon captures `cse_` session id, polls via `claude agents --json` / GitHub for the resulting branch/PR. Two review options: (a) if the cloud session opened a PR itself, run `codex exec` review against the PR diff fetched via `gh pr diff` and post findings as a PR comment + a new `--remote` fix prompt; (b) `claude --teleport <id>` to pull the branch local and run the standard loop. We default to (a) since teleport requires clean local state. Codex cloud (`codex cloud exec/status/diff/apply`) is wired as a second cloud backend where a project has an `remoteEnvId`. Cloud tasks skip local worktrees (the VM is the isolation).

### Worktrees, git, PRs

Copied from nimbalyst wholesale: per-task worktree named adjective-noun (`swift-falcon`), branch `friday/<name>`, directory `~/.friday-kanban/worktrees/<projectId>/<name>` (app-owned dir per agent-teams, rather than littering `../<project>_worktrees`), created with `git worktree add -b` and validated before reuse (agent-teams' rev-parse checks). simple-git for plumbing. Worktree removed after PR creation (configurable). `gh` CLI for PR create + diff + status, honoring per-project `gh auth` accounts.

### Morning project-status pane

A cron entry in the daemon (node-cron, `statusCron`, default 07:00) per project:
1. Gather: `git log --since=yesterday.midnight --until=midnight --stat` on `baseBranch` + active task branches, `gh pr list --state merged --search "merged:>=<date>"`, plus friday's own `task_events` for the day.
2. Summarize with a cheap, deterministic, headless call: `claude -p --bare --model haiku --no-session-persistence --output-format json --json-schema <report-schema> "Summarize yesterday's changes for a standup: <gathered text>"` (`--bare` needs `ANTHROPIC_API_KEY`; fallback: non-bare with `--setting-sources ""`-equivalent minimal settings). Store as `ProjectStatusReport`.
3. UI: collapsed pane at the bottom of the board, one row per project, expandable; regenerate-on-demand button. Daemon catches up missed crons on boot (laptop was asleep at 07:00).

### Directory layout

```
friday-kanban/
├── package.json                  # npm workspaces: server, web, shared
├── packages/
│   ├── shared/src/               # types above (Task, TaskEvent, ModelSpec...), zod schemas,
│   │                             #   review-verdict JSON schema (single source for --output-schema)
│   ├── server/src/
│   │   ├── index.ts              # daemon entry: Hono + WS + static UI + scheduler + cron
│   │   ├── db/                   # better-sqlite3 schema, migrations, repositories
│   │   ├── pipeline/
│   │   │   ├── scheduler.ts      # claims Todo tasks, concurrency gate, crash recovery
│   │   │   ├── stateMachine.ts   # transition table; appends task_events; derives column
│   │   │   ├── implementer.ts    # claude -p spawn/resume, argv builder, budget caps
│   │   │   ├── reviewer.ts       # codex exec spawn/resume, verdict parsing/validation
│   │   │   └── prCreator.ts      # commit, push, gh pr create
│   │   ├── agents/
│   │   │   ├── claudeRunner.ts   # spawn + NDJSON line reader + result extraction (local)
│   │   │   ├── claudeRemote.ts   # node-pty --remote launcher + cse_ tracking + teleport
│   │   │   ├── codexRunner.ts    # spawn (stdin ignored) + JSONL reader + thread_id capture
│   │   │   └── streamParser.ts   # shared line-buffered NDJSON parser w/ carry buffer
│   │   ├── git/                  # worktrees (simple-git), gh wrapper, diff computation
│   │   ├── status/               # hook webhook endpoint (/hooks/claude), stall watchdog
│   │   └── reports/              # cron, git-log gathering, haiku summarizer
│   └── web/src/
│       ├── board/                # KanbanBoard, TaskCard (run state, cost, review cycle badge)
│       ├── task/                 # new-task modal, transcript viewer, review-findings view
│       ├── projects/             # project registry CRUD
│       ├── statusPane/           # collapsible morning-report pane
│       └── store/                # Zustand + WS subscription
└── ~/.friday-kanban/             # runtime (not in repo): friday.db, worktrees/, transcripts/, logs/
```

### Design-choice attribution summary

| Choice | Copied from | Why |
|---|---|---|
| Independent headless run per task (no fork, no long-lived team process) | agent-teams' own "cautionary tale" | Stock CLIs, simplest status tracking |
| Append-only event log, state derived | agent-teams | Crash-safe, makes "back to In Dev" a derived state |
| SQLite (better-sqlite3), not JSON files | nimbalyst (its migration target) | Cross-project board queries, single file |
| 4-state run status + multi-signal detection + stale recovery | both (nimbalyst's enum, agent-teams' layering) | Neither trusts one signal; nor do we |
| Reviewer feedback → structured prompt resumed into implementer session | agent-teams' `review_request_changes` message + nimbalyst's `[Child Session Update]` format, via `--resume` | Keeps full implementation context; verified to work cross-process |
| Bounded review cycles + budget caps (`--max-budget-usd`, `--max-turns`-style hygiene) | agent-teams' scheduled runner flags | Runaway control |
| Worktree-per-task, adjective-noun names, app-owned dir | nimbalyst (naming) + agent-teams (app-owned location, reuse validation) | Parallel safety; both repos converged here |
| `gh` CLI for PRs | nimbalyst | agent-teams has no PR story; gh handles auth/accounts |
| Raw NDJSON archived per run | nimbalyst's `raw_event` persistence | Re-render transcripts later without re-running |
| Codex `read-only` sandbox for review, `--output-schema` verdict | our own (enabled by Codex report) | Reviewer needs no write access; machine-parseable gate |

## 6. Open decisions

1. **Reviewer scope:** strict diff-only review (`-s read-only`, cheap, fast) vs. letting codex run the test suite in the worktree (`workspace-write`, catches real breakage, costs more and risks side effects). Default proposal: read-only diff review + the implementer is instructed to run tests itself; toggle per project.
2. **Cloud review path:** for `--remote` tasks, review the PR via `gh pr diff` + a fresh `--remote` fix prompt (loses Claude session continuity) vs. `--teleport` to localize the loop (requires clean local git state). Proposal defaults to the PR path; needs your call on whether session continuity matters enough on cloud tasks.
3. **Auth/billing mode:** subscription auth (zero config, but `-p` draws from the separate Agent SDK credit starting June 15, 2026, and `--bare` won't work) vs. `ANTHROPIC_API_KEY` + `CODEX_API_KEY` (predictable, per-task cost caps meaningful). Affects whether the morning summarizer can use `--bare`.
4. **Auto-pickup vs. confirm:** should dropping a card in Todo immediately start an Opus run (true automation, surprise spend) or require a per-task "start" click / a board-level pause switch? Proposal: auto-pickup with a global pause toggle and the per-task budget cap, but this is a spend-tolerance question.
5. **Done semantics & cleanup:** delete the worktree immediately on PR creation, or keep it until the PR merges (enables post-PR fix rounds from review comments — a natural v2 feature: sync GitHub PR review comments back into the same Claude session)?
6. **Per-task `CODEX_HOME`/`--ignore-user-config` isolation:** fully hermetic agent runs (reproducible, ignores your global config) vs. inheriting your real `~/.claude`/`~/.codex` setup (your MCP servers and config Just Work). Proposal: inherit for v1, revisit if config drift bites.