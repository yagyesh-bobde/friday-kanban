"use client";

/**
 * Agents & models settings: the default ModelSpec for each agent column
 * (implementer / reviewer) plus the review-cycle cap. Edited as a local draft
 * and persisted together via PUT /api/config on Save — model slugs are
 * free-text, so we don't want a request per keystroke.
 */

import { useEffect, useState } from "react";
import type { AgentColumn } from "@/lib/types";
import { useBoard } from "@/store/board";
import { useUi } from "@/store/ui";
import { Button, Field, Stepper } from "@/components/ui/fields";
import { ModelSpecEditor } from "@/components/settings/ModelSpecEditor";
import { SettingsGroup, SettingsRow } from "@/components/settings/primitives";

const COLUMN_TITLES: Record<AgentColumn, { title: string; sub: string }> = {
  in_dev: { title: "In Dev — implementer", sub: "claude -p, fix rounds resume the session" },
  in_review: { title: "In Review — reviewer", sub: "codex exec, read-only sandbox" },
};

export function AgentsSection() {
  const config = useBoard((s) => s.config);
  const updateConfig = useBoard((s) => s.updateConfig);
  const toast = useUi((s) => s.toast);

  const [draft, setDraft] = useState(config);
  const [saving, setSaving] = useState(false);

  // Re-seed when the live config changes (e.g. another tab / SSE) and we're clean.
  const dirty =
    JSON.stringify(draft.columnDefaults) !== JSON.stringify(config.columnDefaults) ||
    draft.maxReviewCycles !== config.maxReviewCycles;
  useEffect(() => {
    if (!dirty) setDraft(config);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

  const save = async () => {
    setSaving(true);
    await updateConfig({
      columnDefaults: draft.columnDefaults,
      maxReviewCycles: draft.maxReviewCycles,
    });
    setSaving(false);
    toast("success", "Defaults saved");
  };

  return (
    <div className="space-y-5">
      <SettingsGroup
        title="Default models"
        description="Used for new tasks unless a task sets a per-column override."
      >
        {(Object.keys(COLUMN_TITLES) as AgentColumn[]).map((col) => (
          <SettingsRow
            key={col}
            stacked
            label={COLUMN_TITLES[col].title}
            description={COLUMN_TITLES[col].sub}
            control={
              <Field label="provider · model · effort">
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
            }
          />
        ))}
      </SettingsGroup>

      <SettingsGroup title="Review loop">
        <SettingsRow
          label="Review cycle cap"
          description="After this many bounce rounds a task is flagged needs-attention."
          control={
            <Stepper
              value={draft.maxReviewCycles}
              min={1}
              max={9}
              onChange={(v) => setDraft((d) => ({ ...d, maxReviewCycles: v }))}
            />
          }
        />
      </SettingsGroup>

      <div className="flex items-center justify-end gap-2">
        {dirty ? (
          <Button variant="ghost" onClick={() => setDraft(config)}>
            Discard
          </Button>
        ) : null}
        <Button variant="primary" loading={saving} disabled={!dirty} onClick={save}>
          Save changes
        </Button>
      </div>
    </div>
  );
}
