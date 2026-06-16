# friday-kanban — Design (locked decisions)

A local web app that orchestrates AI coding agents (Claude Code + Codex CLI) across multiple
local projects via a single kanban board: **Todo → In Dev → In Review → Done**.

Research backing every choice here lives in `docs/research/` (deep studies of
nimbalyst/nimbalyst, 777genius/agent-teams-ai, and the verified Claude Code v2.1.x /
codex-cli 0.133.x orchestration surfaces). This file records what we *decided*; the
proposal doc records *why* and the full CLI flag reference.

## Decisions (from design interview, 2026-06-10)

| # | Decision | Choice |
|---|----------|--------|
| 1 | Form factor | Local web app: **Next.js App Router + custom Node `server.ts`** that also hosts the orchestrator (process manager, SQLite, realtime push). One process, `npm run dev`. |
| 2 | Autonomy | **Board-level toggle: manual ↔ auto.** Default **manual** (drag Todo→In Dev starts the agent). Auto mode drains Todo respecting a configurable concurrency cap, **default 5**. |
| 3 | Workspace | Default: agent works **directly on the project's selected branch** in the main checkout; commits stack on that branch across tasks. Per-task options: **git worktree** or **fresh branch checkout**. Tasks targeting the same project+branch **queue FIFO**; parallelism comes from different projects or worktree-mode tasks. |
| 4 | Review loop | Codex reviews ↔ Claude fixes, **capped at 3 rounds**; on exhaustion the card gets a **Needs attention** state. |
| 5 | Review bar | Only **bugs + security** findings bounce a task back to In Dev. Style/nitpicks are attached to the task (and later the PR body) but never block. |
| 6 | PR model | **No PR per task.** Done = task passed review, commits on the branch. A manual **"Create PR" action per project/branch** bundles all done-task commits into one PR (`gh pr create`) with a description generated from those tasks. If a PR is already open for the branch, new done commits just get pushed into it. |
| 7 | Cloud tasks | `claude --remote` tasks produce **their own remote branch + PR** — they never merge into the shared local branch. Codex reviews `gh pr diff` of that branch; feedback goes back as a new remote prompt. |
| 8 | Permissions | Local agents run fully autonomous: `claude --dangerously-skip-permissions`, codex `approval_policy="never"`. Reviewer runs sandboxed `-s read-only`. |
| 9 | Status pane | Generated **on first board open of the day**: `git log --since=yesterday` across all projects + friday's own task history, summarized by **Haiku**, cached per day in SQLite. Collapsed pane at the bottom of the board. |
| 10 | Persistence | **better-sqlite3**, single file at `~/.friday-kanban/friday.db`. Append-only `task_events` table is the source of truth; column/review state derived. Raw agent NDJSON transcripts on disk, DB keeps pointers. |
| 11 | Task detail | **Live transcript stream**: parsed stream-json/JSONL (assistant text, tool calls, file edits) streamed to the browser, plus review-round history and the diff. |
| 12 | Drag semantics | **Drag is a command.** Todo→In Dev starts the implementer (manual-mode start). In Dev→In Review forces review. In Review→In Dev sends back with a typed comment. Invalid moves rejected; columns always reflect real pipeline state. |
| 13 | Alerts | **Card badge + macOS notification** (osascript) on: agent error, 3-round review cap hit, task finished while tab closed. |

## Pipeline (per task, local default flow)

```
Todo ──start (drag / auto-scheduler)──► In Dev ── claude result ok, commit ──► In Review
                                          ▲                                       │
                                          │  codex verdict: blocking findings     │
                                          └──── claude -p --resume <session> ─────┤
                                                                                  │ approve (or only nitpicks)
                                                                                  ▼
                                                                Done (commits on branch)
                                                                       │
                                            manual "Create PR" per project/branch (gh pr create / push)
```

- **Implementer:** `claude -p "<prompt>" --session-id <uuid> --model <spec> --effort <spec> --output-format stream-json --verbose --include-partial-messages --dangerously-skip-permissions` with `cwd` = checkout (or worktree). Fix rounds reuse the same session: `--resume <uuid>`.
- **Reviewer:** `codex exec --json -C <dir> -s read-only -c approval_policy="never" -m <model> -c model_reasoning_effort="<effort>" --output-schema <verdict.json> -o <out>` reviewing the task's commit range diff. Round 2+ uses `codex exec resume <thread_id>` so it remembers prior findings. Verdict schema: `{verdict, summary, findings:[{file,line,severity: blocker|major|minor,comment}]}`; only `blocker` (bug/security) findings bounce.
- **Done:** commits already on the project branch; task stores its commit SHAs for PR bundling.

## Per-column model defaults (config, overridable per task)

```ts
in_dev:    { provider: 'claude-code', model: 'opus',    effort: 'high' }   // latest Opus
in_review: { provider: 'codex',       model: 'gpt-5.5', effort: 'medium' }
```

Resolution: task override → column default → fallback. Stored as `provider:model` identifiers.

## Data model (core)

See `docs/research/architecture-proposal.md` §5 for full interfaces. Deltas from the proposal
per the interview: `Task.workspaceMode: 'branch' | 'worktree' | 'new-branch'` (default `branch`),
`Task.commitShas: string[]` (for PR bundling), no per-task `prUrl` for local tasks — PRs hang off
a `BranchPR { projectId, branch, prUrl }` record; cloud tasks keep their own `prUrl`.
`AppConfig.schedulerMode: 'manual' | 'auto'` (default manual), `maxConcurrentTasks` (default 5).

## Key implementation notes (verified in research)

- Parse stream-json with a **line-buffered reader with carry buffer**; never trust a single
  status signal — combine stream `result` events, exit codes, and a stall watchdog.
- `claude --remote` **requires a TTY** → spawn under node-pty. Push branch first; capture
  `cse_` session id; results arrive as GitHub branches/PRs.
- Codex: close stdin (`stdio: ['ignore','pipe','pipe']`) or `codex exec` can stall; capture
  `thread_id` from `thread.started` for resume; effort `max` maps to codex `xhigh`.
- On boot, mark stale `running` tasks as error (crash recovery from event log).
- Strip `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` confusion sources from child env as needed;
  `gh` CLI (not octokit) for all PR operations.
