"use client";

/**
 * Add Project modal. Instead of typing a path, you browse to a folder with the
 * picker. Friday detects the shape:
 *  - the folder is itself a git repo  → single-repo project
 *  - the folder contains git repos    → multi-repo project (parent folder +
 *    sub-repos, auto-detected and individually toggleable)
 * The base branch is detected per-repo on the server when left blank.
 */

import { useMemo, useState } from "react";
import type { Execution, FsBrowseResult } from "@/lib/types";
import { useBoard } from "@/store/board";
import { useUi } from "@/store/ui";
import { ApiHttpError } from "@/store/api";
import { Modal } from "@/components/ui/Modal";
import { Button, Field, Input, Segmented } from "@/components/ui/fields";
import { DirectoryPicker } from "@/components/ui/DirectoryPicker";
import { IconBranch, IconCheck, IconFolder } from "@/components/ui/icons";
import { cn } from "@/components/util";

type Mode = "single" | "multi";

function basename(p: string): string {
  return p.replace(/\/+$/, "").split("/").pop() ?? "";
}

export function AddProjectModal() {
  const open = useUi((s) => s.addProjectOpen);
  const close = useUi((s) => s.closeAddProject);
  const toast = useUi((s) => s.toast);
  const createProject = useBoard((s) => s.createProject);

  const [browse, setBrowse] = useState<FsBrowseResult | null>(null);
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [baseBranch, setBaseBranch] = useState("");
  const [defaultExecution, setDefaultExecution] = useState<Execution>("local");
  const [mode, setMode] = useState<Mode>("single");
  const [modeTouched, setModeTouched] = useState(false);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  // Re-mount the picker (and reset state) each time the modal opens so it
  // always starts fresh at the home directory.
  const pickerKey = open ? "open" : "closed";

  const currentPath = browse?.path ?? "";
  const currentIsRepo = browse?.isGitRepo ?? false;
  const subRepos = useMemo(
    () => browse?.entries.filter((e) => e.isGitRepo) ?? [],
    [browse],
  );

  const autoMode: Mode = currentIsRepo ? "single" : subRepos.length > 0 ? "multi" : "single";
  const effectiveMode: Mode = modeTouched ? mode : autoMode;

  const selectedRepos = useMemo(
    () => subRepos.filter((r) => !excluded.has(r.path)),
    [subRepos, excluded],
  );

  const onResult = (res: FsBrowseResult) => {
    setBrowse(res);
    setExcluded(new Set());
    if (!nameTouched) {
      const seg = basename(res.path);
      if (seg) setName(seg);
    }
  };

  const reset = () => {
    setBrowse(null);
    setName("");
    setNameTouched(false);
    setBaseBranch("");
    setDefaultExecution("local");
    setMode("single");
    setModeTouched(false);
    setExcluded(new Set());
    setSubmitting(false);
  };

  const onClose = () => {
    reset();
    close();
  };

  const canSubmit =
    name.trim() !== "" &&
    (effectiveMode === "single" ? currentIsRepo : selectedRepos.length > 0);

  const submit = async () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    try {
      if (effectiveMode === "multi") {
        const project = await createProject({
          name: name.trim(),
          path: currentPath,
          repos: selectedRepos.map((r) => ({ name: r.name, path: r.path })),
        });
        toast(
          "success",
          "Project added",
          `${project.name} · ${project.repos?.length ?? 0} repos`,
        );
      } else {
        const project = await createProject({
          name: name.trim(),
          path: currentPath,
          ...(baseBranch.trim() ? { baseBranch: baseBranch.trim() } : {}),
          defaultExecution,
        });
        toast("success", "Project added", `${project.name} · base branch ${project.baseBranch}`);
      }
      onClose();
    } catch (err) {
      toast(
        "error",
        "Could not add project",
        err instanceof ApiHttpError ? err.friendly : String(err),
      );
    } finally {
      setSubmitting(false);
    }
  };

  const toggleRepo = (path: string) => {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add project"
      subtitle="Browse to a git repo — or a folder of repos for a multi-repo project."
      width="max-w-xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!canSubmit} loading={submitting} onClick={submit}>
            Add project
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Location" hint="browse to the repo or parent folder">
          <DirectoryPicker key={pickerKey} onResult={onResult} />
        </Field>

        {/* shape: single repo vs multi-repo */}
        <div className="flex items-center justify-between">
          <Segmented
            value={effectiveMode}
            onChange={(m) => {
              setMode(m);
              setModeTouched(true);
            }}
            options={[
              { value: "single", label: "Single repo" },
              { value: "multi", label: "Multi-repo" },
            ]}
          />
          <span className="text-[11px] text-faint">
            {effectiveMode === "single"
              ? currentIsRepo
                ? "✓ this folder is a git repo"
                : "open a git repo folder"
              : `${selectedRepos.length}/${subRepos.length} repos selected`}
          </span>
        </div>

        {effectiveMode === "multi" ? (
          <Field
            label="Repos in this folder"
            hint="auto-detected · uncheck to exclude"
          >
            {subRepos.length === 0 ? (
              <p className="rounded-md border border-edge bg-raised px-3 py-3 text-[11px] text-faint">
                No git repos found here. Navigate to the folder that contains your repos.
              </p>
            ) : (
              <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-edge bg-raised p-1.5">
                {subRepos.map((r) => {
                  const checked = !excluded.has(r.path);
                  return (
                    <button
                      key={r.path}
                      type="button"
                      onClick={() => toggleRepo(r.path)}
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-hover"
                    >
                      <span
                        className={cn(
                          "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                          checked
                            ? "border-ember bg-ember/15 text-ember"
                            : "border-edge text-transparent",
                        )}
                      >
                        <IconCheck size={11} />
                      </span>
                      <IconFolder size={13} className="shrink-0 text-faint" />
                      <span className="shrink-0 text-[12px] font-medium text-ink">{r.name}</span>
                      <span className="min-w-0 flex-1 truncate text-right font-mono text-[10.5px] text-faint">
                        {r.path}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </Field>
        ) : null}

        <Field label="Name">
          <Input
            placeholder="my-project"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setNameTouched(true);
            }}
          />
        </Field>

        {effectiveMode === "single" ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Base branch" hint="blank = auto-detect">
              <Input
                placeholder="auto-detect (e.g. main)"
                value={baseBranch}
                onChange={(e) => setBaseBranch(e.target.value)}
                className="font-mono text-[12px]"
              />
            </Field>
            <Field label="Default execution">
              <Segmented
                value={defaultExecution}
                onChange={setDefaultExecution}
                options={[
                  { value: "local", label: "Local" },
                  { value: "cloud", label: "Cloud" },
                ]}
              />
            </Field>
          </div>
        ) : (
          <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-faint">
            <IconBranch size={12} className="mt-0.5 shrink-0 text-mute" />
            Each repo&apos;s base branch is auto-detected on the server. The agent runs from the
            parent folder so it sees every repo; commits, branches and PRs are handled per-repo.
            Multi-repo projects run locally (cloud isn&apos;t supported).
          </p>
        )}
      </div>
    </Modal>
  );
}
