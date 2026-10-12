"use client";

import { useState } from "react";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { useApi } from "@/hooks/useApi";
import { useChatStore } from "@/stores/chatStore";
import type { Feedback, Message } from "@/types";

const COMMENT_MAX = 2000;

/**
 * 👍/👎 on a saved assistant message. Clicking the active thumb clears it; 👎
 * opens an optional comment box. Renders inside the bubble's (wrapping) action
 * bar: the comment box takes its own line at the end. Disabled while a reply
 * is streaming or a save is in flight; a failed save restores the old state.
 */
export function MessageFeedback({ message }: { message: Message }) {
  const { put, delete: del } = useApi();
  const isStreaming = useChatStore((s) => s.isStreaming);
  const setFeedback = useChatStore((s) => s.setFeedback);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const [commentOpen, setCommentOpen] = useState(false);
  const [comment, setComment] = useState("");

  const current = message.feedback ?? null;
  const disabled = isStreaming || saving;

  async function save(next: Feedback | null) {
    const previous = current;
    setFeedback(message.id, next);
    setSaving(true);
    setError(false);
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
      setError(true);
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function onThumb(value: 0 | 1) {
    if (current?.value === value) {
      setCommentOpen(false);
      await save(null);
      return;
    }
    const saved = await save({ value, comment: null });
    setComment("");
    setCommentOpen(saved && value === 0);
  }

  async function onSubmitComment(e: React.FormEvent) {
    e.preventDefault();
    const text = comment.trim();
    if (!text) {
      setCommentOpen(false);
      return;
    }
    if (await save({ value: 0, comment: text })) setCommentOpen(false);
  }

  const thumbClass = (active: boolean) =>
    cn(
      "p-1 rounded hover:bg-black/10 dark:hover:bg-white/10 transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed",
      active && "text-primary"
    );

  return (
    <>
      <button
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
      {commentOpen && current?.value === 0 && (
        <form onSubmit={onSubmitComment} className="order-last basis-full mt-1 flex flex-col gap-1.5">
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            maxLength={COMMENT_MAX}
            rows={2}
            autoFocus
            placeholder="What was wrong? (optional)"
            aria-label="Feedback comment"
            className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            disabled={disabled}
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={disabled || !comment.trim()}
              className="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              Send
            </button>
            <button
              type="button"
              onClick={() => setCommentOpen(false)}
              className="rounded-md px-2.5 py-1 text-xs hover:bg-black/10 dark:hover:bg-white/10"
            >
              Skip
            </button>
          </div>
        </form>
      )}
    </>
  );
}
