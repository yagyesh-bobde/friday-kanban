"use client";

/**
 * In Review → In Dev requires a typed comment (DESIGN.md decision 12).
 * Opened when a card is dropped from In Review onto In Dev, or from the
 * drawer's "Send back" action. Submits via the move command.
 */

import { useEffect, useState } from "react";
import { useBoard } from "@/store/board";
import { useUi } from "@/store/ui";
import { Modal } from "@/components/ui/Modal";
import { Button, Field, Textarea } from "@/components/ui/fields";
import { IconArrowLeft } from "@/components/ui/icons";

export function SendBackDialog() {
  const taskId = useUi((s) => s.sendBackTaskId);
  const close = useUi((s) => s.closeSendBack);
  const task = useBoard((s) => (taskId ? s.tasks[taskId] : undefined));
  const moveTask = useBoard((s) => s.moveTask);

  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (taskId) {
      setComment("");
      setSubmitting(false);
    }
  }, [taskId]);

  const submit = async () => {
    if (!taskId || comment.trim() === "") return;
    setSubmitting(true);
    const ok = await moveTask(taskId, "in_dev", comment.trim());
    setSubmitting(false);
    if (ok) close();
  };

  return (
    <Modal
      open={taskId !== null}
      onClose={close}
      title={
        <span className="inline-flex items-center gap-2">
          <IconArrowLeft size={14} className="text-attention" />
          Send back to In Dev
        </span>
      }
      subtitle={task ? task.title : undefined}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={comment.trim() === ""}
            loading={submitting}
            onClick={submit}
          >
            Send back
          </Button>
        </>
      }
    >
      <Field
        label="What needs to change?"
        hint="resumed into the implementer's session"
      >
        <Textarea
          autoFocus
          rows={5}
          placeholder="Describe the changes you want — this is injected as review feedback into the same Claude session (--resume)."
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void submit();
          }}
        />
      </Field>
      <p className="mt-2 text-[11px] text-faint">
        <kbd>⌘</kbd> <kbd>↵</kbd> to send
      </p>
    </Modal>
  );
}
