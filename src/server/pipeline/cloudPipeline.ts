/**
 * Cloud task pipeline (execution === 'cloud'), kept strictly separate from
 * the local flow: the result is a remote branch + PR on GitHub (never merged
 * into the shared local branch), codex reviews `gh pr diff`, and feedback is
 * sent back as a new remote prompt. Bounded by config.maxReviewCycles like
 * the local loop.
 */

import { getConfig } from "@/server/db/config";
import { updateTask } from "@/server/db/tasks";
import {
  launchRemoteSession,
  pollForRemoteResult,
  sendRemoteFeedback,
  snapshotRemoteHeads,
} from "@/server/agents/cloudRunner";
import { ensureVerdictSchemaFile, runCodex } from "@/server/agents/codexRunner";
import { hasRemote, prDiff, prView, push } from "@/server/git";
import { notify } from "@/server/notify";
import { wasCanceled } from "./processRegistry";
import { requireTask, transition } from "./stateMachine";
import { renderFindingsMarkdown, requireProject, resolveModelSpec } from "./common";
import { buildReviewPrompt } from "./reviewer";

const FIX_POLL_TIMEOUT_MS = 60 * 60 * 1000; // 1h for the VM to push fixes

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Build the remote prompt: task prompt + context paths. */
function buildRemotePrompt(taskId: string): string {
  const task = requireTask(taskId);
  const parts: string[] = [task.prompt.trim()];
  if (task.contextPaths.length > 0) {
    parts.push(
      "",
      "Relevant files/directories for context (paths relative to the repo root):",
      ...task.contextPaths.map((p) => `- ${p}`),
    );
  }
  parts.push(
    "",
    "Work on a new branch, commit with clear messages, push, and open a pull request",
    "describing the change.",
  );
  return parts.join("\n");
}

function failCloud(
  taskId: string,
  title: string,
  message: string,
  event: "dev_failed" | "review_failed" | "error",
): void {
  transition(taskId, event, {
    payload: { message, cloud: true },
    update: { error: message },
  });
  notify("friday-kanban: cloud task failed", `${title}: ${message.slice(0, 180)}`, taskId);
}

/**
 * Run the full cloud pipeline for a task. Assumes the scheduler holds its
 * concurrency slot; no project-branch mutex is taken (the VM is the
 * isolation; only the initial push touches the local checkout).
 */
export async function runCloudPipeline(taskId: string): Promise<void> {
  let task = requireTask(taskId);
  const project = requireProject(task.projectId);
  const cwd = project.path;
  const config = getConfig();
  const devSpec = resolveModelSpec(task, "in_dev");
  const reviewSpec = resolveModelSpec(task, "in_review");

  task = transition(taskId, "dev_started", {
    payload: { cloud: true, spec: devSpec },
    update: { error: undefined },
  });

  // 1. Push the task branch first — the remote session seeds from GitHub.
  try {
    if (!(await hasRemote(cwd))) throw new Error("project has no git remote");
    await push(cwd, task.branch);
  } catch (err) {
    failCloud(taskId, task.title, `push before cloud launch failed: ${err instanceof Error ? err.message : String(err)}`, "dev_failed");
    return;
  }

  // 2. Launch the remote session and capture the cse_ id.
  const headsBefore = await snapshotRemoteHeads(cwd);
  const launch = await launchRemoteSession({
    taskId,
    prompt: buildRemotePrompt(taskId),
    cwd,
    spec: devSpec,
  });
  if (wasCanceled(taskId)) return;
  if (launch.failureReason && !launch.remoteSessionId) {
    failCloud(taskId, task.title, launch.failureReason, "dev_failed");
    return;
  }
  if (launch.remoteSessionId) {
    updateTask(taskId, { remoteSessionId: launch.remoteSessionId });
  }

  // 3. Poll GitHub for the resulting branch/PR.
  const polled = await pollForRemoteResult({
    cwd,
    headsBefore,
    shouldAbort: () => wasCanceled(taskId),
  });
  if (wasCanceled(taskId)) return;
  if (!polled.branch && !polled.prUrl) {
    failCloud(taskId, task.title, polled.failureReason ?? "cloud session produced no branch/PR", "dev_failed");
    return;
  }

  task = transition(taskId, "dev_completed", {
    payload: {
      cloud: true,
      remoteSessionId: launch.remoteSessionId,
      remoteBranch: polled.branch,
      prUrl: polled.prUrl,
    },
    update: { prUrl: polled.prUrl, error: undefined },
  });

  if (!polled.prUrl || polled.prNumber === undefined) {
    // Branch without a PR: surface for a human — review needs the PR diff.
    transition(taskId, "error", {
      payload: { cloud: true, message: "cloud session pushed a branch but opened no PR", branch: polled.branch },
      update: {
        error: `cloud session pushed branch ${polled.branch ?? "?"} but opened no PR`,
      },
    });
    notify("friday-kanban: needs attention", `${task.title}: cloud branch without PR`, taskId);
    return;
  }

  // 4. Review loop over `gh pr diff`.
  const prNumber = polled.prNumber;
  for (;;) {
    task = requireTask(taskId);
    if (wasCanceled(taskId)) return;
    const round = task.reviewCycle;

    let diff: string;
    try {
      diff = await prDiff(cwd, prNumber);
    } catch (err) {
      // Task is in_dev/idle here (post dev_completed) — use the generic error event.
      failCloud(taskId, task.title, `gh pr diff failed: ${err instanceof Error ? err.message : String(err)}`, "error");
      return;
    }

    task = transition(taskId, "review_started", {
      payload: { cloud: true, spec: reviewSpec, round, prNumber },
      update: { error: undefined },
    });

    const result = await runCodex({
      taskId,
      prompt: buildReviewPrompt(task, diff, round),
      cwd,
      spec: reviewSpec,
      resumeThreadId: task.codexThreadId,
      reviewCycle: round,
      outputSchemaPath: ensureVerdictSchemaFile(),
    });
    if (wasCanceled(taskId)) return;

    const threadId = result.threadId ?? task.codexThreadId;
    if (!result.verdict) {
      const message = result.failureReason ?? "cloud review run failed";
      transition(taskId, "review_failed", {
        payload: { cloud: true, runId: result.runId, message },
        update: { error: message, codexThreadId: threadId },
      });
      notify("friday-kanban: review failed", `${task.title}: ${message.slice(0, 180)}`, taskId);
      return;
    }

    const verdict = result.verdict;
    const blockers = verdict.findings.filter((f) => f.severity === "blocker");
    if (verdict.verdict === "approve" || blockers.length === 0) {
      transition(taskId, "review_approved", {
        payload: { cloud: true, runId: result.runId, verdict },
        update: { codexThreadId: threadId, reviewCycle: round + 1, error: undefined },
      });
      notify("friday-kanban: cloud task done", `${task.title} passed review — ${polled.prUrl}`, taskId);
      return;
    }

    const newCycle = round + 1;
    if (newCycle >= config.maxReviewCycles) {
      transition(taskId, "review_cap_exhausted", {
        payload: { cloud: true, runId: result.runId, verdict, rounds: newCycle },
        update: { codexThreadId: threadId, reviewCycle: newCycle },
      });
      notify(
        "friday-kanban: needs attention",
        `${task.title}: cloud review cap (${config.maxReviewCycles} rounds) exhausted`,
        taskId,
      );
      return;
    }

    task = transition(taskId, "review_changes_requested", {
      payload: { cloud: true, runId: result.runId, verdict, source: "codex" },
      update: { codexThreadId: threadId, reviewCycle: newCycle },
    });

    // 5. Feedback goes back as a new remote prompt; then wait for new commits.
    task = transition(taskId, "fix_started", {
      payload: { cloud: true, round: newCycle },
    });

    const headOidBefore = await prView(cwd, prNumber)
      .then((pr) => pr.headRefOid)
      .catch(() => undefined);

    const feedback = await sendRemoteFeedback({
      taskId,
      cwd,
      spec: devSpec,
      remoteSessionId: task.remoteSessionId,
      prUrl: polled.prUrl,
      branch: polled.branch,
      feedbackMarkdown: renderFindingsMarkdown(verdict),
    });
    if (wasCanceled(taskId)) return;
    if (feedback.failureReason && !feedback.remoteSessionId) {
      failCloud(taskId, task.title, `cloud fix launch failed: ${feedback.failureReason}`, "dev_failed");
      return;
    }

    // Wait until the PR head moves (the VM pushed fixes).
    const deadline = Date.now() + FIX_POLL_TIMEOUT_MS;
    let headMoved = false;
    while (Date.now() < deadline) {
      if (wasCanceled(taskId)) return;
      await sleep(30_000);
      const oid = await prView(cwd, prNumber)
        .then((pr) => pr.headRefOid)
        .catch(() => undefined);
      if (oid !== undefined && oid !== headOidBefore) {
        headMoved = true;
        break;
      }
    }
    if (!headMoved) {
      failCloud(taskId, task.title, "timed out waiting for the cloud session to push fixes", "dev_failed");
      return;
    }

    transition(taskId, "dev_completed", {
      payload: { cloud: true, round: newCycle, fixedPr: polled.prUrl },
    });
    // loop continues into the next review round against the updated PR
  }
}
