"use client";

/**
 * Appearance settings: cosmetic, per-browser toggles persisted to localStorage
 * via the prefs store. Applies instantly — no Save button.
 */

import { usePrefs } from "@/store/prefs";
import { Toggle } from "@/components/ui/fields";
import { SettingsGroup, SettingsRow } from "@/components/settings/primitives";

export function AppearanceSection() {
  const fireVibes = usePrefs((s) => s.fireVibes);
  const setFireVibes = usePrefs((s) => s.setFireVibes);
  const autoFireVibes = usePrefs((s) => s.autoFireVibes);
  const setAutoFireVibes = usePrefs((s) => s.setAutoFireVibes);

  return (
    <div className="space-y-5">
      <SettingsGroup
        title="Vibes"
        description="Cosmetic flourishes, saved per browser."
      >
        <SettingsRow
          label="🔥 Fire vibes"
          description="Full-width flames along the bottom edge of the board."
          control={
            <Toggle checked={fireVibes} onChange={setFireVibes} label="Fire vibes" />
          }
        />
        <SettingsRow
          label="Auto-enable fire vibes"
          description="Turn fire vibes on automatically every time the app loads."
          control={
            <Toggle
              checked={autoFireVibes}
              onChange={setAutoFireVibes}
              label="Auto-enable fire vibes"
            />
          }
        />
      </SettingsGroup>
    </div>
  );
}
