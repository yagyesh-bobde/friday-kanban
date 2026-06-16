"use client";

/**
 * Add Project modal — name + absolute local path (+ optional base branch;
 * the server detects the repo's default branch when left blank). The detected
 * branch is surfaced in the success toast since detection happens at create
 * time on the server.
 */

import { useEffect, useState } from "react";
import type { Execution } from "@/lib/types";
import { useBoard } from "@/store/board";
import { useUi } from "@/store/ui";
import { ApiHttpError } from "@/store/api";
import { Modal } from "@/components/ui/Modal";
import { Button, Field, Input, Segmented } from "@/components/ui/fields";

export function AddProjectModal() {
  const open = useUi((s) => s.addProjectOpen);
  const close = useUi((s) => s.closeAddProject);
  const toast = useUi((s) => s.toast);
  const createProject = useBoard((s) => s.createProject);

  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [baseBranch, setBaseBranch] = useState("");
  const [defaultExecution, setDefaultExecution] = useState<Execution>("local");
  const [submitting, setSubmitting] = useState(false);
  const [pathTouched, setPathTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName("");
    setPath("");
    setBaseBranch("");
    setDefaultExecution("local");
    setSubmitting(false);
    setPathTouched(false);
  }, [open]);

  // derive a name suggestion from the path's last segment on blur
  const onPathBlur = () => {
    setPathTouched(true);
    if (!name.trim() && path.trim()) {
      const seg = path.trim().replace(/\/+$/, "").split("/").pop();
      if (seg) setName(seg);
    }
  };

  const pathLooksValid = path.trim().startsWith("/");
  const canSubmit = name.trim() !== "" && pathLooksValid;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const project = await createProject({
        name: name.trim(),
        path: path.trim().replace(/\/+$/, ""),
        ...(baseBranch.trim() ? { baseBranch: baseBranch.trim() } : {}),
        defaultExecution,
      });
      toast(
        "success",
        "Project added",
        `${project.name} · base branch ${project.baseBranch}`,
      );
      close();
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

  return (
    <Modal
      open={open}
      onClose={close}
      title="Add project"
      subtitle="Register a local git repo so tasks can run against it."
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!canSubmit} loading={submitting} onClick={submit}>
            Add project
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Local path" hint="absolute path to the repo root">
          <Input
            autoFocus
            placeholder="/Users/you/code/my-repo"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            onBlur={onPathBlur}
            className="font-mono text-[12px]"
          />
          {pathTouched && path.trim() !== "" && !pathLooksValid ? (
            <p className="mt-1 text-[11px] text-danger">Path must be absolute (start with /)</p>
          ) : null}
        </Field>

        <Field label="Name">
          <Input
            placeholder="my-repo"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>

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

        <p className="text-[11px] leading-relaxed text-faint">
          The repo&apos;s default branch is detected on the server when the project is
          registered; it shows in the confirmation and is used as the default target for
          new tasks.
        </p>
      </div>
    </Modal>
  );
}
