/** Repository for `status_reports` — Haiku-summarized morning pane, cached per (project, date). */

import { ulid } from "ulid";
import type { ProjectStatusReport } from "@/lib/types";
import { getDb, nowIso } from "./index";

interface StatusReportRow {
  id: string;
  project_id: string;
  date: string;
  summary: string;
  commit_count: number;
  prs_merged: number;
  tasks_completed: number;
  created_at: string;
}

function rowToReport(row: StatusReportRow): ProjectStatusReport {
  return {
    id: row.id,
    projectId: row.project_id,
    date: row.date,
    summary: row.summary,
    commitCount: row.commit_count,
    prsMerged: row.prs_merged,
    tasksCompleted: row.tasks_completed,
    createdAt: row.created_at,
  };
}

export function getStatusReport(projectId: string, date: string): ProjectStatusReport | undefined {
  const row = getDb()
    .prepare(`SELECT * FROM status_reports WHERE project_id = ? AND date = ?`)
    .get(projectId, date) as StatusReportRow | undefined;
  return row ? rowToReport(row) : undefined;
}

export function listStatusReportsByDate(date: string): ProjectStatusReport[] {
  const rows = getDb()
    .prepare(`SELECT * FROM status_reports WHERE date = ? ORDER BY created_at ASC`)
    .all(date) as StatusReportRow[];
  return rows.map(rowToReport);
}

export interface UpsertStatusReportRecord {
  projectId: string;
  date: string; // YYYY-MM-DD
  summary: string;
  commitCount: number;
  prsMerged: number;
  tasksCompleted: number;
}

/** Insert or replace the cached report for (project, date). */
export function upsertStatusReport(record: UpsertStatusReportRecord): ProjectStatusReport {
  const existing = getStatusReport(record.projectId, record.date);
  if (existing) {
    getDb()
      .prepare(
        `UPDATE status_reports
         SET summary = ?, commit_count = ?, prs_merged = ?, tasks_completed = ?
         WHERE id = ?`,
      )
      .run(record.summary, record.commitCount, record.prsMerged, record.tasksCompleted, existing.id);
    return {
      ...existing,
      summary: record.summary,
      commitCount: record.commitCount,
      prsMerged: record.prsMerged,
      tasksCompleted: record.tasksCompleted,
    };
  }
  const report: ProjectStatusReport = {
    id: ulid(),
    projectId: record.projectId,
    date: record.date,
    summary: record.summary,
    commitCount: record.commitCount,
    prsMerged: record.prsMerged,
    tasksCompleted: record.tasksCompleted,
    createdAt: nowIso(),
  };
  getDb()
    .prepare(
      `INSERT INTO status_reports (id, project_id, date, summary, commit_count, prs_merged, tasks_completed, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      report.id,
      report.projectId,
      report.date,
      report.summary,
      report.commitCount,
      report.prsMerged,
      report.tasksCompleted,
      report.createdAt,
    );
  return report;
}
