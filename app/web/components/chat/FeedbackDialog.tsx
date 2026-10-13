"use client";

import { useEffect, useState, type RefObject } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  FEEDBACK_COMMENT_MAX,
  canSendFeedback,
  feedbackDialogTitle,
  isSubmitShortcut,
  showCommentCounter,
} from "@/lib/feedback-dialog";

interface FeedbackDialogProps {
  /** Polarity of the rating that opened the dialog. */
  value: 0 | 1;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Saves the comment; resolves false on failure so the dialog stays open. */
  onSubmit: (comment: string) => Promise<boolean>;
  saving: boolean;
  /** Thumb that opened the dialog. It opens programmatically (no Radix trigger), so focus is restored explicitly. */
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}

/**
 * Follow-up pop-up after a 👍/👎 is saved. The rating is already stored, so
 * Skip / Esc / overlay / ✕ just close it; Send adds an optional comment.
 */
export function FeedbackDialog({ value, open, onOpenChange, onSubmit, saving, returnFocusRef }: FeedbackDialogProps) {
  const [comment, setComment] = useState("");
  const [error, setError] = useState(false);

  useEffect(() => {
    if (open) {
      setComment("");
      setError(false);
    }
  }, [open]);

  const canSend = canSendFeedback(comment, saving);

  async function submit() {
    if (!canSend) return;
    setError(false);
    if (await onSubmit(comment.trim())) onOpenChange(false);
    else setError(true);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          returnFocusRef.current?.focus();
        }}
      >
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          onKeyDown={(e) => {
            if (isSubmitShortcut(e)) {
              e.preventDefault();
              void submit();
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>{feedbackDialogTitle(value)}</DialogTitle>
            <DialogDescription>Your rating is saved. Add a comment if you like.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1">
            <Textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              maxLength={FEEDBACK_COMMENT_MAX}
              rows={4}
              placeholder="Anything else? (optional)"
              aria-label="Feedback comment"
              disabled={saving}
            />
            {showCommentCounter(comment) && (
              <span className="self-end text-xs text-muted-foreground tabular-nums">
                {comment.length}/{FEEDBACK_COMMENT_MAX}
              </span>
            )}
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              Couldn&apos;t send feedback. Please try again.
            </p>
          )}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
              Skip
            </Button>
            <Button type="submit" size="sm" disabled={!canSend}>
              {saving ? "Sending…" : "Send feedback"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
