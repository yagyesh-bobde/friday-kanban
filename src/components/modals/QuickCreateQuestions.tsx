"use client";

import { useMemo, useState } from "react";
import type { QuickCreateAnswer, QuickCreateQuestion } from "@/lib/types";
import { Button } from "@/components/ui/fields";
import { cn } from "@/components/util";

interface QuickCreateQuestionsProps {
  questions: QuickCreateQuestion[];
  onSubmit: (answers: QuickCreateAnswer[]) => void;
  disabled?: boolean;
}

const OTHER = "__other__";

/** Inline clarifying questions: option chips + a free-text "Other" per question. */
export function QuickCreateQuestions({ questions, onSubmit, disabled }: QuickCreateQuestionsProps) {
  // Per-question selected option (or the OTHER sentinel) and the free-text value.
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [other, setOther] = useState<Record<string, string>>({});

  const answers = useMemo<QuickCreateAnswer[]>(() => {
    return questions.map((q) => {
      const sel = picked[q.id];
      const value = sel === OTHER ? (other[q.id] ?? "").trim() : (sel ?? "");
      return { id: q.id, answer: value };
    });
  }, [questions, picked, other]);

  const allAnswered = answers.every((a) => a.answer.length > 0);

  return (
    <div className="flex flex-col gap-5">
      {questions.map((q) => (
        <div key={q.id} className="flex flex-col gap-2">
          <p className="text-[13px] font-medium text-ink">{q.question}</p>
          <div className="flex flex-wrap gap-2">
            {q.options.map((opt) => (
              <button
                key={opt}
                type="button"
                disabled={disabled}
                onClick={() => setPicked((p) => ({ ...p, [q.id]: opt }))}
                className={cn(
                  "rounded-full border px-3 py-1 text-[12px] transition-colors",
                  picked[q.id] === opt
                    ? "border-ember bg-ember/15 text-ink"
                    : "border-edge bg-overlay text-mute hover:bg-hover hover:text-ink",
                )}
              >
                {opt}
              </button>
            ))}
            <button
              type="button"
              disabled={disabled}
              onClick={() => setPicked((p) => ({ ...p, [q.id]: OTHER }))}
              className={cn(
                "rounded-full border px-3 py-1 text-[12px] transition-colors",
                picked[q.id] === OTHER
                  ? "border-ember bg-ember/15 text-ink"
                  : "border-edge bg-overlay text-mute hover:bg-hover hover:text-ink",
              )}
            >
              Other…
            </button>
          </div>
          {picked[q.id] === OTHER ? (
            <input
              autoFocus
              disabled={disabled}
              value={other[q.id] ?? ""}
              onChange={(e) => setOther((o) => ({ ...o, [q.id]: e.target.value }))}
              placeholder="Type your answer"
              className="mt-1 w-full rounded-md border border-edge bg-overlay px-3 py-1.5 text-[13px] text-ink outline-none focus:border-ember"
            />
          ) : null}
        </div>
      ))}

      <div className="flex justify-end">
        <Button
          variant="primary"
          disabled={disabled || !allAnswered}
          onClick={() => onSubmit(answers)}
        >
          Continue
        </Button>
      </div>
    </div>
  );
}
