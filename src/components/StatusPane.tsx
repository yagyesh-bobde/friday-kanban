"use client";

/**
 * Morning status pane — collapsed bar at the bottom of the board. Expanding
 * triggers GET /api/status-reports (generated on first board load of the day,
 * cached per project+date in SQLite). Skeleton while the haiku summarizer
 * runs; live updates arrive via status_report_ready board events.
 */

import { useEffect } from "react";
import { useBoard } from "@/store/board";
import { useUi } from "@/store/ui";
import { cn, projectColor, todayLabel } from "@/components/util";
import { Markdown } from "@/components/ui/Markdown";
import {
  IconChevronDown,
  IconChevronRight,
  IconCommit,
  IconPullRequest,
  IconCheck,
  IconSpark,
} from "@/components/ui/icons";

function Skeleton() {
  return (
    <div className="space-y-4 p-4">
      {[0, 1].map((i) => (
        <div key={i} className="space-y-2" style={{ animationDelay: `${i * 120}ms` }}>
          <div className="skeleton h-4 w-40 rounded" />
          <div className="skeleton h-3 w-full rounded" />
          <div className="skeleton h-3 w-3/4 rounded" />
        </div>
      ))}
      <p className="font-mono text-[10.5px] text-faint">
        haiku is summarizing yesterday&apos;s work…
      </p>
    </div>
  );
}

export function StatusPane() {
  const open = useUi((s) => s.statusPaneOpen);
  const toggle = useUi((s) => s.toggleStatusPane);
  const projects = useBoard((s) => s.projects);
  const reports = useBoard((s) => s.statusReports);
  const loading = useBoard((s) => s.statusReportsLoading);
  const error = useBoard((s) => s.statusReportsError);
  const load = useBoard((s) => s.loadStatusReports);

  // first expand of the session triggers generation
  useEffect(() => {
    if (open && reports === null && !loading && !error) void load();
  }, [open, reports, loading, error, load]);

  const projectById = new Map(projects.map((p) => [p.id, p]));

  return (
    <footer className="shrink-0 border-t border-edge bg-panel/90 backdrop-blur">
      <button
        onClick={toggle}
        className="flex w-full items-center gap-2.5 px-4 py-2 text-left transition-colors hover:bg-raised/60"
      >
        {open ? (
          <IconChevronDown size={12} className="text-faint" />
        ) : (
          <IconChevronRight size={12} className="text-faint" />
        )}
        <IconSpark size={12} className="text-ember" />
        <span className="text-[12px] font-semibold tracking-tight">Daily status</span>
        <span className="font-mono text-[10.5px] text-faint" suppressHydrationWarning>
          {todayLabel()}
        </span>
        <span className="flex-1" />
        {reports !== null ? (
          <span className="font-mono text-[10px] text-faint">
            {reports.length} report{reports.length === 1 ? "" : "s"}
          </span>
        ) : (
          <span className="font-mono text-[10px] text-faint">expand to generate</span>
        )}
      </button>

      {open ? (
        <div className="animate-pane-up max-h-[38vh] overflow-y-auto border-t border-edge">
          {loading ? (
            <Skeleton />
          ) : error ? (
            <div className="p-4">
              <p className="font-mono text-[11px] text-danger">{error}</p>
              <button
                onClick={() => void load()}
                className="mt-2 rounded-md border border-edge px-2.5 py-1 text-[11px] text-mute hover:border-edge-bright hover:text-ink"
              >
                Retry
              </button>
            </div>
          ) : reports === null || reports.length === 0 ? (
            <p className="p-4 font-mono text-[11px] text-faint">
              Nothing to report — no commits or task activity since yesterday.
            </p>
          ) : (
            <div className="divide-y divide-edge">
              {reports.map((report) => {
                const project = projectById.get(report.projectId);
                return (
                  <article key={report.id} className="px-4 py-3">
                    <header className="mb-1.5 flex flex-wrap items-center gap-3">
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          className="h-1.5 w-1.5 rounded-full"
                          style={{
                            background: project ? projectColor(project.id) : "var(--color-faint)",
                          }}
                        />
                        <span className="text-[12.5px] font-semibold tracking-tight">
                          {project?.name ?? report.projectId}
                        </span>
                      </span>
                      <span className="flex flex-wrap items-center gap-3 font-mono text-[10px] text-faint">
                        <span className="inline-flex items-center gap-1">
                          <IconCommit size={10} />
                          {report.commitCount} commit{report.commitCount === 1 ? "" : "s"}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <IconPullRequest size={10} />
                          {report.prsMerged} merged
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <IconCheck size={10} />
                          {report.tasksCompleted} task{report.tasksCompleted === 1 ? "" : "s"} done
                        </span>
                      </span>
                    </header>
                    <div
                      className={cn(
                        "text-[12.5px] text-mute",
                        report.summary.trim() === "" && "italic text-faint",
                      )}
                    >
                      {report.summary.trim() === "" ? (
                        "No summary."
                      ) : (
                        <Markdown text={report.summary} />
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      ) : null}
    </footer>
  );
}
