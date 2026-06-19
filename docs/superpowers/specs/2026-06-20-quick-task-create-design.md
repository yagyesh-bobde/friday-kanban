# Cmd+K Quick Task Create — Design

**Date:** 2026-06-20
**Status:** Approved (pending implementation plan)

## Summary

Add a global **Cmd+K** (macOS) / **Ctrl+K** (Windows/Linux) keyboard shortcut that opens a
centered, single-textbox modal. The user types a task in natural language; **Claude Code
Haiku** parses it into a structured task and creates it directly in the **Todo** column.
When Haiku lacks the information it needs, it returns one consolidated round of clarifying
questions (selectable option chips plus a free-text "Other"), rendered inline in the same
modal. The user answers, Haiku re-parses once, and the task is committed.

This mirrors the app's existing model: there is no Anthropic SDK — Claude runs as the
`claude -p` CLI subprocess. The reviewer (`claudeReviewer.ts`) already invokes Haiku and
parses a JSON verdict out of the result; the parser here follows the same shape.

## Goals

- One keystroke from anywhere on the board to "type a task and forget it."
- Natural-language input → structured `CreateTaskInput`, with no required form fields.
- Graceful handling of ambiguity via inline, answerable questions (no dead ends).
- Reuse existing primitives (`Modal`, `Textarea`, Zustand UI store, `spawnAgent`,
  `orchestrator.createTask`) and conventions. No new dependencies.

## Non-Goals (YAGNI)

- Image attachments (the full New Task modal handles those).
- Per-task model overrides selection.
- Multi-round interrogation — exactly one clarifying round, then commit or fall back.
- Inferring `workspaceMode` or `modelOverrides` from text — left at task defaults.

## User Flow

1. User presses **Cmd+K** (mac) / **Ctrl+K** (other) → quick-create modal opens, textarea
   autofocused.
2. User types natural-language text. **Enter** submits; **Shift+Enter** inserts a newline.
3. Client `POST /api/tasks/quick-create { text, answers: [] }`. Modal shows a "Thinking…"
   loading state; input is disabled while in flight.
4. Server runs Haiku. Two outcomes:
   - **Needs input** → returns `{ status: "needs_input", questions }`. Modal renders the
     questions inline (option chips + "Other…" free text). User answers all, clicks
     **Continue**.
   - **Created** → returns `{ status: "created", task }`. Modal shows a brief success state,
     toasts "Added to Todo", and closes.
5. On answering questions, the client re-submits `{ text, answers }` (same original text plus
   the collected answers). This is a single consolidated round: the re-parse either creates
   the task or, if Haiku still cannot resolve it, surfaces an error (no further question
   loop).

## Architecture

### Server

**`src/server/agents/taskParser.ts`** (new — modeled on `claudeReviewer.ts`). Three isolated,
independently testable units:

- `buildParserPrompt({ rawText, projects, answers })` → `string`
  Builds the prompt. Includes the project list (`id`, `name`, `baseBranch`), the raw user
  text, and any prior Q&A. Instructs Haiku to respond with **exactly one JSON object** and
  to use no tools.
- `interpretParserOutput(resultText, projects)` → `QuickParseResult`
  Salvages the JSON object from the agent's final text (same tolerant extraction approach as
  `parseVerdict` — strips code fences, finds the outermost `{...}`), then Zod-validates it
  into the discriminated union below. Returns a parse-failure marker on invalid output.
- `runTaskParser({ rawText, projects, answers })` → `Promise<QuickParseResult>`
  Spawns `claude -p "<prompt>" --model haiku --effort medium --output-format json` via
  `spawnAgent` **directly** (60s hard timeout, no `createAgentRun`/transcript records — there
  is no task yet, so the task-scoped agent-run machinery is intentionally bypassed). Collects
  stdout, extracts the single `result` JSON's `result` text, and delegates to
  `interpretParserOutput`. On spawn error / timeout / empty output, returns a parse-failure
  marker.

**Haiku JSON contract** (discriminated union on `kind`):

```jsonc
// confident — ready to create
{ "kind": "task", "task": {
    "projectId": "<id from the provided list>",
    "title": "<short title>",
    "prompt": "<full task prompt>",
    "branch": "<optional; omit to use project baseBranch>",
    "scopePaths": ["<optional globs, only if clearly stated>"],
    "contextPaths": ["<optional files, only if clearly stated>"],
    "execution": "local | cloud (optional; omit to use project default)"
} }

// needs clarification — one consolidated round
{ "kind": "questions", "questions": [
    { "id": "project", "question": "Which project?", "options": ["friday-kanban", "other"] }
] }
```

**`src/app/api/tasks/quick-create/route.ts`** (new — `POST`, `runtime = "nodejs"`,
`dynamic = "force-dynamic"`):

- Validates body with `quickCreateInputSchema` (`{ text: string≥1, answers?: Answer[] }`).
- Loads projects (`listProjects()`). If none exist → `apiError(400, ...)` ("Add a project
  first").
- Calls `runTaskParser`.
  - `kind: "questions"` → `Response.json({ status: "needs_input", questions })`.
  - `kind: "task"` → normalize into `CreateTaskInput`: resolve/verify `projectId` against the
    project list; fill `branch` from `project.baseBranch` when absent; fill `execution` from
    `project.defaultExecution` when absent; set `startNow: false`. Validate via
    `createTaskInputSchema`, then `getOrchestrator().createTask(input)`. Return
    `{ status: "created", task }` (201).
  - parse-failure → `apiError(422, ...)` so the client can trigger the full-editor fallback.

### Client

**`src/store/ui.ts`** — add:
- `quickCreateOpen: boolean`, `openQuickCreate()`, `closeQuickCreate()`.
- Extend `openNewTask` to accept an optional initial draft so the fallback can prefill the
  full modal: `openNewTask(projectId?, initialPrompt?)` with a matching `newTaskInitialPrompt`
  field. `NewTaskModal` seeds its prompt textarea from it on open.

**`src/store/api.ts`** — add `quickCreateTask({ text, answers })` posting to
`/api/tasks/quick-create`, typed to the discriminated response.

**`src/components/modals/QuickCreateModal.tsx`** (new) — uses the existing `Modal`
(`width="max-w-xl"`). Internal state machine: `input → loading → (questions | error)`;
success closes the modal. Autofocused `Textarea`. Enter submits, Shift+Enter newlines.
On a `422` / parse-failure error: call `openNewTask(undefined, currentText)` then
`closeQuickCreate()` — opening the full New Task modal with the typed text preserved.

**`src/components/modals/QuickCreateQuestions.tsx`** (new — small sub-component) — renders
each question as a label, a row of selectable option chips, and an "Other…" free-text field.
Tracks one answer per question; "Continue" is enabled once all are answered and re-submits
`{ text, answers }`.

**`src/components/board/BoardApp.tsx`** — register the global hotkey following the existing
`window` keydown + cleanup pattern: `const mod = isMac ? e.metaKey : e.ctrlKey;` then
`if (mod && e.key.toLowerCase() === "k") { e.preventDefault(); if (!anyModalOpen) openQuickCreate(); }`.

### Types & Schemas

**`src/lib/types.ts`** — `QuickCreateInput`, `QuickCreateAnswer` (`{ id, answer }`),
`QuickCreateQuestion` (`{ id, question, options }`), `QuickCreateResponse` (discriminated on
`status`: `created` | `needs_input`).

**`src/lib/schemas.ts`** — `quickCreateInputSchema`; `quickParseTaskSchema` and
`quickParseQuestionsSchema` for validating Haiku's output inside `interpretParserOutput`.

## Data Flow Diagram

```
Cmd+K ──▶ QuickCreateModal ──(text)──▶ POST /api/tasks/quick-create
                                              │
                                       runTaskParser (claude -p haiku, 60s)
                                              │
                          ┌───────────────────┴───────────────────┐
                   kind:"questions"                          kind:"task"
                          │                                        │
              {status:"needs_input"}                  normalize → createTaskInputSchema
                          │                                        │
        inline questions (chips + Other)              orchestrator.createTask()
                          │                                        │
            Continue → POST { text, answers } ──┐        {status:"created", task}
                                                 │                 │
                                          (one re-parse)    toast "Added to Todo", close
```

## Error Handling

- **Spawn fails / timeout / invalid JSON** → `422`; client opens the full `NewTaskModal`
  prefilled with the typed text (confirmed fallback).
- **No projects** → `400`; modal shows an inline message prompting the user to add a project.
- **Empty input / request in flight** → submit disabled.
- **Re-parse after answers still unresolved** → surfaced as an error (no second question
  round), routing to the full-editor fallback.

## Testing

- `buildParserPrompt` — includes projects and answers; deterministic shape.
- `interpretParserOutput` — sample Haiku outputs: clean task JSON, fenced JSON, questions
  JSON, and garbage (→ parse-failure). Validates the discriminated union and project
  resolution.
- Normalization — branch/execution defaulting from the project; unknown `projectId` rejected.
- The spawn is isolated in `runTaskParser`, so the pure units above need no subprocess.

## Conventions Followed

- Components as `export function`; custom `Modal` + `createPortal`; Zustand for UI state;
  Zod-validated API inputs; `apiError`/`handleRouteError` from `api/_lib/http`; argv-array
  spawns via `spawnAgent`; Tailwind design tokens; no new dependencies.
