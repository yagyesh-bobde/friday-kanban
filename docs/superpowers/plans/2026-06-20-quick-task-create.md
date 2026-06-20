# Cmd+K Quick Task Create Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A global Cmd+K / Ctrl+K shortcut opens a centered single-textbox modal where the user types a task in natural language; Claude Code Haiku parses it (asking inline clarifying questions when unsure) and creates the task in the Todo column.

**Architecture:** A new server module spawns `claude -p` with the Haiku model (reusing `spawnAgent` directly, no task-scoped agent-run records) and returns either a structured task or clarifying questions as a JSON discriminated union. A new `POST /api/tasks/quick-create` route runs the parser and, on a confident result, normalizes + creates the task via the existing `orchestrator.createTask`. A new client modal drives the flow and falls back to the full New Task modal (prefilled) on parse failure.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Zustand, Zod, `claude -p` CLI subprocess. Tests use Node's built-in test runner via `tsx` (no new dependencies).

## Global Constraints

- No new npm dependencies. Tests run with `node --import tsx --test <file>`.
- Components are declared with `export function`; UI state lives in Zustand; API inputs are Zod-validated; spawns use argv arrays via `spawnAgent`.
- Use existing Tailwind design tokens (`bg-panel`, `border-edge`, `text-ink`, `text-mute`, `text-faint`, `bg-overlay`, `bg-hover`, `text-ember`, `text-danger`). No new CSS deps.
- Haiku model spec is `{ provider: "claude-code", model: "haiku", effort: "medium" }` (matches `REVIEW_SPEC`).
- Parser hard timeout: 60s. Task lands in Todo (`startNow: false`). One consolidated clarifying round only.
- `@/` path alias resolves in both app code and tests.

---

### Task 1: Types, schemas, and the `test` script

**Files:**
- Modify: `src/lib/types.ts` (append quick-create types)
- Modify: `src/lib/schemas.ts` (append quick-create schemas)
- Modify: `package.json` (add `test` script)
- Test: `src/lib/quickCreate.schema.test.ts` (create)

**Interfaces:**
- Consumes: existing `Task`, `Execution` from `types.ts`; existing `executionSchema` from `schemas.ts`.
- Produces:
  - `QuickCreateAnswer = { id: string; answer: string }`
  - `QuickCreateInput = { text: string; answers?: QuickCreateAnswer[] }`
  - `QuickCreateQuestion = { id: string; question: string; options: string[] }`
  - `QuickCreateResponse = { status: "created"; task: Task } | { status: "needs_input"; questions: QuickCreateQuestion[] }`
  - `quickCreateInputSchema` (validates the request body)
  - `quickParseOutputSchema` (validates Haiku's raw JSON output — discriminated union on `kind`)

- [ ] **Step 1: Add the `test` script to package.json**

In `package.json` `scripts`, add (after `"typecheck"`):

```json
    "test": "node --import tsx --test"
```

Run a single test file with `npm test -- <file>` or directly `node --import tsx --test <file>`.

- [ ] **Step 2: Append the types to `src/lib/types.ts`**

Add at the end of the file:

```typescript
// ── Quick task create (Cmd+K) ──────────────────────────────────────────────

/** One answer to a clarifying question, keyed by the question's id. */
export interface QuickCreateAnswer {
  id: string;
  answer: string;
}

/** Request payload for POST /api/tasks/quick-create. */
export interface QuickCreateInput {
  /** The user's raw natural-language task text. */
  text: string;
  /** Answers to a prior round of clarifying questions, if any. */
  answers?: QuickCreateAnswer[];
}

/** A clarifying question the parser asks when it cannot resolve the task. */
export interface QuickCreateQuestion {
  id: string;
  question: string;
  /** Suggested answers; the UI also offers a free-text "Other". */
  options: string[];
}

/** Response from POST /api/tasks/quick-create. */
export type QuickCreateResponse =
  | { status: "created"; task: Task }
  | { status: "needs_input"; questions: QuickCreateQuestion[] };
```

- [ ] **Step 3: Append the schemas to `src/lib/schemas.ts`**

Confirm `executionSchema` exists (it is referenced by `createTaskInputSchema`). Add at the end of the file:

```typescript
// ── Quick task create (Cmd+K) ──────────────────────────────────────────────

/** Request body for POST /api/tasks/quick-create. */
export const quickCreateInputSchema = z.object({
  text: z.string().min(1),
  answers: z
    .array(z.object({ id: z.string().min(1), answer: z.string().min(1) }))
    .optional(),
});

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
      scopePaths: z.array(z.string()).optional(),
      contextPaths: z.array(z.string()).optional(),
      execution: executionSchema.optional(),
    }),
  }),
  z.object({
    kind: z.literal("questions"),
    questions: z.array(quickParseQuestionSchema).min(1),
  }),
]);
```

- [ ] **Step 4: Write the failing schema test**

Create `src/lib/quickCreate.schema.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { quickCreateInputSchema, quickParseOutputSchema } from "@/lib/schemas";

test("quickCreateInputSchema accepts text with optional answers", () => {
  assert.equal(quickCreateInputSchema.safeParse({ text: "fix bug" }).success, true);
  assert.equal(
    quickCreateInputSchema.safeParse({
      text: "fix bug",
      answers: [{ id: "project", answer: "friday-kanban" }],
    }).success,
    true,
  );
});

test("quickCreateInputSchema rejects empty text", () => {
  assert.equal(quickCreateInputSchema.safeParse({ text: "" }).success, false);
});

test("quickParseOutputSchema parses a task result", () => {
  const r = quickParseOutputSchema.safeParse({
    kind: "task",
    task: { projectId: "p1", title: "T", prompt: "do it" },
  });
  assert.equal(r.success, true);
});

test("quickParseOutputSchema parses a questions result", () => {
  const r = quickParseOutputSchema.safeParse({
    kind: "questions",
    questions: [{ id: "project", question: "Which project?", options: ["a", "b"] }],
  });
  assert.equal(r.success, true);
});

test("quickParseOutputSchema rejects an unknown kind", () => {
  assert.equal(quickParseOutputSchema.safeParse({ kind: "nope" }).success, false);
});
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --import tsx --test src/lib/quickCreate.schema.test.ts`
Expected: `pass 5  fail 0`.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/types.ts src/lib/schemas.ts package.json src/lib/quickCreate.schema.test.ts
git commit -m "feat(quick-create): types, schemas, and test runner script

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Server parser module (`taskParser.ts`)

**Files:**
- Create: `src/server/agents/taskParser.ts`
- Test: `src/server/agents/taskParser.test.ts`

**Interfaces:**
- Consumes: `spawnAgent` from `./spawn`; `quickParseOutputSchema` from `@/lib/schemas`; `Project`, `QuickCreateAnswer`, `QuickCreateQuestion`, `Execution` from `@/lib/types`.
- Produces:
  - `buildParserPrompt(params: { rawText: string; projects: Project[]; answers?: QuickCreateAnswer[] }): string`
  - `interpretParserOutput(resultText: string, projects: Project[]): QuickParseResult`
  - `runTaskParser(params: { rawText: string; projects: Project[]; answers?: QuickCreateAnswer[]; cwd: string }): Promise<QuickParseResult>`
  - `type QuickParseResult =`
    - `{ kind: "task"; task: ParsedTask }`
    - `| { kind: "questions"; questions: QuickCreateQuestion[] }`
    - `| { kind: "error"; reason: string }`
  - `interface ParsedTask { projectId: string; title: string; prompt: string; branch?: string; scopePaths?: string[]; contextPaths?: string[]; execution?: Execution }`

- [ ] **Step 1: Write the parser module**

Create `src/server/agents/taskParser.ts`:

```typescript
/**
 * Quick-create task parser: turns a natural-language task description into a
 * structured task (or a round of clarifying questions) using Claude Code Haiku.
 *
 * Unlike the implementer/reviewer runners this is NOT tied to a task: there is
 * no task yet at parse time, so we spawn `claude -p` directly via spawnAgent
 * (no agent-run record, no transcript persistence) and read the single
 * --output-format json envelope's `result` text.
 *
 * The three units below are split so the prompt-building and output-parsing
 * logic is unit-testable without spawning a subprocess.
 */

import type {
  Execution,
  Project,
  QuickCreateAnswer,
  QuickCreateQuestion,
} from "@/lib/types";
import { quickParseOutputSchema } from "@/lib/schemas";
import { spawnAgent } from "./spawn";

/** Haiku model spec — matches the reviewer's REVIEW_SPEC. */
const PARSER_MODEL = "haiku";
const PARSER_EFFORT = "medium";
const PARSER_TIMEOUT_MS = 60_000;

export interface ParsedTask {
  projectId: string;
  title: string;
  prompt: string;
  branch?: string;
  scopePaths?: string[];
  contextPaths?: string[];
  execution?: Execution;
}

export type QuickParseResult =
  | { kind: "task"; task: ParsedTask }
  | { kind: "questions"; questions: QuickCreateQuestion[] }
  | { kind: "error"; reason: string };

export interface BuildPromptParams {
  rawText: string;
  projects: Project[];
  answers?: QuickCreateAnswer[];
}

/** Build the prompt handed to `claude -p`. */
export function buildParserPrompt(params: BuildPromptParams): string {
  const projectLines = params.projects
    .map((p) => `- id="${p.id}" name="${p.name}" baseBranch="${p.baseBranch}"`)
    .join("\n");

  const answerBlock =
    params.answers && params.answers.length > 0
      ? `\n\nThe user has already answered these clarifying questions — use them:\n` +
        params.answers.map((a) => `- ${a.id}: ${a.answer}`).join("\n")
      : "";

  return `You convert a natural-language software task into structured JSON for a kanban board. Do NOT use any tools, do NOT write files, do NOT run commands. Respond with EXACTLY ONE JSON object and nothing else.

Available projects:
${projectLines}

User request:
"""
${params.rawText}
"""${answerBlock}

Decide ONE of two outcomes.

1) If you can confidently produce a task, respond:
{"kind":"task","task":{
  "projectId":"<one of the project ids above>",
  "title":"<concise imperative title, max ~8 words>",
  "prompt":"<a clear, self-contained task prompt for a coding agent>",
  "branch":"<optional branch name; omit to use the project's baseBranch>",
  "scopePaths":["<optional glob(s) ONLY if the user clearly named files/areas>"],
  "contextPaths":["<optional file path(s) ONLY if the user clearly referenced them>"],
  "execution":"local"
}}
Omit any optional field you are not sure about. Always pick projectId from the list by id.

2) If something essential is ambiguous (most commonly WHICH PROJECT when the text does not clearly match one), respond with up to 3 questions:
{"kind":"questions","questions":[
  {"id":"project","question":"Which project is this for?","options":["<project name>","<project name>"]}
]}
Each question's "options" should list the most likely concrete choices. Ask only what you genuinely need; prefer producing a task when reasonable.

Output only the JSON object.`;
}

/** Resolve a model-supplied projectId/name against the real project list. */
function resolveProjectId(value: string, projects: Project[]): string | undefined {
  const byId = projects.find((p) => p.id === value);
  if (byId) return byId.id;
  const byName = projects.find(
    (p) => p.name.toLowerCase() === value.toLowerCase(),
  );
  return byName?.id;
}

/**
 * Salvage + validate the JSON object from the agent's final text and resolve
 * the project. Returns an error result on any failure so the caller can fall
 * back to the full editor.
 */
export function interpretParserOutput(
  resultText: string,
  projects: Project[],
): QuickParseResult {
  const trimmed = resultText.trim();
  if (trimmed.length === 0) return { kind: "error", reason: "parser returned empty output" };

  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) return { kind: "error", reason: "parser output is not JSON" };
    try {
      raw = JSON.parse(match[0]);
    } catch {
      return { kind: "error", reason: "parser output is not JSON" };
    }
  }

  const parsed = quickParseOutputSchema.safeParse(raw);
  if (!parsed.success) {
    return { kind: "error", reason: `parser output failed validation: ${parsed.error.message.slice(0, 300)}` };
  }

  if (parsed.data.kind === "questions") {
    return { kind: "questions", questions: parsed.data.questions };
  }

  const t = parsed.data.task;
  const projectId = resolveProjectId(t.projectId, projects);
  if (!projectId) {
    return { kind: "error", reason: `parser chose an unknown project: ${t.projectId}` };
  }
  return {
    kind: "task",
    task: {
      projectId,
      title: t.title,
      prompt: t.prompt,
      branch: t.branch,
      scopePaths: t.scopePaths,
      contextPaths: t.contextPaths,
      execution: t.execution,
    },
  };
}

/** Strip a `claude -p --output-format json` envelope down to its result text. */
function extractResultText(stdout: string): string | undefined {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) return undefined;
  try {
    const obj = JSON.parse(trimmed) as Record<string, unknown>;
    if (typeof obj.result === "string") return obj.result;
  } catch {
    // not a single JSON envelope — fall through and use the raw text
  }
  return trimmed;
}

function parserEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.CLAUDE_CODE_EFFORT_LEVEL; // --effort must win
  return env;
}

export interface RunParserParams extends BuildPromptParams {
  /** Working directory for the spawn. */
  cwd: string;
}

/** Spawn Haiku once and interpret its output. */
export async function runTaskParser(params: RunParserParams): Promise<QuickParseResult> {
  const prompt = buildParserPrompt(params);
  const argv = [
    "claude",
    "-p",
    prompt,
    "--model",
    PARSER_MODEL,
    "--effort",
    PARSER_EFFORT,
    "--output-format",
    "json",
    "--dangerously-skip-permissions",
  ];

  let stdout = "";
  const spawned = spawnAgent({
    argv,
    cwd: params.cwd,
    env: parserEnv(),
    stdin: "ignore",
    hardTimeoutMs: PARSER_TIMEOUT_MS,
    stallTimeoutMs: PARSER_TIMEOUT_MS,
    onStdoutChunk: (chunk) => {
      stdout += chunk.toString("utf8");
    },
  });

  const exit = await spawned.exited;
  if (exit.endReason !== "exit") {
    return { kind: "error", reason: `parser ${exit.endReason}` };
  }

  const resultText = extractResultText(stdout);
  if (resultText === undefined) {
    return { kind: "error", reason: "parser produced no result" };
  }
  return interpretParserOutput(resultText, params.projects);
}
```

- [ ] **Step 2: Write the failing test for the pure units**

Create `src/server/agents/taskParser.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Project } from "@/lib/types";
import { buildParserPrompt, interpretParserOutput } from "./taskParser";

const projects: Project[] = [
  {
    id: "p1",
    name: "friday-kanban",
    path: "/repo/friday",
    baseBranch: "main",
    defaultExecution: "local",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "p2",
    name: "other-repo",
    path: "/repo/other",
    baseBranch: "develop",
    defaultExecution: "local",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
];

test("buildParserPrompt lists projects and the raw text", () => {
  const prompt = buildParserPrompt({ rawText: "fix the login bug", projects });
  assert.match(prompt, /id="p1" name="friday-kanban"/);
  assert.match(prompt, /fix the login bug/);
});

test("buildParserPrompt includes prior answers when present", () => {
  const prompt = buildParserPrompt({
    rawText: "add dark mode",
    projects,
    answers: [{ id: "project", answer: "other-repo" }],
  });
  assert.match(prompt, /already answered/);
  assert.match(prompt, /project: other-repo/);
});

test("interpretParserOutput parses a clean task result", () => {
  const out = interpretParserOutput(
    '{"kind":"task","task":{"projectId":"p1","title":"Fix login","prompt":"Fix the login bug"}}',
    projects,
  );
  assert.equal(out.kind, "task");
  if (out.kind === "task") assert.equal(out.task.projectId, "p1");
});

test("interpretParserOutput salvages JSON wrapped in a code fence", () => {
  const out = interpretParserOutput(
    'Here you go:\n```json\n{"kind":"task","task":{"projectId":"p1","title":"T","prompt":"p"}}\n```',
    projects,
  );
  assert.equal(out.kind, "task");
});

test("interpretParserOutput resolves a project given by name", () => {
  const out = interpretParserOutput(
    '{"kind":"task","task":{"projectId":"other-repo","title":"T","prompt":"p"}}',
    projects,
  );
  assert.equal(out.kind, "task");
  if (out.kind === "task") assert.equal(out.task.projectId, "p2");
});

test("interpretParserOutput parses questions", () => {
  const out = interpretParserOutput(
    '{"kind":"questions","questions":[{"id":"project","question":"Which?","options":["friday-kanban","other-repo"]}]}',
    projects,
  );
  assert.equal(out.kind, "questions");
});

test("interpretParserOutput errors on unknown project", () => {
  const out = interpretParserOutput(
    '{"kind":"task","task":{"projectId":"ghost","title":"T","prompt":"p"}}',
    projects,
  );
  assert.equal(out.kind, "error");
});

test("interpretParserOutput errors on garbage", () => {
  assert.equal(interpretParserOutput("not json at all", projects).kind, "error");
  assert.equal(interpretParserOutput("", projects).kind, "error");
});
```

- [ ] **Step 3: Run the test to verify it passes**

Run: `node --import tsx --test src/server/agents/taskParser.test.ts`
Expected: `pass 8  fail 0`.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/server/agents/taskParser.ts src/server/agents/taskParser.test.ts
git commit -m "feat(quick-create): Haiku task parser (prompt + output interpretation)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: `POST /api/tasks/quick-create` route

**Files:**
- Create: `src/app/api/tasks/quick-create/route.ts`

**Interfaces:**
- Consumes: `quickCreateInputSchema` from `@/lib/schemas`; `listProjects` from `@/server/db/projects`; `runTaskParser` from `@/server/agents/taskParser`; `getOrchestrator` from `@/server/orchestrator`; `apiError`, `handleRouteError`, `parseBody` from `../../_lib/http`; `CreateTaskInput`, `QuickCreateResponse` from `@/lib/types`.
- Produces: HTTP responses — `201 { status: "created", task }`, `200 { status: "needs_input", questions }`, `400` (no projects / invalid body), `422` (parse failure).

> **Note on path depth:** this route is at `src/app/api/tasks/quick-create/route.ts`, one level deeper than `src/app/api/tasks/route.ts`, so the shared http helpers are imported from `../../_lib/http` (verify the relative depth — it must resolve to `src/app/api/_lib/http`).

- [ ] **Step 1: Write the route**

Create `src/app/api/tasks/quick-create/route.ts`:

```typescript
/**
 * POST /api/tasks/quick-create — natural-language quick task creation (Cmd+K).
 *
 * Runs the Haiku parser over the user's text. If the parser needs clarification
 * it returns { status: "needs_input", questions } (200). If it produces a task
 * it is normalized (branch/execution defaulted from the project), created via
 * the orchestrator, and returned as { status: "created", task } (201). A parse
 * failure returns 422 so the client can fall back to the full New Task editor.
 */

import { quickCreateInputSchema } from "@/lib/schemas";
import type { CreateTaskInput, QuickCreateResponse } from "@/lib/types";
import { listProjects } from "@/server/db/projects";
import { runTaskParser } from "@/server/agents/taskParser";
import { getOrchestrator } from "@/server/orchestrator";
import { apiError, handleRouteError, parseBody } from "../../_lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const body = await parseBody(request, quickCreateInputSchema);
  if (!body.ok) return body.response;

  const projects = listProjects();
  if (projects.length === 0) {
    return apiError(400, "Add a project before creating tasks.", "no_projects");
  }

  try {
    const result = await runTaskParser({
      rawText: body.data.text,
      projects,
      answers: body.data.answers,
      cwd: process.cwd(),
    });

    if (result.kind === "error") {
      return apiError(422, `Could not understand the task: ${result.reason}`, "parse_failed");
    }

    if (result.kind === "questions") {
      const payload: QuickCreateResponse = { status: "needs_input", questions: result.questions };
      return Response.json(payload, { status: 200 });
    }

    const project = projects.find((p) => p.id === result.task.projectId);
    if (!project) {
      return apiError(422, "Resolved project no longer exists.", "parse_failed");
    }

    const input: CreateTaskInput = {
      projectId: result.task.projectId,
      title: result.task.title,
      prompt: result.task.prompt,
      branch: result.task.branch ?? project.baseBranch,
      execution: result.task.execution ?? project.defaultExecution,
      ...(result.task.scopePaths ? { scopePaths: result.task.scopePaths } : {}),
      ...(result.task.contextPaths ? { contextPaths: result.task.contextPaths } : {}),
      startNow: false,
    };

    const task = await getOrchestrator().createTask(input);
    const payload: QuickCreateResponse = { status: "created", task };
    return Response.json(payload, { status: 201 });
  } catch (err) {
    return handleRouteError(err);
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors. (In particular, confirm `../../_lib/http` resolves; if the editor flags it, the correct relative path from `src/app/api/tasks/quick-create/route.ts` to `src/app/api/_lib/http.ts` is `../../_lib/http`.)

- [ ] **Step 3: Manual smoke test (requires `claude` CLI + at least one project)**

Start the dev server (`npm run dev`) in a separate terminal, then:

```bash
curl -s -X POST http://localhost:3000/api/tasks/quick-create \
  -H 'Content-Type: application/json' \
  -d '{"text":"add a dark mode toggle to the settings popover in friday-kanban"}' | head -c 800
```

Expected: a JSON body with `"status":"created"` and a `task` object (or `"status":"needs_input"` with questions if the text is ambiguous). Note: this spends a small amount on a real Haiku call.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/tasks/quick-create/route.ts
git commit -m "feat(quick-create): POST /api/tasks/quick-create route

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: UI store + API client wiring

**Files:**
- Modify: `src/store/ui.ts`
- Modify: `src/store/api.ts`

**Interfaces:**
- Consumes: `QuickCreateInput`, `QuickCreateResponse` from `@/lib/types`.
- Produces:
  - `useUi` additions: `quickCreateOpen: boolean`, `openQuickCreate(): void`, `closeQuickCreate(): void`; `newTaskInitialPrompt?: string`; extended `openNewTask(projectId?: string, initialPrompt?: string): void`.
  - `api.quickCreateTask(input: QuickCreateInput): Promise<QuickCreateResponse>`.

- [ ] **Step 1: Extend the UI store**

In `src/store/ui.ts`, update the `UiStore` interface — replace the existing `// new task modal` block and add a quick-create block:

```typescript
  // new task modal
  newTaskOpen: boolean;
  newTaskProjectId?: string;
  newTaskInitialPrompt?: string;
  openNewTask: (projectId?: string, initialPrompt?: string) => void;
  closeNewTask: () => void;

  // quick-create modal (Cmd+K)
  quickCreateOpen: boolean;
  openQuickCreate: () => void;
  closeQuickCreate: () => void;
```

Then update the store implementation — replace the existing `newTaskOpen`/`openNewTask`/`closeNewTask` block:

```typescript
  newTaskOpen: false,
  newTaskProjectId: undefined,
  newTaskInitialPrompt: undefined,
  openNewTask: (projectId, initialPrompt) =>
    set({ newTaskOpen: true, newTaskProjectId: projectId, newTaskInitialPrompt: initialPrompt }),
  closeNewTask: () =>
    set({ newTaskOpen: false, newTaskProjectId: undefined, newTaskInitialPrompt: undefined }),

  quickCreateOpen: false,
  openQuickCreate: () => set({ quickCreateOpen: true }),
  closeQuickCreate: () => set({ quickCreateOpen: false }),
```

- [ ] **Step 2: Add the API client method**

In `src/store/api.ts`, add `QuickCreateInput` and `QuickCreateResponse` to the type import block from `@/lib/types`. Then inside the `api` object, in the `// tasks` section (e.g. after `createTask`), add:

```typescript
  quickCreateTask: (input: QuickCreateInput) =>
    request<QuickCreateResponse>("/api/tasks/quick-create", post(input)),
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/store/ui.ts src/store/api.ts
git commit -m "feat(quick-create): UI store state + API client method

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: `QuickCreateQuestions` sub-component

**Files:**
- Create: `src/components/modals/QuickCreateQuestions.tsx`

**Interfaces:**
- Consumes: `QuickCreateQuestion`, `QuickCreateAnswer` from `@/lib/types`; `Button` from `@/components/ui/fields`; `cn` from `@/components/util`.
- Produces: `function QuickCreateQuestions(props: { questions: QuickCreateQuestion[]; onSubmit: (answers: QuickCreateAnswer[]) => void; disabled?: boolean }): JSX.Element`.

- [ ] **Step 1: Write the component**

Create `src/components/modals/QuickCreateQuestions.tsx`:

```typescript
"use client";

import { useMemo, useState } from "react";
import type { QuickCreateAnswer, QuickCreateQuestion } from "@/lib/types";
import { Button } from "@/components/ui/fields";
import { cn } from "@/components/util";

interface QuickCreateQuestionsProps {
  questions: QuickCreateQuestion[];
  onSubmit: (answers: QuickCreateAnswer[]) => void;
  disabled?: boolean;
}

const OTHER = "__other__";

/** Inline clarifying questions: option chips + a free-text "Other" per question. */
export function QuickCreateQuestions({ questions, onSubmit, disabled }: QuickCreateQuestionsProps) {
  // Per-question selected option (or the OTHER sentinel) and the free-text value.
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [other, setOther] = useState<Record<string, string>>({});

  const answers = useMemo<QuickCreateAnswer[]>(() => {
    return questions.map((q) => {
      const sel = picked[q.id];
      const value = sel === OTHER ? (other[q.id] ?? "").trim() : (sel ?? "");
      return { id: q.id, answer: value };
    });
  }, [questions, picked, other]);

  const allAnswered = answers.every((a) => a.answer.length > 0);

  return (
    <div className="flex flex-col gap-5">
      {questions.map((q) => (
        <div key={q.id} className="flex flex-col gap-2">
          <p className="text-[13px] font-medium text-ink">{q.question}</p>
          <div className="flex flex-wrap gap-2">
            {q.options.map((opt) => (
              <button
                key={opt}
                type="button"
                disabled={disabled}
                onClick={() => setPicked((p) => ({ ...p, [q.id]: opt }))}
                className={cn(
                  "rounded-full border px-3 py-1 text-[12px] transition-colors",
                  picked[q.id] === opt
                    ? "border-ember bg-ember/15 text-ink"
                    : "border-edge bg-overlay text-mute hover:bg-hover hover:text-ink",
                )}
              >
                {opt}
              </button>
            ))}
            <button
              type="button"
              disabled={disabled}
              onClick={() => setPicked((p) => ({ ...p, [q.id]: OTHER }))}
              className={cn(
                "rounded-full border px-3 py-1 text-[12px] transition-colors",
                picked[q.id] === OTHER
                  ? "border-ember bg-ember/15 text-ink"
                  : "border-edge bg-overlay text-mute hover:bg-hover hover:text-ink",
              )}
            >
              Other…
            </button>
          </div>
          {picked[q.id] === OTHER ? (
            <input
              autoFocus
              disabled={disabled}
              value={other[q.id] ?? ""}
              onChange={(e) => setOther((o) => ({ ...o, [q.id]: e.target.value }))}
              placeholder="Type your answer"
              className="mt-1 w-full rounded-md border border-edge bg-overlay px-3 py-1.5 text-[13px] text-ink outline-none focus:border-ember"
            />
          ) : null}
        </div>
      ))}

      <div className="flex justify-end">
        <Button
          variant="primary"
          disabled={disabled || !allAnswered}
          onClick={() => onSubmit(answers)}
        >
          Continue
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/modals/QuickCreateQuestions.tsx
git commit -m "feat(quick-create): inline clarifying-questions component

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: `QuickCreateModal` component

**Files:**
- Create: `src/components/modals/QuickCreateModal.tsx`

**Interfaces:**
- Consumes: `useUi` (`quickCreateOpen`, `closeQuickCreate`, `openNewTask`, `toast`) from `@/store/ui`; `api` + `ApiHttpError` from `@/store/api`; `useBoard` (for `refresh`) from `@/store/board`; `Modal` from `@/components/ui/Modal`; `Button`, `Textarea` from `@/components/ui/fields`; `Spinner` from `@/components/ui/icons`; `QuickCreateQuestions` from `./QuickCreateQuestions`; `QuickCreateAnswer`, `QuickCreateQuestion` from `@/lib/types`.
- Produces: `function QuickCreateModal(): JSX.Element | null`.

> **Verify before writing:** confirm the board store exposes a method to re-sync after a mutation. The exploration found `refresh` on `useBoard` (used by `BoardApp`). The created task also arrives via the SSE `task_created` event, so an explicit refresh is belt-and-suspenders — if `useBoard` has no `refresh`, omit that call; the SSE stream will still surface the task.

- [ ] **Step 1: Write the component**

Create `src/components/modals/QuickCreateModal.tsx`:

```typescript
"use client";

import { useEffect, useRef, useState } from "react";
import type { QuickCreateAnswer, QuickCreateQuestion } from "@/lib/types";
import { api, ApiHttpError } from "@/store/api";
import { useUi } from "@/store/ui";
import { Modal } from "@/components/ui/Modal";
import { Button, Textarea } from "@/components/ui/fields";
import { Spinner } from "@/components/ui/icons";
import { QuickCreateQuestions } from "./QuickCreateQuestions";

type Phase =
  | { stage: "input" }
  | { stage: "loading" }
  | { stage: "questions"; questions: QuickCreateQuestion[] }
  | { stage: "error"; message: string };

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform);
const SUBMIT_HINT = isMac ? "⌘↵ to create" : "Ctrl+↵ to create";

export function QuickCreateModal() {
  const open = useUi((s) => s.quickCreateOpen);
  const close = useUi((s) => s.closeQuickCreate);
  const openNewTask = useUi((s) => s.openNewTask);
  const toast = useUi((s) => s.toast);

  const [text, setText] = useState("");
  const [phase, setPhase] = useState<Phase>({ stage: "input" });
  const textRef = useRef<HTMLTextAreaElement>(null);

  // Reset and focus on open.
  useEffect(() => {
    if (!open) return;
    setText("");
    setPhase({ stage: "input" });
    const id = window.setTimeout(() => textRef.current?.focus(), 30);
    return () => window.clearTimeout(id);
  }, [open]);

  const fallbackToFullEditor = (draft: string) => {
    close();
    openNewTask(undefined, draft);
  };

  const submit = async (answers: QuickCreateAnswer[]) => {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    setPhase({ stage: "loading" });
    try {
      const res = await api.quickCreateTask({
        text: trimmed,
        ...(answers.length > 0 ? { answers } : {}),
      });
      if (res.status === "needs_input") {
        setPhase({ stage: "questions", questions: res.questions });
        return;
      }
      toast("success", "Task added to Todo", res.task.title, res.task.id);
      close();
    } catch (err) {
      if (err instanceof ApiHttpError && err.status === 422) {
        // Parser couldn't understand it — hand the text to the full editor.
        fallbackToFullEditor(trimmed);
        toast("info", "Opening the full editor", "Add the details manually.");
        return;
      }
      const message = err instanceof ApiHttpError ? err.friendly : "Something went wrong.";
      setPhase({ stage: "error", message });
    }
  };

  const onTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const mod = isMac ? e.metaKey : e.ctrlKey;
    if (e.key === "Enter" && (mod || !e.shiftKey)) {
      // Enter (or Cmd/Ctrl+Enter) submits; Shift+Enter inserts a newline.
      e.preventDefault();
      void submit([]);
    }
  };

  if (!open) return null;

  return (
    <Modal
      open={open}
      onClose={close}
      title="Quick create"
      subtitle="Describe a task in plain language — Haiku turns it into a Todo."
      width="max-w-xl"
    >
      {phase.stage === "questions" ? (
        <QuickCreateQuestions
          questions={phase.questions}
          onSubmit={(answers) => void submit(answers)}
        />
      ) : (
        <div className="flex flex-col gap-3">
          <Textarea
            ref={textRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onTextareaKeyDown}
            disabled={phase.stage === "loading"}
            rows={4}
            placeholder="e.g. Fix the flaky login redirect on the kanban board and add a regression test"
          />

          {phase.stage === "error" ? (
            <p className="text-[12px] text-danger">{phase.message}</p>
          ) : null}

          <div className="flex items-center justify-between">
            <span className="text-[11px] text-faint">
              {phase.stage === "loading" ? null : SUBMIT_HINT}
            </span>
            <div className="flex items-center gap-2">
              {phase.stage === "error" ? (
                <Button variant="ghost" onClick={() => fallbackToFullEditor(text.trim())}>
                  Open full editor
                </Button>
              ) : null}
              <Button
                variant="primary"
                disabled={phase.stage === "loading" || text.trim().length === 0}
                onClick={() => void submit([])}
              >
                {phase.stage === "loading" ? (
                  <span className="flex items-center gap-2">
                    <Spinner size={13} /> Thinking…
                  </span>
                ) : (
                  "Create"
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors. (If `Textarea`'s `forwardRef` ref type complains, confirm the import is the `Textarea` from `fields.tsx`, which is `forwardRef<HTMLDivElement?, ...>` — it is typed `HTMLTextAreaElement`, so `useRef<HTMLTextAreaElement>(null)` matches.)

- [ ] **Step 3: Commit**

```bash
git add src/components/modals/QuickCreateModal.tsx
git commit -m "feat(quick-create): the Cmd+K quick-create modal

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Global hotkey + render modal + full-editor prefill

**Files:**
- Modify: `src/components/board/BoardApp.tsx`
- Modify: `src/components/modals/NewTaskModal.tsx`

**Interfaces:**
- Consumes: `useUi` (`openQuickCreate`, `quickCreateOpen`, `newTaskOpen`, `drawerTaskId`, `addProjectOpen`, `sendBackTaskId`, `newTaskInitialPrompt`); `QuickCreateModal` from `@/components/modals/QuickCreateModal`.
- Produces: a working Cmd+K / Ctrl+K shortcut; `QuickCreateModal` mounted; `NewTaskModal` prompt seeded from `newTaskInitialPrompt`.

- [ ] **Step 1: Seed NewTaskModal's prompt from the store**

In `src/components/modals/NewTaskModal.tsx`:

1. Read the initial prompt near the other `useUi` reads (after `prefillProjectId`):

```typescript
  const prefillPrompt = useUi((s) => s.newTaskInitialPrompt);
```

2. In the existing "reset when (re)opened" effect, change the prompt reset line from `setPrompt("");` to:

```typescript
    setPrompt(prefillPrompt ?? "");
```

(The effect already depends only on `[open]` with an eslint-disable for exhaustive-deps; the prefill is read at open time, which is the intended behavior — leave the deps array as-is.)

- [ ] **Step 2: Add the hotkey + mount the modal in BoardApp**

In `src/components/board/BoardApp.tsx`:

1. Add the import near the other modal imports (after `import { NewTaskModal } ...`):

```typescript
import { QuickCreateModal } from "@/components/modals/QuickCreateModal";
```

2. In the `BoardApp` default-export component, add store reads after `const boardView = ...`:

```typescript
  const openQuickCreate = useUi((s) => s.openQuickCreate);
  const anyModalOpen = useUi(
    (s) =>
      s.quickCreateOpen ||
      s.newTaskOpen ||
      s.addProjectOpen ||
      s.sendBackTaskId !== null ||
      s.drawerTaskId !== null,
  );
```

3. Add a hotkey effect after the existing `useEffect(() => { void init(); }, [init]);`:

```typescript
  useEffect(() => {
    const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
    const onKey = (e: KeyboardEvent) => {
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (!anyModalOpen) openQuickCreate();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [anyModalOpen, openQuickCreate]);
```

4. Mount the modal in the overlays block, right after `<NewTaskModal />`:

```typescript
      <NewTaskModal />
      <QuickCreateModal />
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Manual end-to-end verification**

Run `npm run dev`, open the board with at least one project, then:
1. Press **Cmd+K** (mac) / **Ctrl+K** — the centered Quick create modal opens, textarea focused.
2. Type a clear task mentioning a project and press **Enter** (or Cmd/Ctrl+Enter) → "Thinking…" → a success toast "Task added to Todo" and a new card in the Todo column.
3. Type something ambiguous (e.g. "add dark mode" with multiple projects) → inline questions appear with option chips + "Other…"; pick answers, click **Continue** → task created.
4. Press **Esc** → modal closes (handled by `Modal`).
5. Confirm Cmd+K does nothing while another modal/drawer is open.

- [ ] **Step 5: Commit**

```bash
git add src/components/board/BoardApp.tsx src/components/modals/NewTaskModal.tsx
git commit -m "feat(quick-create): Cmd+K hotkey, mount modal, full-editor prefill

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Cmd+K / Ctrl+K shortcut → Task 7 ✓
- Centered modal like search, single textbox → Task 6 (uses `Modal`) ✓
- Haiku parses natural-language into a task → Tasks 2 + 3 ✓
- Adds to Todo (`startNow: false`) → Task 3 ✓
- Inline clarifying questions with selectable options + free text, then continue → Tasks 5 + 6 ✓ (one consolidated round per spec)
- Project resolution: infer, else ask → parser prompt (Task 2) + `interpretParserOutput` resolution ✓
- Parse-failure fallback opens full NewTaskModal prefilled → Tasks 4 (store) + 6 (modal) + 7 (seed) ✓
- 60s timeout → Task 2 (`PARSER_TIMEOUT_MS`) ✓
- Parser bypasses task-scoped agent-run records → Task 2 (`runTaskParser` uses `spawnAgent` directly) ✓

**Placeholder scan:** No TBD/TODO; every code step has full code. ✓

**Type consistency:** `QuickCreateQuestion`/`QuickCreateAnswer`/`QuickCreateInput`/`QuickCreateResponse` defined in Task 1 and used consistently in Tasks 2–7. `QuickParseResult`/`ParsedTask` defined and used within Task 2 and consumed in Task 3. `openNewTask(projectId?, initialPrompt?)` extended in Task 4, called with the draft in Task 6, read in Task 7. `quickCreateTask` signature matches between Tasks 4 and 6. ✓
