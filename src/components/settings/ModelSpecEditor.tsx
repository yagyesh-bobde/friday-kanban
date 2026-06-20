"use client";

/**
 * Provider / model / effort triple-select. Shared by the settings view
 * (column defaults) and the New Task modal (per-task overrides). Free-form
 * model entry via datalist; the lists are just verified current slugs.
 */

import type { Effort, ModelSpec, Provider } from "@/lib/types";
import { Select } from "@/components/ui/fields";
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
