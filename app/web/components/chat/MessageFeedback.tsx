"use client";

import { useRef, useState } from "react";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { useApi } from "@/hooks/useApi";
import { useChatStore } from "@/stores/chatStore";
import type { Feedback, Message } from "@/types";
import { FeedbackDialog } from "./FeedbackDialog";

/**
 * 👍/👎 on a saved assistant message. Clicking a thumb saves the rating, then
 * opens a dialog for an optional comment; clicking the active thumb clears it.
 * Disabled while a reply is streaming or a save is in flight; a failed save
 * restores the old state.
 */
export function MessageFeedback({ message }: { message: Message }) {
  const { put, delete: del } = useApi();
  const isStreaming = useChatStore((s) => s.isStreaming);
  const setFeedback = useChatStore((s) => s.setFeedback);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogValue, setDialogValue] = useState<0 | 1>(1);
  const upRef = useRef<HTMLButtonElement>(null);
  const downRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLButtonElement | null>(null);

  const current = message.feedback ?? null;
  const disabled = isStreaming || saving;

  async function save(next: Feedback | null) {
    const previous = current;
    setFeedback(message.id, next);
    setSaving(true);
    try {
      const path = `/messages/${message.id}/feedback`;
      const res = next
        ? await put<{ feedback: Feedback | null }>(path, next)
        : await del<{ feedback: Feedback | null }>(path);
      setFeedback(message.id, res.feedback);
      return true;
    } catch (err) {
      console.error("Failed to save feedback:", err);
      setFeedback(message.id, previous);
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function onThumb(value: 0 | 1) {
    setError(false);
    if (current?.value === value) {
      setError(!(await save(null)));
      return;
    }
    returnFocusRef.current = value === 1 ? upRef.current : downRef.current;
    const saved = await save({ value, comment: null });
    setError(!saved);
    if (saved) {
      setDialogValue(value);
      setDialogOpen(true);
    }
  }

  const thumbClass = (active: boolean) =>
    cn(
      "p-1 rounded hover:bg-black/10 dark:hover:bg-white/10 transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed",
      active && "text-primary"
    );

  return (
    <>
      <button
        ref={upRef}
        type="button"
        onClick={() => onThumb(1)}
        disabled={disabled}
        className={thumbClass(current?.value === 1)}
        title={current?.value === 1 ? "Remove rating" : "Good response"}
        aria-label="Good response"
        aria-pressed={current?.value === 1}
      >
        <ThumbsUp className="h-3.5 w-3.5" fill={current?.value === 1 ? "currentColor" : "none"} />
      </button>
      <button
        ref={downRef}
        type="button"
        onClick={() => onThumb(0)}
        disabled={disabled}
        className={thumbClass(current?.value === 0)}
        title={current?.value === 0 ? "Remove rating" : "Bad response"}
        aria-label="Bad response"
        aria-pressed={current?.value === 0}
      >
        <ThumbsDown className="h-3.5 w-3.5" fill={current?.value === 0 ? "currentColor" : "none"} />
      </button>
      {error && <span className="text-[10px] text-destructive select-none">Couldn&apos;t save feedback</span>}
      <FeedbackDialog
        value={dialogValue}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSubmit={(comment) => save({ value: dialogValue, comment })}
        saving={saving}
        returnFocusRef={returnFocusRef}
      />
    </>
  );
}
