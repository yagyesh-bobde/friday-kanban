/**
 * Per-user cosmetic preferences, persisted to localStorage.
 *
 * Deliberately separate from the board/ui stores: these are local-only vibes
 * that never hit the server and shouldn't ride along with SSE churn or modal
 * state. Currently just the fire animation toggle.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";

interface PrefsStore {
  /** Render the full-width fire lottie at the bottom of the screen. */
  fireVibes: boolean;
  setFireVibes: (on: boolean) => void;
}

export const usePrefs = create<PrefsStore>()(
  persist(
    (set) => ({
      fireVibes: false,
      setFireVibes: (on) => set({ fireVibes: on }),
    }),
    { name: "friday-prefs" },
  ),
);
