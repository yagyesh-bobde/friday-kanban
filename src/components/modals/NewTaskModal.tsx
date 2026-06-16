"use client";

/**
 * New Task modal — full power: project, branch (live from
 * GET /api/projects/[id]/branches, with create-new-branch), title, prompt,
 * context path chips, workspace mode, local/cloud execution, and per-stage
 * model overrides (collapsed under "Models", prefilled from column defaults).
 */

import { useEffect, useMemo, useState } from "react";
import type {
  AgentColumn,
  CreateTaskInput,
  Execution,
  ModelSpec,
  WorkspaceMode,
} from "@/lib/types";
import { useBoard } from "@/store/board";
import { useUi } from "@/store/ui";
import { api, ApiHttpError } from "@/store/api";
import { Modal } from "@/components/ui/Modal";
import { Button, Field, Input, Segmented, Select, Textarea } from "@/components/ui/fields";
import { ChipsInput } from "@/components/ui/ChipsInput";
import { IconChevronDown, IconChevronRight, Spinner } from "@/components/ui/icons";
import { ModelSpecEditor } from "@/components/settings/SettingsPopover";
import { cn } from "@/components/util";

const NEW_BRANCH = "__new__";

const WORKSPACE_OPTIONS: { value: WorkspaceMode; label: string; hint: string }[] = [
  {
    value: "branch",
    label: "Branch (default)",
    hint: "Work directly in the checkout on the selected branch — commits stack; same-branch tasks queue FIFO.",
  },
  {
    value: "worktree",
    label: "Worktree",
    hint: "Isolated git worktree under ~/.friday-kanban/worktrees on a friday/<name> branch — parallel-safe.",
  },
  {
    value: "new-branch",
    label: "New branch",
    hint: "Create a fresh branch in the main checkout before starting.",
  },
];

function specsEqual(a: ModelSpec, b: ModelSpec): boolean {
  return a.provider === b.provider && a.model === b.model && a.effort === b.effort;
}

export function NewTaskModal() {
  const open = useUi((s) => s.newTaskOpen);
  const prefillProjectId = useUi((s) => s.newTaskProjectId);
  const close = useUi((s) => s.closeNewTask);
  const toast = useUi((s) => s.toast);
  const projects = useBoard((s) => s.projects);
  const config = useBoard((s) => s.config);
  const createTask = useBoard((s) => s.createTask);

  const [projectId, setProjectId] = useState("");
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [contextPaths, setContextPaths] = useState<string[]>([]);
  const [branchChoice, setBranchChoice] = useState<string>("");
  const [newBranchName, setNewBranchName] = useState("");
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("branch");
  const [execution, setExecution] = useState<Execution>("local");
  const [modelsOpen, setModelsOpen] = useState(false);
  const [specs, setSpecs] = useState<Record<AgentColumn, ModelSpec>>(config.columnDefaults);
  const [submitting, setSubmitting] = useState<false | "create" | "start">(false);

  const [branches, setBranches] = useState<string[] | null>(null);
  const [branchesError, setBranchesError] = useState<string | null>(null);

  const project = useMemo(
    () => projects.find((p) => p.id === projectId),
    [projects, projectId],
  );

  // reset when (re)opened
  useEffect(() => {
    if (!open) return;
    const initial = prefillProjectId ?? projects[0]?.id ?? "";
    setProjectId(initial);
    setTitle("");
    setPrompt("");
    setContextPaths([]);
    setNewBranchName("");
    setWorkspaceMode("branch");
    setModelsOpen(false);
    setSpecs(config.columnDefaults);
    setSubmitting(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // project change → execution default + branch list
  useEffect(() => {
    if (!open || !project) return;
    setExecution(project.defaultExecution);
    setBranchChoice(project.baseBranch);
    setBranches(null);
    setBranchesError(null);
    let live = true;
    api
      .branches(project.id)
      .then((res) => {
        if (!live) return;
        setBranches(res.branches);
        // default to the project baseBranch when present, else current
        setBranchChoice(
          res.branches.includes(project.baseBranch) ? project.baseBranch : res.current,
        );
      })
      .catch((err: unknown) => {
        if (!live) return;
        setBranchesError(
          err instanceof ApiHttpError ? err.friendly : "Could not list branches",
        );
        setBranches([]);
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, project?.id]);

  const effectiveBranch =
    branchChoice === NEW_BRANCH ? newBranchName.trim() : branchChoice;
  const canSubmit =
    !!project && title.trim() !== "" && prompt.trim() !== "" && effectiveBranch !== "";

  const submit = async (startNow: boolean) => {
    if (!canSubmit || !project || submitting) return;
    setSubmitting(startNow ? "start" : "create");

    const overrides: Partial<Record<AgentColumn, ModelSpec>> = {};
    if (modelsOpen) {
      for (const col of ["in_dev", "in_review"] as AgentColumn[]) {
        if (!specsEqual(specs[col], config.columnDefaults[col])) overrides[col] = specs[col];
      }
    }

    const input: CreateTaskInput = {
      projectId: project.id,
      title: title.trim(),
      prompt: prompt.trim(),
      ...(contextPaths.length > 0 ? { contextPaths } : {}),
      branch: effectiveBranch,
      workspaceMode,
      execution,
      ...(Object.keys(overrides).length > 0 ? { modelOverrides: overrides } : {}),
      ...(startNow ? { startNow: true } : {}),
    };

    try {
      await createTask(input);
      toast(
        "success",
        startNow ? "Task started" : "Task created",
        startNow ? `${title.trim()} → In Dev` : `${title.trim()} → Todo`,
      );
      close();
    } catch (err) {
      toast(
        "error",
        startNow ? "Could not start task" : "Could not create task",
        err instanceof ApiHttpError ? err.friendly : String(err),
      );
    } finally {
      setSubmitting(false);
    }
  };

  const workspaceHint = WORKSPACE_OPTIONS.find((w) => w.value === workspaceMode)?.hint;

  return (
    <Modal
      open={open}
      onClose={close}
      title="New task"
      subtitle="A card in Todo — the implementer starts on drag to In Dev (or via the auto scheduler)."
      width="max-w-2xl"
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button
            variant="subtle"
            disabled={!canSubmit || submitting === "start"}
            loading={submitting === "create"}
            onClick={() => submit(false)}
            title="Create the card in Todo — starts on drag to In Dev (or via the auto scheduler)"
          >
            Create task
          </Button>
          <Button
            variant="primary"
            disabled={!canSubmit || submitting === "create"}
            loading={submitting === "start"}
            onClick={() => submit(true)}
            title="Create the card and start the implementer right away (on demand)"
          >
            Create &amp; start
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {/* project + branch */}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Project">
            <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Branch"
            hint={
              branches === null && !branchesError ? (
                <span className="inline-flex items-center gap-1">
                  <Spinner size={10} /> loading
                </span>
              ) : undefined
            }
          >
            <div className="space-y-1.5">
              <Select
                value={branchChoice}
                onChange={(e) => {
                  const v = e.target.value;
                  setBranchChoice(v);
                  if (v === NEW_BRANCH && workspaceMode === "branch") {
                    setWorkspaceMode("new-branch");
                  }
                }}
              >
                {branches === null ? (
                  <option value={branchChoice}>{branchChoice || "…"}</option>
                ) : (
                  <>
                    {(branches.length > 0 ? branches : [project?.baseBranch ?? "main"]).map(
                      (b) => (
                        <option key={b} value={b}>
                          {b}
                          {b === project?.baseBranch ? "  (base)" : ""}
                        </option>
                      ),
                    )}
                  </>
                )}
                <option value={NEW_BRANCH}>+ New branch…</option>
              </Select>
              {branchChoice === NEW_BRANCH ? (
                <Input
                  autoFocus
                  placeholder="feat/my-branch"
                  value={newBranchName}
                  onChange={(e) => setNewBranchName(e.target.value)}
                  className="font-mono text-[12px]"
                />
              ) : null}
              {branchesError ? (
                <p className="text-[11px] text-danger">{branchesError}</p>
              ) : null}
            </div>
          </Field>
        </div>

        {/* title */}
        <Field label="Title">
          <Input
            placeholder="Short, imperative — shows on the card"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={140}
          />
        </Field>

        {/* prompt */}
        <Field label="Prompt" hint="sent verbatim to the implementer">
          <Textarea
            rows={6}
            placeholder={
              "What should the agent build? Be specific about scope, files, and the definition of done."
            }
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            className="font-mono text-[12px]"
          />
        </Field>

        {/* context paths */}
        <Field label="Context paths" hint="optional · relative to repo root · Enter to add">
          <ChipsInput
            value={contextPaths}
            onChange={setContextPaths}
            placeholder="src/lib/auth.ts, docs/spec.md …"
          />
        </Field>

        {/* workspace + execution */}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Workspace">
            <div className="space-y-1.5">
              <Select
                value={workspaceMode}
                onChange={(e) => setWorkspaceMode(e.target.value as WorkspaceMode)}
              >
                {WORKSPACE_OPTIONS.map((w) => (
                  <option key={w.value} value={w.value}>
                    {w.label}
                  </option>
                ))}
              </Select>
              <p className="text-[11px] leading-snug text-faint">{workspaceHint}</p>
            </div>
          </Field>
          <Field label="Execution">
            <div className="space-y-1.5">
              <Segmented
                value={execution}
                onChange={setExecution}
                options={[
                  { value: "local", label: "Local", title: "claude -p in the checkout" },
                  { value: "cloud", label: "Cloud", title: "claude --remote on Anthropic VMs" },
                ]}
              />
              <p className="text-[11px] leading-snug text-faint">
                {execution === "cloud"
                  ? "Runs remotely — pushes the branch first; results arrive as a remote branch/PR on GitHub."
                  : "Runs in the project checkout on this machine."}
              </p>
            </div>
          </Field>
        </div>

        {/* model overrides */}
        <div className="rounded-lg border border-edge">
          <button
            type="button"
            onClick={() => setModelsOpen((v) => !v)}
            className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
          >
            {modelsOpen ? (
              <IconChevronDown size={12} className="text-faint" />
            ) : (
              <IconChevronRight size={12} className="text-faint" />
            )}
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-mute">
              Models
            </span>
            <span className="font-mono text-[10.5px] text-faint">
              {modelsOpen
                ? "override per stage"
                : `defaults · dev ${config.columnDefaults.in_dev.model}·${config.columnDefaults.in_dev.effort} · review ${config.columnDefaults.in_review.model}·${config.columnDefaults.in_review.effort}`}
            </span>
          </button>
          <div className={cn("space-y-3 px-3 pb-3", !modelsOpen && "hidden")}>
            <Field label="In Dev — implementer">
              <ModelSpecEditor
                idPrefix="task-in-dev"
                value={specs.in_dev}
                onChange={(spec) => setSpecs((s) => ({ ...s, in_dev: spec }))}
              />
            </Field>
            <Field label="In Review — reviewer">
              <ModelSpecEditor
                idPrefix="task-in-review"
                value={specs.in_review}
                onChange={(spec) => setSpecs((s) => ({ ...s, in_review: spec }))}
              />
            </Field>
            <p className="text-[11px] text-faint">
              Only stages that differ from the column defaults are stored as overrides.
            </p>
          </div>
        </div>
      </div>
    </Modal>
  );
}
