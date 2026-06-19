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
