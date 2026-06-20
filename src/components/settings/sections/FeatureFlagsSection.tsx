"use client";

/**
 * Feature flags: per-browser experimental toggles, rendered from the
 * src/lib/featureFlags.ts registry. Each flag shows its effective value
 * (override or default) and whether it's been overridden. Adding a flag to the
 * registry surfaces it here automatically — no edits to this file needed.
 */

import { FEATURE_FLAGS } from "@/lib/featureFlags";
import { usePrefs } from "@/store/prefs";
import { Toggle } from "@/components/ui/fields";
import { SettingsGroup, SettingsRow } from "@/components/settings/primitives";

export function FeatureFlagsSection() {
  const overrides = usePrefs((s) => s.featureFlags);
  const setFeatureFlag = usePrefs((s) => s.setFeatureFlag);
  const resetFeatureFlag = usePrefs((s) => s.resetFeatureFlag);

  if (FEATURE_FLAGS.length === 0) {
    return (
      <SettingsGroup>
        <div className="px-4 py-10 text-center">
          <p className="text-[13px] font-medium text-ink">No experimental features</p>
          <p className="mt-1 text-[12px] text-faint">
            New preview features will show up here when they land.
          </p>
        </div>
      </SettingsGroup>
    );
  }

  return (
    <div className="space-y-5">
      <SettingsGroup
        title="Experimental"
        description="Preview features, toggled per browser. Defaults may change between releases."
      >
        {FEATURE_FLAGS.map((flag) => {
          const override = overrides[flag.id];
          const overridden = override !== undefined;
          const value = overridden ? override : flag.defaultValue;
          return (
            <SettingsRow
              key={flag.id}
              label={
                <span className="inline-flex items-center gap-2">
                  {flag.label}
                  {overridden ? (
                    <button
                      type="button"
                      onClick={() => resetFeatureFlag(flag.id)}
                      className="rounded border border-edge px-1.5 py-px text-[10px] font-normal text-faint transition-colors hover:border-edge-bright hover:text-mute"
                      title="Reset to default"
                    >
                      modified · reset
                    </button>
                  ) : null}
                </span>
              }
              description={flag.description}
              control={
                <Toggle
                  checked={value}
                  onChange={(on) => setFeatureFlag(flag.id, on)}
                  label={flag.label}
                />
              }
            />
          );
        })}
      </SettingsGroup>
    </div>
  );
}
