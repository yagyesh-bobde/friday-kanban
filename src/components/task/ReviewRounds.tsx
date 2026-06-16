"use client";

/**
 * Review-round history: one section per codex verdict (oldest first), with
 * severity-colored findings. Only `blocker` findings bounce a task — major /
 * minor ride along into the eventual PR body.
 */

import type { FindingSeverity, ReviewVerdict } from "@/lib/types";
import { cn } from "@/components/util";
import { Markdown } from "@/components/ui/Markdown";
import { IconAlert, IconCheck } from "@/components/ui/icons";

const SEVERITY_STYLE: Record<FindingSeverity, { row: string; chip: string }> = {
  blocker: {
    row: "border-danger/25 bg-danger/[0.06]",
    chip: "bg-danger/15 text-danger border-danger/30",
  },
  major: {
    row: "border-attention/20 bg-attention/[0.05]",
    chip: "bg-attention/15 text-attention border-attention/30",
  },
  minor: {
    row: "border-edge bg-raised/50",
    chip: "bg-overlay text-mute border-edge-bright",
  },
};

export function ReviewRounds({
  verdicts,
  maxReviewCycles,
}: {
  verdicts: ReviewVerdict[];
  maxReviewCycles: number;
}) {
  if (verdicts.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center">
        <p className="font-mono text-[11px] leading-relaxed text-faint">
          No review rounds yet.
          <br />
          Codex reviews the diff when the card reaches In Review.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 overflow-y-auto px-4 py-3">
      {verdicts.map((verdict, i) => {
        const approved = verdict.verdict === "approve";
        const blockers = verdict.findings.filter((f) => f.severity === "blocker").length;
        return (
          <section key={i} className="rounded-lg border border-edge bg-panel">
            <header className="flex items-center gap-2 border-b border-edge px-3 py-2">
              <span className="font-mono text-[10.5px] font-semibold text-review">
                R{i + 1}/{maxReviewCycles}
              </span>
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded border px-1.5 py-px font-mono text-[10px] font-medium uppercase tracking-wider",
                  approved
                    ? "border-ok/30 bg-ok/10 text-ok"
                    : "border-danger/30 bg-danger/10 text-danger",
                )}
              >
                {approved ? <IconCheck size={10} /> : <IconAlert size={10} />}
                {approved ? "approved" : "changes requested"}
              </span>
              <span className="flex-1" />
              {!approved && blockers > 0 ? (
                <span className="font-mono text-[10px] text-danger">
                  {blockers} blocker{blockers === 1 ? "" : "s"}
                </span>
              ) : null}
            </header>

            <div className="px-3 py-2.5">
              <div className="text-[12.5px] text-mute">
                <Markdown text={verdict.summary} />
              </div>

              {verdict.findings.length > 0 ? (
                <ul className="mt-2.5 space-y-1.5">
                  {verdict.findings.map((finding, j) => (
                    <li
                      key={j}
                      className={cn(
                        "rounded-md border px-2.5 py-2",
                        SEVERITY_STYLE[finding.severity].row,
                      )}
                    >
                      <div className="mb-1 flex items-center gap-2">
                        <span
                          className={cn(
                            "rounded border px-1 py-px font-mono text-[9px] font-semibold uppercase tracking-wider",
                            SEVERITY_STYLE[finding.severity].chip,
                          )}
                        >
                          {finding.severity}
                        </span>
                        <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-mute">
                          {finding.file}
                          {finding.line !== undefined ? (
                            <span className="text-faint">:{finding.line}</span>
                          ) : null}
                        </span>
                      </div>
                      <p className="text-[12px] leading-relaxed text-ink/90">
                        {finding.comment}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </section>
        );
      })}
    </div>
  );
}
