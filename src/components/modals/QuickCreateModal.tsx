"use client";

import { useEffect, useRef, useState } from "react";
import type { QuickCreateAnswer, QuickCreateQuestion } from "@/lib/types";
import { api, ApiHttpError } from "@/store/api";
import { useUi } from "@/store/ui";
import { Modal } from "@/components/ui/Modal";
import { Button, Textarea } from "@/components/ui/fields";
import { Spinner } from "@/components/ui/icons";
import { QuickCreateQuestions } from "./QuickCreateQuestions";

type Phase =
  | { stage: "input" }
  | { stage: "loading" }
  | { stage: "questions"; questions: QuickCreateQuestion[] }
  | { stage: "error"; message: string };

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform);
const SUBMIT_HINT = isMac ? "⌘↵ to create" : "Ctrl+↵ to create";

export function QuickCreateModal() {
  const open = useUi((s) => s.quickCreateOpen);
  const close = useUi((s) => s.closeQuickCreate);
  const openNewTask = useUi((s) => s.openNewTask);
  const toast = useUi((s) => s.toast);

  const [text, setText] = useState("");
  const [phase, setPhase] = useState<Phase>({ stage: "input" });
  const textRef = useRef<HTMLTextAreaElement>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);

  // Track mounted state to avoid setState after unmount/close.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Reset and focus on open.
  useEffect(() => {
    if (!open) return;
    setText("");
    setPhase({ stage: "input" });
    const id = window.setTimeout(() => textRef.current?.focus(), 30);
    return () => window.clearTimeout(id);
  }, [open]);

  const fallbackToFullEditor = (draft: string) => {
    close();
    openNewTask(undefined, draft);
  };

  const submit = async (answers: QuickCreateAnswer[]) => {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    if (inFlight.current) return;
    inFlight.current = true;
    setPhase({ stage: "loading" });
    try {
      const res = await api.quickCreateTask({
        text: trimmed,
        ...(answers.length > 0 ? { answers } : {}),
      });
      if (res.status === "needs_input") {
        if (!mounted.current) return;
        setPhase({ stage: "questions", questions: res.questions });
        return;
      }
      toast("success", "Task added to Todo", res.task.title, res.task.id);
      close();
    } catch (err) {
      if (err instanceof ApiHttpError && err.status === 422) {
        // Parser couldn't understand it — hand the text to the full editor.
        fallbackToFullEditor(trimmed);
        toast("info", "Opening the full editor", "Add the details manually.");
        return;
      }
      const message = err instanceof ApiHttpError ? err.friendly : "Something went wrong.";
      if (!mounted.current) return;
      setPhase({ stage: "error", message });
    } finally {
      inFlight.current = false;
    }
  };

  const onTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const mod = isMac ? e.metaKey : e.ctrlKey;
    if (e.key === "Enter" && (mod || !e.shiftKey)) {
      // Enter (or Cmd/Ctrl+Enter) submits; Shift+Enter inserts a newline.
      e.preventDefault();
      void submit([]);
    }
  };

  if (!open) return null;

  return (
    <Modal
      open={open}
      onClose={close}
      title="Quick create"
      subtitle="Describe a task in plain language — Haiku turns it into a Todo."
      width="max-w-xl"
    >
      {phase.stage === "questions" ? (
        <QuickCreateQuestions
          questions={phase.questions}
          onSubmit={(answers) => void submit(answers)}
        />
      ) : (
        <div className="flex flex-col gap-3">
          <Textarea
            ref={textRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onTextareaKeyDown}
            disabled={phase.stage === "loading"}
            rows={4}
            placeholder="e.g. Fix the flaky login redirect on the kanban board and add a regression test"
          />

          {phase.stage === "error" ? (
            <p className="text-[12px] text-danger">{phase.message}</p>
          ) : null}

          <div className="flex items-center justify-between">
            <span className="text-[11px] text-faint">
              {phase.stage === "loading" ? null : SUBMIT_HINT}
            </span>
            <div className="flex items-center gap-2">
              {phase.stage === "error" ? (
                <Button variant="ghost" onClick={() => fallbackToFullEditor(text.trim())}>
                  Open full editor
                </Button>
              ) : null}
              <Button
                variant="primary"
                disabled={phase.stage === "loading" || text.trim().length === 0}
                onClick={() => void submit([])}
              >
                {phase.stage === "loading" ? (
                  <span className="flex items-center gap-2">
                    <Spinner size={13} /> Thinking…
                  </span>
                ) : (
                  "Create"
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
