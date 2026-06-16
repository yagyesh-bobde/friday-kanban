"use client";

import { useUi } from "@/store/ui";
import { cn } from "@/components/util";
import { IconAlert, IconCheck, IconSpark, IconX } from "./icons";

export function Toasts() {
  const toasts = useUi((s) => s.toasts);
  const dismiss = useUi((s) => s.dismissToast);
  const openDrawer = useUi((s) => s.openDrawer);

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-12 right-4 z-[60] flex w-80 flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            "pointer-events-auto animate-toast-in rounded-lg border bg-overlay/95 p-3 shadow-[0_12px_40px_rgba(0,0,0,0.5)] backdrop-blur",
            t.kind === "error" ? "border-danger/40" : t.kind === "success" ? "border-ok/30" : "border-edge-bright",
            t.taskId && "cursor-pointer hover:border-ember-dim",
          )}
          onClick={() => {
            if (t.taskId) {
              openDrawer(t.taskId);
              dismiss(t.id);
            }
          }}
        >
          <div className="flex items-start gap-2.5">
            <span
              className={cn(
                "mt-0.5 shrink-0",
                t.kind === "error" ? "text-danger" : t.kind === "success" ? "text-ok" : "text-ember",
              )}
            >
              {t.kind === "error" ? (
                <IconAlert size={14} />
              ) : t.kind === "success" ? (
                <IconCheck size={14} />
              ) : (
                <IconSpark size={14} />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium leading-snug">{t.title}</p>
              {t.message ? (
                <p className="mt-0.5 break-words text-xs leading-snug text-mute">{t.message}</p>
              ) : null}
            </div>
            <button
              className="shrink-0 text-faint hover:text-ink"
              onClick={(e) => {
                e.stopPropagation();
                dismiss(t.id);
              }}
              aria-label="Dismiss"
            >
              <IconX size={12} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
