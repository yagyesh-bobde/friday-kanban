"use client";

/**
 * Layout primitives shared by every settings section, so sections stay terse
 * and visually consistent: a titled card (SettingsGroup) holding rows
 * (SettingsRow) of a label + description on the left and a control on the right.
 */

import type { ReactNode } from "react";
import { cn } from "@/components/util";

export function SettingsGroup({
  title,
  description,
  children,
  className,
}: {
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-lg border border-edge bg-panel/60", className)}>
      {title || description ? (
        <header className="border-b border-edge px-4 py-3">
          {title ? (
            <h3 className="text-[13px] font-semibold tracking-tight text-ink">{title}</h3>
          ) : null}
          {description ? (
            <p className="mt-0.5 text-[12px] leading-relaxed text-faint">{description}</p>
          ) : null}
        </header>
      ) : null}
      <div className="divide-y divide-edge">{children}</div>
    </section>
  );
}

export function SettingsRow({
  label,
  description,
  control,
  /** Stack the control under the label instead of to its right (wide controls). */
  stacked,
}: {
  label: ReactNode;
  description?: ReactNode;
  control: ReactNode;
  stacked?: boolean;
}) {
  return (
    <div
      className={cn(
        "px-4 py-3.5",
        stacked
          ? "space-y-2.5"
          : "flex items-center justify-between gap-6",
      )}
    >
      <div className="min-w-0">
        <p className="text-[12.5px] font-medium text-ink">{label}</p>
        {description ? (
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-faint">{description}</p>
        ) : null}
      </div>
      <div className={cn(stacked ? "" : "shrink-0")}>{control}</div>
    </div>
  );
}
