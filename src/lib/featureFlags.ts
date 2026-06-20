/**
 * Feature-flag registry.
 *
 * Flags are per-browser experimental toggles, persisted in the prefs store
 * (localStorage). To add a flag: append an entry here, then read it anywhere
 * with `useFeatureFlag("<id>")`. The Settings → Feature flags section renders
 * this list automatically, so no UI wiring is needed per flag.
 *
 * Keep these to genuinely experimental / preview behaviour — durable product
 * config belongs in AppConfig (server) and cosmetic prefs in the prefs store.
 */

import { usePrefs } from "@/store/prefs";

export interface FeatureFlag {
  /** Stable id — used as the localStorage override key. Never rename. */
  id: string;
  label: string;
  description: string;
  /** Value used when the user hasn't set an explicit override. */
  defaultValue: boolean;
}

export const FEATURE_FLAGS: FeatureFlag[] = [
  {
    id: "keyboardHints",
    label: "Keyboard shortcut hints",
    description:
      "Show the ⌘K / ⌘P shortcut badges in the board header.",
    defaultValue: true,
  },
];

export const FEATURE_FLAGS_BY_ID: Record<string, FeatureFlag> = Object.fromEntries(
  FEATURE_FLAGS.map((f) => [f.id, f]),
);

/**
 * Resolve a flag's effective value: the user's override if set, else the
 * registry default. Reactive — components re-render when the override changes.
 */
export function useFeatureFlag(id: string): boolean {
  const override = usePrefs((s) => s.featureFlags[id]);
  if (override !== undefined) return override;
  return FEATURE_FLAGS_BY_ID[id]?.defaultValue ?? false;
}
