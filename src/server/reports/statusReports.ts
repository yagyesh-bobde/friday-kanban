/**
 * Morning status pane (DESIGN.md decision 9): on first board load of the day,
 * for each project gather yesterday's git activity + friday's own task
 * history, summarize via `claude -p --model haiku --output-format json`
 * (graceful fallback to a plain-text digest when claude fails), and cache per
 * (project, date) in SQLite.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Project, ProjectStatusReport } from "@/lib/types";
import { listProjects } from "@/server/db/projects";
import { getStatusReport, upsertStatusReport } from "@/server/db/statusReports";
import { listTaskEventsForProjectBetween } from "@/server/db/tasks";
import { gh, gitLog } from "@/server/git";
import { publish } from "@/server/bus";

const execFileAsync = promisify(execFile);

const SUMMARIZER_TIMEOUT_MS = 120_000;
const GIT_LOG_MAX_CHARS = 24_000;

/** Local YYYY-MM-DD for a Date. */
function localDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

interface GatheredData {
  gitLog: string;
  commitCount: number;
  prsMerged: number;
  taskHistory: string;
  tasksCompleted: number;
}

async function gatherProjectData(project: Project): Promise<GatheredData> {
  const now = new Date();
  const todayStart = startOfLocalDay(now);
  const yesterdayStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);
  const sinceArg = "yesterday 00:00";
  const untilArg = "today 00:00";

  let log = "";
  let commitCount = 0;
  try {
    log = await gitLog(project.path, [
      "--all",
      "--since",
      sinceArg,
      "--until",
      untilArg,
      "--stat",
      "--no-color",
    ]);
    const oneline = await gitLog(project.path, [
      "--all",
      "--since",
      sinceArg,
      "--until",
      untilArg,
      "--oneline",
      "--no-color",
    ]);
    commitCount = oneline.split("\n").filter((l) => l.trim().length > 0).length;
  } catch {
    log = "(git log unavailable)";
  }
  if (log.length > GIT_LOG_MAX_CHARS) {
    log = `${log.slice(0, GIT_LOG_MAX_CHARS)}\n… [truncated]`;
  }

  let prsMerged = 0;
  try {
    const out = await gh(project.path, [
      "pr",
      "list",
      "--state",
      "merged",
      "--search",
      `merged:>=${localDateString(yesterdayStart)}`,
      "--json",
      "number",
      "--limit",
      "100",
    ]);
    const parsed = JSON.parse(out) as unknown[];
    prsMerged = Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    prsMerged = 0; // gh not configured / no remote — fine
  }

  const events = listTaskEventsForProjectBetween(
    project.id,
    yesterdayStart.toISOString(),
    todayStart.toISOString(),
  );
  const tasksCompleted = events.filter((e) => e.type === "review_approved").length;
  const taskHistory =
    events.length === 0
      ? "(no friday-kanban task activity)"
      : events.map((e) => `${e.at} [${e.taskTitle}] ${e.type}`).join("\n");

  return { gitLog: log, commitCount, prsMerged, taskHistory, tasksCompleted };
}

/** Plain-text fallback when the haiku summarizer is unavailable. */
function fallbackSummary(project: Project, data: GatheredData): string {
  const lines = [
    `**${project.name}** — ${data.commitCount} commit(s), ${data.prsMerged} PR(s) merged, ${data.tasksCompleted} task(s) completed yesterday.`,
  ];
  if (data.commitCount > 0) {
    lines.push("", "Raw git log excerpt:", "```", data.gitLog.slice(0, 1_500), "```");
  }
  return lines.join("\n");
}

/**
 * Summarize via `claude -p --model haiku --output-format json`.
 * Returns undefined on any failure (caller falls back).
 */
async function summarizeWithHaiku(project: Project, data: GatheredData): Promise<string | undefined> {
  const prompt = [
    "You are writing one project's section of a developer's morning standup digest.",
    `Project: ${project.name}`,
    "",
    "Summarize YESTERDAY's activity below in 2-5 tight markdown bullet points:",
    "what shipped, what's in flight, anything that failed or needs attention.",
    "No preamble, no headings, no commentary about the data itself — bullets only.",
    "",
    "## git log (yesterday)",
    data.gitLog || "(no commits)",
    "",
    "## friday-kanban task events (yesterday)",
    data.taskHistory,
  ].join("\n");

  try {
    const { stdout } = await execFileAsync(
      "claude",
      ["-p", prompt, "--model", "haiku", "--output-format", "json"],
      { timeout: SUMMARIZER_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024, env: process.env },
    );
    const parsed = JSON.parse(stdout.trim()) as Record<string, unknown>;
    if (parsed.is_error === true) return undefined;
    const result = parsed.result;
    if (typeof result === "string" && result.trim().length > 0) {
      return result.trim();
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/** Generate (or fetch cached) today's report for one project. */
export async function getOrGenerateReportForProject(project: Project): Promise<ProjectStatusReport> {
  const today = localDateString(new Date());
  const cached = getStatusReport(project.id, today);
  if (cached) return cached;

  const data = await gatherProjectData(project);
  const summary = (await summarizeWithHaiku(project, data)) ?? fallbackSummary(project, data);

  const report = upsertStatusReport({
    projectId: project.id,
    date: today,
    summary,
    commitCount: data.commitCount,
    prsMerged: data.prsMerged,
    tasksCompleted: data.tasksCompleted,
  });
  publish({ type: "status_report_ready", report });
  return report;
}

/**
 * Today's reports for ALL projects, generating missing ones. Projects are
 * processed sequentially (one haiku call at a time) — first board load of
 * the day triggers this.
 */
export async function getOrGenerateStatusReports(): Promise<ProjectStatusReport[]> {
  const reports: ProjectStatusReport[] = [];
  for (const project of listProjects()) {
    try {
      reports.push(await getOrGenerateReportForProject(project));
    } catch (err) {
      console.warn(`[statusReports] ${project.name}: ${String(err)}`);
    }
  }
  return reports;
}
