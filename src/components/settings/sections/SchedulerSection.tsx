"use client";

/**
 * Scheduler settings: manual vs. auto draining of the Todo column and the
 * concurrency cap for auto mode. Discrete controls, so changes apply live via
 * PUT /api/config (same as the header control they mirror).
 */

import { useBoard } from "@/store/board";
import { Segmented, Stepper } from "@/components/ui/fields";
import { SettingsGroup, SettingsRow } from "@/components/settings/primitives";

export function SchedulerSection() {
  const config = useBoard((s) => s.config);
  const updateConfig = useBoard((s) => s.updateConfig);

  return (
    <div className="space-y-5">
      <SettingsGroup
        title="Scheduling"
        description="How tasks leave the Todo column and start running."
      >
        <SettingsRow
          label="Mode"
          description="Manual: drag Todo → In Dev to start. Auto: drain Todo up to the cap."
          control={
            <Segmented
              value={config.schedulerMode}
              onChange={(mode) => void updateConfig({ schedulerMode: mode })}
              options={[
                { value: "manual", label: "Manual" },
                { value: "auto", label: "Auto" },
              ]}
            />
          }
        />
        <SettingsRow
          label="Concurrency cap"
          description="Max tasks running at once when auto mode is on."
          control={
            <Stepper
              value={config.maxConcurrentTasks}
              min={1}
              max={20}
              onChange={(v) => void updateConfig({ maxConcurrentTasks: v })}
            />
          }
        />
      </SettingsGroup>
    </div>
  );
}
