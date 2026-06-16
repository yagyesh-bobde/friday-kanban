"use client";

/**
 * Chips input for context paths: type a path, Enter/comma/blur commits it as
 * a chip; backspace on empty input removes the last chip.
 */

import { useRef, useState } from "react";
import { IconX } from "./icons";

export function ChipsInput({
  value,
  onChange,
  placeholder,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const commit = () => {
    const trimmed = draft.trim().replace(/,$/, "");
    if (trimmed && !value.includes(trimmed)) onChange([...value, trimmed]);
    setDraft("");
  };

  return (
    <div
      className="flex min-h-[34px] w-full cursor-text flex-wrap items-center gap-1.5 rounded-md border border-edge bg-raised px-2 py-1.5 transition-colors focus-within:border-ember-dim focus-within:ring-1 focus-within:ring-ember/30"
      onClick={() => inputRef.current?.focus()}
    >
      {value.map((chip) => (
        <span
          key={chip}
          className="inline-flex items-center gap-1 rounded border border-edge-bright bg-overlay px-1.5 py-0.5 font-mono text-[11px] text-mute"
        >
          {chip}
          <button
            type="button"
            className="text-faint hover:text-danger"
            onClick={(e) => {
              e.stopPropagation();
              onChange(value.filter((c) => c !== chip));
            }}
            aria-label={`Remove ${chip}`}
          >
            <IconX size={10} />
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        value={draft}
        placeholder={value.length === 0 ? placeholder : undefined}
        className="min-w-[120px] flex-1 bg-transparent font-mono text-[12px] text-ink placeholder:font-sans placeholder:text-faint outline-none"
        onChange={(e) => {
          const v = e.target.value;
          if (v.endsWith(",")) {
            setDraft(v);
            // commit on comma
            const trimmed = v.slice(0, -1).trim();
            if (trimmed && !value.includes(trimmed)) onChange([...value, trimmed]);
            setDraft("");
          } else {
            setDraft(v);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Backspace" && draft === "" && value.length > 0) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={commit}
      />
    </div>
  );
}
