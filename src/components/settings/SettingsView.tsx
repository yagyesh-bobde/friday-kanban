"use client";

/**
 * Full-page settings view (Cmd+P / Ctrl+P). A fixed overlay above the board
 * with its own top bar, a section nav on the left and the active section's
 * panel on the right. Sections are data-driven (settings/registry.tsx) so the
 * view scales as new configuration areas are added.
 */

import { useEffect } from "react";
import { useUi } from "@/store/ui";
import { cn } from "@/components/util";
import { IconArrowLeft, IconSpark, IconX } from "@/components/ui/icons";
import {
  DEFAULT_SECTION_ID,
  SETTINGS_SECTIONS,
} from "./registry";

export function SettingsView() {
  const open = useUi((s) => s.settingsOpen);
  const close = useUi((s) => s.closeSettings);
  const activeId = useUi((s) => s.settingsSection);
  const setSection = useUi((s) => s.setSettingsSection);

  // Esc closes — scoped to while the view is open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  if (!open) return null;

  const active =
    SETTINGS_SECTIONS.find((s) => s.id === activeId) ??
    SETTINGS_SECTIONS.find((s) => s.id === DEFAULT_SECTION_ID)!;
  const ActiveComponent = active.Component;

  return (
    <div className="animate-fade-up fixed inset-0 z-50 flex flex-col bg-bg/95 backdrop-blur-sm">
      {/* top bar */}
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-edge bg-panel/80 px-4 backdrop-blur">
        <button
          onClick={close}
          className="inline-flex items-center gap-1.5 rounded-md border border-edge px-2 py-1.5 text-[12px] font-medium text-mute transition-colors hover:border-edge-bright hover:text-ink"
          title="Back to board (Esc)"
        >
          <IconArrowLeft size={13} />
          Board
        </button>
        <div className="mx-1 h-5 w-px bg-edge" />
        <div className="flex items-center gap-2">
          <IconSpark size={14} className="text-ember" />
          <h1 className="text-[14px] font-semibold tracking-tight">Settings</h1>
        </div>
        <span className="flex-1" />
        <kbd>esc</kbd>
        <button
          onClick={close}
          className="rounded-md border border-edge p-[7px] text-mute transition-colors hover:border-edge-bright hover:text-ink"
          aria-label="Close settings"
        >
          <IconX size={14} />
        </button>
      </header>

      {/* body: nav + panel */}
      <div className="flex min-h-0 flex-1">
        <nav className="w-60 shrink-0 overflow-y-auto border-r border-edge bg-panel/40 p-2.5">
          {SETTINGS_SECTIONS.map((section) => {
            const isActive = section.id === active.id;
            const Icon = section.Icon;
            return (
              <button
                key={section.id}
                onClick={() => setSection(section.id)}
                className={cn(
                  "mb-0.5 flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors",
                  isActive
                    ? "bg-overlay text-ink shadow-[inset_0_0_0_1px_var(--color-edge-bright)]"
                    : "text-mute hover:bg-raised hover:text-ink",
                )}
              >
                <Icon
                  size={15}
                  className={cn("mt-px shrink-0", isActive ? "text-ember" : "text-faint")}
                />
                <span className="min-w-0">
                  <span className="block text-[12.5px] font-medium leading-tight">
                    {section.label}
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-faint">
                    {section.summary}
                  </span>
                </span>
              </button>
            );
          })}
        </nav>

        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl px-6 py-7">
            <div className="mb-5">
              <h2 className="text-[17px] font-semibold tracking-tight">{active.label}</h2>
              <p className="mt-0.5 text-[12.5px] text-mute">{active.summary}</p>
            </div>
            <ActiveComponent />
          </div>
        </main>
      </div>
    </div>
  );
}
