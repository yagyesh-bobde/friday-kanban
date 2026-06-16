# friday-kanban — API Contract

The contract the **api agent** implements (in `src/app/api/**`) and the **ui agent**
codes against. All type names reference `src/lib/types.ts`; all request bodies are
validated with the zod schemas in `src/lib/schemas.ts`.

## Conventions

- Base URL: `http://localhost:4517` (the custom server in `server.ts`; `PORT` in
  `src/lib/constants.ts`).
- All request/response bodies are JSON (`Content-Type: application/json`) except the
  two SSE endpoints.
- Timestamps are ISO 8601 strings; ids are ULIDs (task event ids are integers).
- **Error envelope** (every non-2xx response): `ApiError = { error: string; code?: string }`.

| HTTP status | `code` (typical)        | When |
|---|---|---|
| 400 | `invalid_input`        | zod validation failed (response includes details in `error`) |
| 404 | `not_found`            | unknown project/task id |
| 409 | `invalid_transition`   | illegal board move / action not valid in current state |
| 409 | `task_running`         | operation requires the task to not be running (e.g. delete) |
| 500 | `internal`             | unexpected failure |
| 501 | `not_implemented`      | orchestrator method not yet implemented (scaffold phase only). API routes MUST map `NotImplementedError` (from `src/server/orchestrator.ts`) to this |

Route handlers import singletons via their accessors — `getOrchestrator()`,
`getDb()` + repositories (`src/server/db/*`), `getBus()` — never construct their own.

---

## Projects

### GET /api/projects

List registered projects.

- Response `200`: `Project[]`

### POST /api/projects

Register a local repo as a project.

- Body: `CreateProjectInput = { name: string; path: string; baseBranch?: string; defaultExecution?: 'local'|'cloud' }`
  - `path` must be an absolute path to an existing git repo (validate; `400 invalid_input` otherwise).
  - `baseBranch` defaults to the repo's detected default branch, falling back to `'main'`.
  - `defaultExecution` defaults to `'local'`.
- Response `201`: `Project`
- Errors: `400`

### GET /api/projects/[id]/branches

List local git branches of the project checkout (for the task-create form and the
Create PR dialog). Implemented by running `git branch` in `project.path`.

- Response `200`: `ProjectBranches = { branches: string[]; current: string }`
- Errors: `404`, `500` (git failure — `error` contains stderr)

### POST /api/projects/[id]/create-pr

Manual "Create PR" action (DESIGN.md decision 6): bundles all done tasks' commits on
the branch into one PR — push branch, `gh pr create` (or push into the already-open
PR), body generated from the done tasks (titles, summaries, non-blocking review
findings). Delegates to `orchestrator.createPrForProject(projectId, branch)`.

- Body: `{ branch: string }`
- Response `200`: `BranchPR`
- Errors: `400`, `404`, `409` (`code: 'invalid_transition'` — no done tasks on that branch), `500` (git/gh failure), `501`

---

## Board

### GET /api/board

Single snapshot the UI hydrates from on load; afterwards the UI applies
`BoardEvent`s from `GET /api/events` on top.

- Response `200`: `BoardSnapshot = { projects: Project[]; tasks: Task[]; branchPrs: BranchPR[]; config: AppConfig }`

---

## Tasks

### POST /api/tasks

Create a task in `todo` / `idle`. Delegates to `orchestrator.createTask(input)`
(which persists, publishes `task_created`, and lets the auto-scheduler pick it up
when `schedulerMode === 'auto'`). With `startNow: true` the implementer is started
on demand immediately (Todo → In Dev, same admission path as a manual drag),
regardless of scheduler mode — the returned `Task` reflects the started state.

- Body: `CreateTaskInput = { projectId; title; prompt; contextPaths?; branch?; workspaceMode?; execution?; modelOverrides?; startNow? }`
  - `branch` defaults to the project's `baseBranch`; `workspaceMode` defaults to `'branch'`;
    `execution` defaults to the project's `defaultExecution`; `startNow` defaults to `false`.
- Response `201`: `Task`
- Errors: `400`, `404` (unknown `projectId`), `501`

### GET /api/tasks/[id]

Full task detail for the card drawer/modal.

- Response `200`: `TaskDetail = { task: Task; events: TaskEvent[]; runs: AgentRun[]; verdicts: ReviewVerdict[] }`
  - `events` oldest-first; `runs` oldest-first; `verdicts` extracted from
    `review_approved` / `review_changes_requested` event payloads, oldest-first.
- Errors: `404`

### POST /api/tasks/[id]/move

**Drag is a command.** Validates the move against `LEGAL_MOVES`
(`src/lib/constants.ts`) AND the task's current state, then dispatches to the
orchestrator:

| from → to | requirement | orchestrator call |
|---|---|---|
| `todo → in_dev` | runState `idle`/`error` | `startTask(id)` (manual-mode start) |
| `in_dev → in_review` | task has work to review | `forceReview(id)` |
| `in_review → in_dev` | **`comment` required** (`400` if missing/empty) | `sendBackToDev(id, comment)` |

Any other `(from, to)` pair → `409 invalid_transition`. Columns always reflect real
pipeline state — the route returns the task as updated by the orchestrator (the
transition itself is recorded as task events; clients also see `task_updated` /
`task_event_appended` on the SSE stream).

- Body: `MoveTaskInput = { to: Column; comment?: string }`
- Response `200`: `Task`
- Errors: `400`, `404`, `409`, `501`

### POST /api/tasks/[id]/retry

Retry a task whose `runState` is `'error'` or `'needs_attention'`. Delegates to
`orchestrator.retryTask(id)`.

- Body: none
- Response `200`: `Task`
- Errors: `404`, `409` (`invalid_transition` — task not in a retryable state), `501`

### POST /api/tasks/[id]/cancel

Cancel a task whose `runState` is `'running'` or `'queued'`: kills any live
agent process, releases the queue slot, and leaves the task idle in its current
column. Delegates to `orchestrator.cancelTask(id)`.

- Body: none
- Response `200`: `Task`
- Errors: `404`, `409` (`invalid_transition` — task not running/queued), `501`

### DELETE /api/tasks/[id]

Delete a task and its events/runs. Refused while an agent is live — cancel first
(`orchestrator.cancelTask`) or return `409 task_running` if `runState` is
`'running'`/`'queued'`.

- Response `204`: empty body
- Errors: `404`, `409`

### GET /api/tasks/[id]/transcript  (SSE)

Replay + live stream of the task's parsed transcript (all of its agent runs,
oldest run first). Replays previously captured `TranscriptItem`s, then stays open
and forwards live items while a run is active.

- Response `200`, `Content-Type: text/event-stream`. Each SSE message:

  ```
  data: <JSON TranscriptItem>\n\n
  ```

  - Items are `TranscriptItem` (see `src/lib/types.ts`): `assistant_text`,
    `reasoning`, `tool_call`, `tool_result`, `file_edit`, `system`, `error`, `result`.
  - Heartbeat comment (`: ping`) every 25s.
  - After replay, live items are sourced from `transcript_item` bus events for this
    task id. The server closes the stream when the task has no live run and the
    final `result` item has been sent; clients may also just disconnect.
- Errors (before stream starts): `404`

---

## Config

### GET /api/config

- Response `200`: `AppConfig`

### PUT /api/config

Partial update; merged over the stored config (defaults from
`DEFAULT_APP_CONFIG`). Persists via the config repository, then calls
`orchestrator.onConfigChanged(next)` and publishes `config_updated`.

- Body: `UpdateConfigInput = Partial<AppConfig>`
- Response `200`: `AppConfig` (the full merged result)
- Errors: `400`, `501` (only if `onConfigChanged` is unimplemented — the route should still persist; map accordingly: persist first, then call the hook and swallow `NotImplementedError` with a `console.warn` during scaffold phase)

---

## Status reports

### GET /api/status-reports

Today's per-project standup pane. Delegates to
`orchestrator.getOrGenerateStatusReports()` — returns cached reports for
(project, today), generating missing ones (git log since yesterday + task
history, summarized by haiku) on first board load of the day.

- Response `200`: `ProjectStatusReport[]`
- Errors: `500` (summarizer failure), `501`

---

## Realtime

### GET /api/events  (SSE)

The board event stream. The UI opens exactly one `EventSource` here and applies
events on top of its `GET /api/board` snapshot.

- Response `200`, `Content-Type: text/event-stream`. Each SSE message:

  ```
  data: <JSON BoardEvent>\n\n
  ```

  - `BoardEvent` is the discriminated union in `src/lib/types.ts`
    (`task_created`, `task_updated`, `task_deleted`, `task_event_appended`,
    `transcript_item`, `project_created`, `project_updated`, `project_deleted`,
    `branch_pr_updated`, `status_report_ready`, `config_updated`, `notification`).
  - No SSE `event:` field is used — clients listen on `message` and switch on the
    JSON `type` discriminant.
  - Heartbeat comment (`: ping`) every 25s.
  - Implementation: subscribe via `getBus().subscribe(listener)` from
    `src/server/bus.ts`; unsubscribe on `request.signal` abort.

Implementation note for both SSE routes: export
`export const dynamic = 'force-dynamic'` and return a `ReadableStream` `Response`;
never buffer.
