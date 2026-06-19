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
