"use client";

import { useState } from "react";
import { Button, Textarea } from "@/components/primitives";
import { StatusBadge } from "@/components/display/StatusBadge";
import { cn } from "@/lib/cn";

/**
 * One thread, from either side.
 *
 * Boards 10h and 11b are two views of the same conversation, so this is one
 * component and the difference is the chips, the warning and whose messages sit
 * on which side. Building two would have let them drift, and a buyer and a
 * seller reading different renderings of the same exchange is the one thing a
 * record must never do.
 *
 * Every string arrives already translated.
 */

export interface ThreadQuoteView {
  ref: string;
  revision: number;
  /** Already formatted, e.g. "AED 15,344". */
  totalLabel: string;
  /** The revision this one replaced, struck through beside the new price. */
  previousTotalLabel?: string;
  /** "AED −1,136 · 5.1% lower", already formatted and localised. */
  deltaLabel?: string;
  direction?: "up" | "down" | "same";
}

export interface ThreadMessageView {
  id: string;
  body: string;
  /** True for the side reading it. Decides which way the bubble sits. */
  fromMe: boolean;
  senderLabel: string;
  /** Already formatted. */
  at: string;
  /** Detected as an attempt to move the deal off the record. */
  flagged: boolean;
  /**
   * Written by a schedule rather than typed.
   *
   * Board 11b tags the follow-up on screen. A buyer replying to what they think
   * is a person deserves to know when it was not one, and a seller looking back
   * at the thread needs to tell their own words from the reminder.
   */
  automatic?: boolean;
  quote?: ThreadQuoteView;
}

/**
 * A canned opener.
 *
 * The label and the text are separate because board 11b §3 requires it: the
 * chip says *"Extend the price hold"* and drops in wording the seller finishes,
 * rather than a sentence committing them to a number nobody typed. The board
 * shipped three chips that each made a commitment, one of them to a 21-day hold
 * against a quote whose validity said fourteen.
 */
export interface ThreadChip {
  label: string;
  /** What lands in the box. Editable before it sends; it never sends itself. */
  text: string;
}

export interface ThreadLabels {
  heading: string;
  /**
   * Names the composer's <form> landmark. Distinct per instance where a page
   * holds more than one — the gallery does, and landmarks that share a name
   * are landmarks a screen reader user cannot tell apart.
   */
  formLabel: string;
  /** Names the log region for assistive technology. */
  logLabel: string;
  empty: string;
  composerLabel: string;
  placeholder: string;
  send: string;
  sending: string;
  quickRepliesLabel: string;
  flagged: string;
  flaggedExplain: string;
  /** The tag on a scheduled follow-up, and the sentence explaining it. */
  automatic?: string;
  automaticExplain?: string;
  revisionOf: (revision: number) => string;
  wasLabel: string;
}

export interface ThreadProps {
  messages: readonly ThreadMessageView[];
  labels: ThreadLabels;
  /** Canned openers. Board 10h and 11b both draw them, with different text. */
  quickReplies?: readonly ThreadChip[];
  /** The board 11b warning, on the seller's side only. Never decorative. */
  notice?: React.ReactNode;
  /**
   * System notes under the last message — a read receipt, a validity extension.
   *
   * Board 11b: centre-aligned, visually distinct from both parties, and never
   * notified on. Not messages, and not entries in the log, which is why they sit
   * outside the list rather than inside it.
   *
   * A list rather than one node since board 3k, which adds a second: extending a
   * quote's window writes a line here saying what moved, by whom and to when.
   * §5 is explicit that extending is silent — a line in the record is not a
   * notification, and a `Message` row would have been both.
   */
  systemNotes?: readonly React.ReactNode[];
  onSend?: (body: string) => void | Promise<void>;
  busy?: boolean;
  error?: string;
  /** No composer once the enquiry is closed to this pair. */
  readOnly?: boolean;
}

export function Thread({
  messages,
  labels,
  quickReplies = [],
  notice,
  systemNotes = [],
  onSend,
  busy = false,
  error,
  readOnly = false,
}: ThreadProps) {
  const [body, setBody] = useState("");

  function send(event: React.FormEvent) {
    event.preventDefault();
    const text = body.trim();
    if (!text) return;
    void onSend?.(text);
    setBody("");
  }

  return (
    <div className="space-y-4">
      {notice}

      {/*
        A log around a list, not a log instead of one. `role="log"` on the <ol>
        replaces its list role, which leaves every <li> without a list parent —
        axe says so and a screen reader loses "3 of 7". The wrapper carries the
        live region; the list stays a list.
      */}
      <div role="log" aria-label={labels.logLabel} aria-live="polite">
        <ol className="space-y-3">
          {messages.length === 0 ? (
            <li className="text-body-sm text-muted">{labels.empty}</li>
          ) : (
            messages.map((message) => (
              <li
                key={message.id}
                className={cn("flex flex-col gap-1", message.fromMe ? "items-end" : "items-start")}
              >
                <div
                  className={cn(
                    "max-w-[42ch] rounded-card border px-3 py-2",
                    message.fromMe ? "border-moss-muted bg-moss-wash" : "border-line bg-card",
                    message.flagged && "border-warn-line-strong bg-warn-surface",
                  )}
                >
                  <p className="whitespace-pre-wrap text-body-sm text-ink">{message.body}</p>

                  {message.quote ? <QuoteInline quote={message.quote} labels={labels} /> : null}

                  {message.automatic && labels.automatic ? (
                    <p className="mt-2 flex flex-wrap items-center gap-1.5">
                      <StatusBadge tone="info" size="sm" shape="chip">
                        {labels.automatic}
                      </StatusBadge>
                      {labels.automaticExplain ? (
                        <span className="text-caption text-muted">{labels.automaticExplain}</span>
                      ) : null}
                    </p>
                  ) : null}

                  {message.flagged ? (
                    <p className="mt-2 flex flex-wrap items-center gap-1.5">
                      <StatusBadge tone="warn" size="sm" shape="chip">
                        {labels.flagged}
                      </StatusBadge>
                      <span className="text-caption text-warn-ink">{labels.flaggedExplain}</span>
                    </p>
                  ) : null}
                </div>
                <p className="text-caption text-muted">
                  {message.senderLabel} · {message.at}
                </p>
              </li>
            ))
            )}
        </ol>
      </div>

      {systemNotes.length > 0 ? (
        <ul className="space-y-1.5">
          {systemNotes.map((note, index) => (
            <li key={index} className="flex justify-center">
              <span className="rounded-pill border border-warn-line bg-warn-surface px-3 py-1.5 text-center text-caption text-warn-ink">
                {note}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {readOnly ? null : (
        <form onSubmit={send} aria-label={labels.formLabel} className="space-y-2">
          {quickReplies.length > 0 ? (
            <div>
              <p className="mb-1.5 text-caption text-muted">{labels.quickRepliesLabel}</p>
              <div className="flex flex-wrap gap-1.5">
                {quickReplies.map((reply) => (
                  <button
                    key={reply.label}
                    type="button"
                    onClick={() =>
                      setBody((prev) =>
                        prev ? `${prev.trimEnd()} ${reply.text}` : reply.text,
                      )
                    }
                    className={cn(
                      "rounded-pill border border-line-strong bg-card px-3 py-1.5 text-caption text-body",
                      "transition-colors duration-120 ease-out hover:border-moss hover:text-ink",
                      "focus-visible:shadow-focus focus-visible:outline-none",
                    )}
                  >
                    {reply.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <Textarea
            rows={3}
            aria-label={labels.composerLabel}
            placeholder={labels.placeholder}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />

          {error ? (
            <p role="alert" className="rounded-ctl border border-bad-line bg-bad-surface px-3 py-2 text-body-sm text-bad-ink">
              {error}
            </p>
          ) : null}

          <div className="flex justify-end">
            <Button type="submit" loading={busy} disabled={body.trim() === ""}>
              {busy ? labels.sending : labels.send}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

/**
 * A revision, inline.
 *
 * The previous total struck through beside the new one, and the delta. Both
 * sides see the same two numbers — a seller who cannot see what they just
 * changed cannot explain it, and a buyer who cannot see it has to take the
 * seller's word for which way it moved.
 */
function QuoteInline({ quote, labels }: { quote: ThreadQuoteView; labels: ThreadLabels }) {
  return (
    <div className="mt-2 rounded-ctl border border-line bg-paper-sunk px-2.5 py-2">
      <p className="font-mono text-caption text-muted">{quote.ref}</p>
      <p className="mt-0.5 flex flex-wrap items-baseline gap-2">
        {quote.previousTotalLabel ? (
          <>
            <span className="text-caption text-muted">{labels.wasLabel}</span>
            <s className="font-mono text-body-sm text-muted">{quote.previousTotalLabel}</s>
          </>
        ) : null}
        <span className="font-mono text-body tabular-nums text-ink">{quote.totalLabel}</span>
      </p>
      {quote.deltaLabel ? (
        <p
          className={cn(
            "mt-0.5 text-caption",
            quote.direction === "down" ? "text-ok-ink" : quote.direction === "up" ? "text-bad-ink" : "text-muted",
          )}
        >
          {quote.deltaLabel}
        </p>
      ) : null}
      <p className="mt-0.5 text-caption text-muted">{labels.revisionOf(quote.revision)}</p>
    </div>
  );
}
