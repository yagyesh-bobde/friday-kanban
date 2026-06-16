"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/components/util";
import { IconX } from "./icons";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Tailwind max-width class, default max-w-lg */
  width?: string;
  children: ReactNode;
  footer?: ReactNode;
}

export function Modal({ open, onClose, title, subtitle, width, children, footer }: ModalProps) {
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 backdrop-blur-[2px] px-4 py-12"
      onMouseDown={(e) => {
        if (e.target === backdropRef.current) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal
        className={cn(
          "animate-fade-up w-full rounded-xl border border-edge bg-panel shadow-[0_24px_80px_rgba(0,0,0,0.6)]",
          width ?? "max-w-lg",
        )}
      >
        <div className="flex items-start justify-between border-b border-edge px-5 py-4">
          <div>
            <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
            {subtitle ? <p className="mt-0.5 text-xs text-mute">{subtitle}</p> : null}
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-faint transition-colors hover:bg-hover hover:text-ink"
            aria-label="Close"
          >
            <IconX size={15} />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer ? (
          <div className="flex items-center justify-end gap-2 border-t border-edge px-5 py-3.5">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
