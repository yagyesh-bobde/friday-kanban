import { test } from "node:test";
import assert from "node:assert/strict";
import type { Project } from "@/lib/types";
import { buildParserPrompt, interpretParserOutput, toCreateTaskInput } from "./taskParser";

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

// ── toCreateTaskInput ────────────────────────────────────────────────────────

const p1 = projects[0]!;
const p2 = projects[1]!;

test("toCreateTaskInput defaults branch and execution from project, sets startNow:false, omits optional paths", () => {
  const task = { projectId: "p1", title: "Fix bug", prompt: "Fix the login bug" };
  const result = toCreateTaskInput(task, p1);
  assert.equal(result.branch, "main");
  assert.equal(result.execution, "local");
  assert.equal(result.startNow, false);
  assert.equal("scopePaths" in result, false);
  assert.equal("contextPaths" in result, false);
});

test("toCreateTaskInput keeps explicit branch/execution and includes paths when provided", () => {
  const task = {
    projectId: "p2",
    title: "Add feature",
    prompt: "Add the dark mode feature",
    branch: "feat/dark-mode",
    execution: "local" as const,
    scopePaths: ["src/theme/**"],
    contextPaths: ["src/components/Button.tsx"],
  };
  const result = toCreateTaskInput(task, p2);
  assert.equal(result.branch, "feat/dark-mode");
  assert.equal(result.execution, "local");
  assert.deepEqual(result.scopePaths, ["src/theme/**"]);
  assert.deepEqual(result.contextPaths, ["src/components/Button.tsx"]);
  assert.equal(result.startNow, false);
});
