"use client";

/**
 * Settings popover (header gear): per-column default models + review cycle
 * cap. Saves via PUT /api/config.
 */

import { useRef, useState } from "react";
import type { AgentColumn, Effort, ModelSpec, Provider } from "@/lib/types";
import { useBoard } from "@/store/board";
import { useUi } from "@/store/ui";
import { useClickOutside } from "@/components/ui/useClickOutside";
import { Button, Field, Select, Stepper } from "@/components/ui/fields";
import { IconGear } from "@/components/ui/icons";
import { cn } from "@/components/util";
import {
  defaultModelFor,
  EFFORT_OPTIONS,
  MODEL_OPTIONS,
  PROVIDER_OPTIONS,
} from "@/components/modelOptions";

export function ModelSpecEditor({
  value,
  onChange,
  idPrefix,
}: {
  value: ModelSpec;
  onChange: (spec: ModelSpec) => void;
  idPrefix: string;
}) {
  const models = MODEL_OPTIONS[value.provider];
  const listId = `${idPrefix}-models`;
  return (
    <div className="grid grid-cols-3 gap-2">
      <Select
        value={value.provider}
        onChange={(e) => {
          const provider = e.target.value as Provider;
          onChange({ ...value, provider, model: defaultModelFor(provider) });
        }}
        aria-label="Provider"
      >
        {PROVIDER_OPTIONS.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
      </Select>
      <span className="relative block">
        <input
          list={listId}
          value={value.model}
          onChange={(e) => onChange({ ...value, model: e.target.value })}
          aria-label="Model"
          className="w-full rounded-md border border-edge bg-raised px-2.5 py-1.5 font-mono text-[12px] text-ink outline-none transition-colors focus:border-ember-dim focus:ring-1 focus:ring-ember/30"
        />
        <datalist id={listId}>
          {models.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </span>
      <Select
        value={value.effort}
        onChange={(e) => onChange({ ...value, effort: e.target.value as Effort })}
        aria-label="Effort"
      >
        {EFFORT_OPTIONS.map((ef) => (
          <option key={ef.value} value={ef.value}>
            {ef.label}
          </option>
        ))}
      </Select>
    </div>
  );
}

const COLUMN_TITLES: Record<AgentColumn, { title: string; sub: string }> = {
  in_dev: { title: "In Dev — implementer", sub: "claude -p, fix rounds resume the session" },
  in_review: { title: "In Review — reviewer", sub: "codex exec, read-only sandbox" },
};

export function SettingsPopover() {
  const config = useBoard((s) => s.config);
  const updateConfig = useBoard((s) => s.updateConfig);
  const toast = useUi((s) => s.toast);

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(config);
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpen(false), open);

  const toggle = () => {
    if (!open) setDraft(config); // re-seed from live config on open
    setOpen((v) => !v);
  };

  const save = async () => {
    setSaving(true);
    await updateConfig({
      columnDefaults: draft.columnDefaults,
      maxReviewCycles: draft.maxReviewCycles,
    });
    setSaving(false);
    setOpen(false);
    toast("success", "Defaults saved");
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={toggle}
        className={cn(
          "rounded-md border border-edge p-[7px] text-mute transition-colors hover:border-edge-bright hover:text-ink",
          open && "border-edge-bright text-ink",
        )}
        title="Column model defaults & review cap"
        aria-label="Settings"
      >
        <IconGear size={14} />
      </button>

      {open ? (
        <div className="animate-fade-up absolute right-0 top-full z-40 mt-1.5 w-[420px] rounded-lg border border-edge bg-overlay p-4 shadow-[0_16px_48px_rgba(0,0,0,0.55)]">
          <h3 className="mb-3 text-[13px] font-semibold tracking-tight">Defaults</h3>

          <div className="space-y-4">
            {(Object.keys(COLUMN_TITLES) as AgentColumn[]).map((col) => (
              <Field
                key={col}
                label={COLUMN_TITLES[col].title}
                hint={COLUMN_TITLES[col].sub}
              >
                <ModelSpecEditor
                  idPrefix={`settings-${col}`}
                  value={draft.columnDefaults[col]}
                  onChange={(spec) =>
                    setDraft((d) => ({
                      ...d,
                      columnDefaults: { ...d.columnDefaults, [col]: spec },
                    }))
                  }
                />
              </Field>
            ))}

            <div className="flex items-center justify-between border-t border-edge pt-3">
              <div>
                <p className="text-[12px] font-medium">Review cycle cap</p>
                <p className="text-[11px] text-faint">
                  After this many bounce rounds → needs attention
                </p>
              </div>
              <Stepper
                value={draft.maxReviewCycles}
                min={1}
                max={9}
                onChange={(v) => setDraft((d) => ({ ...d, maxReviewCycles: v }))}
              />
            </div>
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" loading={saving} onClick={save}>
              Save
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
