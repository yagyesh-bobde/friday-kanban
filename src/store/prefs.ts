/**
 * Per-user client preferences, persisted to localStorage.
 *
 * Deliberately separate from the board/ui stores: these are local-only settings
 * that never hit the server and shouldn't ride along with SSE churn or modal
 * state. Holds cosmetic toggles (fire vibes) plus per-browser feature-flag
 * overrides (see src/lib/featureFlags.ts for the flag registry).
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";

interface PrefsStore {
  /** Render the full-width fire lottie at the bottom of the screen. */
  fireVibes: boolean;
  setFireVibes: (on: boolean) => void;

  /** When true, fire vibes are switched on automatically on app init. */
  autoFireVibes: boolean;
  setAutoFireVibes: (on: boolean) => void;

  /**
   * Per-flag overrides keyed by FeatureFlag id. A missing key means "use the
   * flag's registry default"; resolve through `useFeatureFlag` rather than
   * reading this map directly.
   */
  featureFlags: Record<string, boolean>;
  setFeatureFlag: (id: string, on: boolean) => void;
  resetFeatureFlag: (id: string) => void;
}

export const usePrefs = create<PrefsStore>()(
  persist(
    (set) => ({
      fireVibes: false,
      setFireVibes: (on) => set({ fireVibes: on }),

      autoFireVibes: false,
      setAutoFireVibes: (on) => set({ autoFireVibes: on }),

      featureFlags: {},
      setFeatureFlag: (id, on) =>
        set((s) => ({ featureFlags: { ...s.featureFlags, [id]: on } })),
      resetFeatureFlag: (id) =>
        set((s) => {
          const next = { ...s.featureFlags };
          delete next[id];
          return { featureFlags: next };
        }),
    }),
    { name: "friday-prefs" },
  ),
);
