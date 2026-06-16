"use client";

/**
 * Form primitives shared by the modals + settings: Field wrapper, Input,
 * Textarea, Select, Segmented control, number Stepper, Button.
 */

import {
  forwardRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { cn } from "@/components/util";
import { IconChevronDown, Spinner } from "./icons";

// ---------------------------------------------------------------------------
// Field wrapper
// ---------------------------------------------------------------------------

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1.5 flex items-baseline justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-mute">
          {label}
        </span>
        {hint ? <span className="text-[11px] text-faint">{hint}</span> : null}
      </span>
      {children}
    </label>
  );
}

// ---------------------------------------------------------------------------
// Text input / textarea
// ---------------------------------------------------------------------------

const inputClasses =
  "w-full rounded-md border border-edge bg-raised px-2.5 py-1.5 text-[13px] text-ink placeholder:text-faint outline-none transition-colors focus:border-ember-dim focus:ring-1 focus:ring-ember/30";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <input ref={ref} className={cn(inputClasses, className)} {...props} />;
  },
);

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea ref={ref} className={cn(inputClasses, "resize-y leading-relaxed", className)} {...props} />
  );
});

// ---------------------------------------------------------------------------
// Select
// ---------------------------------------------------------------------------

export function Select({
  className,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className={cn("relative block", className)}>
      <select
        className={cn(inputClasses, "appearance-none pr-7 [&>option]:bg-overlay")}
        {...props}
      >
        {children}
      </select>
      <IconChevronDown
        size={13}
        className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-faint"
      />
    </span>
  );
}

// ---------------------------------------------------------------------------
// Segmented control
// ---------------------------------------------------------------------------

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size = "md",
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; title?: string }[];
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "inline-flex items-center rounded-md border border-edge bg-raised p-0.5",
        className,
      )}
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          title={opt.title}
          onClick={() => onChange(opt.value)}
          className={cn(
            "rounded-[5px] font-medium transition-colors",
            size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs",
            value === opt.value
              ? "bg-overlay text-ink shadow-[inset_0_0_0_1px_var(--color-edge-bright)]"
              : "text-mute hover:text-ink",
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stepper (small numeric +/- control)
// ---------------------------------------------------------------------------

export function Stepper({
  value,
  onChange,
  min = 1,
  max = 20,
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  label?: string;
}) {
  return (
    <div className="inline-flex items-center gap-0 rounded-md border border-edge bg-raised text-xs">
      {label ? <span className="pl-2 pr-1 text-[11px] text-faint">{label}</span> : null}
      <button
        type="button"
        className="px-1.5 py-1 text-mute transition-colors hover:text-ink disabled:opacity-30"
        disabled={value <= min}
        onClick={() => onChange(Math.max(min, value - 1))}
        aria-label="Decrease"
      >
        −
      </button>
      <span className="min-w-[1.4em] text-center font-mono text-[12px] text-ink">{value}</span>
      <button
        type="button"
        className="px-1.5 py-1 text-mute transition-colors hover:text-ink disabled:opacity-30"
        disabled={value >= max}
        onClick={() => onChange(Math.min(max, value + 1))}
        aria-label="Increase"
      >
        +
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "ghost" | "danger" | "subtle";
  loading?: boolean;
}

export function Button({
  variant = "subtle",
  loading,
  className,
  children,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium transition-all disabled:cursor-not-allowed disabled:opacity-40",
        variant === "primary" &&
          "bg-ember text-[#1a1206] hover:brightness-110 active:brightness-95 shadow-[0_0_16px_rgba(242,163,60,0.18)]",
        variant === "ghost" &&
          "border border-edge bg-transparent text-mute hover:border-edge-bright hover:text-ink",
        variant === "subtle" && "bg-overlay text-ink hover:bg-hover",
        variant === "danger" &&
          "border border-danger/30 bg-danger/10 text-danger hover:bg-danger/20",
        className,
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <Spinner size={13} /> : null}
      {children}
    </button>
  );
}
