"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button, Textarea } from "@/components/primitives";
import { Close, File as FileIcon, Spinner } from "@/components/primitives/icons";
import { StatusBadge } from "@/components/display/StatusBadge";
import { cn } from "@/lib/cn";

/**
 * One thread, from either side.
 *
 * Boards 10h and 11b are two views of the same conversation, so this is one
 * component and the difference is the chips, the notices, the actions beside
 * the composer and whose messages sit on which side. Building two would have let
 * them drift, and a buyer and a seller reading different renderings of the same
 * exchange is the one thing a record must never do.
 *
 * Board `10h` redrew it: day dividers, the time and a read receipt under each
 * message, a revision as a priced table with the old figure struck through, the
 * superseded revision as a document card, files sent in the thread, and a
 * composer in one row with Attach and whatever action the page owns.
 *
 * Every string arrives already translated, and every figure already derived —
 * nothing in here adds a number up.
 */

export interface ThreadQuoteLineView {
  key: string;
  /** `Butterfly valve DN100 × 40`, already worded. */
  label: string;
  /** `191.00`. The column head carries the currency. */
  unitLabel: string;
  /** The previous revision's unit price, struck through. Only when it moved. */
  previousUnitLabel?: string;
  /** The previous revision's quantity, struck through. Only when it moved. */
  previousQtyLabel?: string;
  lineTotalLabel: string;
  /** Not in the revision before. */
  isNew?: boolean;
}

export interface ThreadQuoteView {
  ref: string;
  revision: number;
  /**
   * `table`: every line, priced, with the total — the latest revision.
   * `card`: a document on the record — a superseded revision, or a proposal.
   */
  presentation: "table" | "card";
  /** `Revised quote · r2`, `Quote QT-8841-ALWR1`. */
  title: string;
  /** `AED 14,600`. */
  totalLabel: string;
  /** The revision this one replaced, for a card. */
  previousTotalLabel?: string;
  /** `−AED 280`, already signed and formatted. */
  deltaLabel?: string;
  direction?: "up" | "down" | "same";
  /** `Valid 14 days · until 4 Sep`, `Expired 2 Sep`, or that none was stated. */
  validityLabel?: string;
  expired?: boolean;
  /** Every line this revision prices — never only the changed ones (board `10h` B3). */
  lines?: readonly ThreadQuoteLineView[];
  /** Requirement lines this revision leaves unpriced. Grey, never hidden, never in the total. */
  notQuoted?: readonly { key: string; label: string }[];
  /** Priced in the previous revision, absent from this one. */
  dropped?: readonly { key: string; label: string; previousUnitLabel: string }[];
  /** A generated PDF of this revision, from the same figures. */
  pdfHref?: string;
}

export interface ThreadAttachmentView {
  key: string;
  name: string;
  /** `PDF · 240 KB`. */
  meta: string;
  /** A short-lived download, or absent where this view cannot open it. */
  href?: string;
}

export interface ThreadMessageView {
  id: string;
  /** May be empty for a revision sent without words, or a file sent on its own. */
  body: string;
  /** True for the side reading it. Decides which way the bubble sits. */
  fromMe: boolean;
  /**
   * Who wrote it, where the reader needs telling. The seller's side names the
   * seat (board 11b); the buyer's names nobody, because the header already
   * names the one business on the other side.
   */
  senderLabel?: string;
  /** `16:02`, in Dubai. */
  at: string;
  /** `12 min ago`, only while that is more use than the clock. */
  atRelative?: string;
  /** `Read`, under one's own message, once the other side has opened it. */
  receipt?: string;
  /** The Dubai calendar day, `YYYY-MM-DD`; a divider is drawn where it changes. */
  dayKey: string;
  /** `19 Aug`. */
  dayLabel: string;
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
  attachments?: readonly ThreadAttachmentView[];
  /** The selection treatment: a 1.5px moss border. The revision the accept button names. */
  emphasis?: boolean;
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
  /** Column heads of a revision table. */
  colLine: string;
  colUnit: string;
  colLineTotal: string;
  /** `Total excl. VAT`. */
  total: string;
  /** `Not quoted`, on a grey requirement row. */
  notQuoted: string;
  /** `Not in this revision`, on a dropped row. */
  dropped: string;
  /** `New`, on a line the previous revision did not have. */
  newLine: string;
  /** `Show the 3 lines`. */
  showLines: (count: number) => string;
  /** `PDF`, the tile on a document card and the label of its link. */
  pdf: string;
  /** `Open {name}`, for a file link's accessible name. */
  openFile: (name: string) => string;
  /** `Was {figure}`, for the struck-through figure's accessible text. */
  was: (figure: string) => string;
}

/** A file on its way into the thread. */
export interface ThreadUploadConfig {
  /** `Attach`. */
  label: string;
  /** Types and size, and who will see the file. Shown under the composer once a file is picked. */
  hint: string;
  /** The input's `accept`. */
  accept: string;
  maxFiles: number;
  uploadingLabel: string;
  removeLabel: (name: string) => string;
  /** Too many files for one message. */
  tooManyLabel: string;
  /** Signs and puts one file; resolves to where it landed, or why it did not. */
  upload: (file: File) => Promise<{ ok: true; path: string } | { ok: false; error: string }>;
}

export interface ThreadProps {
  messages: readonly ThreadMessageView[];
  labels: ThreadLabels;
  /** Canned openers. Board 10h and 11b both draw them, with different text. */
  quickReplies?: readonly ThreadChip[];
  /** A notice above the log — the board 11b warning, a closed enquiry. Never decorative. */
  notice?: React.ReactNode;
  /**
   * System notes under the last message — a read receipt, a validity extension.
   *
   * Board 11b: centre-aligned, visually distinct from both parties, and never
   * notified on. Not messages, and not entries in the log, which is why they sit
   * outside the list rather than inside it.
   */
  systemNotes?: readonly React.ReactNode[];
  /**
   * Resolves true when the message is on the record, and only then is the box
   * cleared — a refused send keeps what the person wrote.
   */
  onSend?: (body: string, attachments: { path: string; filename: string }[]) => Promise<boolean>;
  busy?: boolean;
  error?: string;
  /** No composer once the thread is closed to this pair. */
  readOnly?: boolean;
  /** Files in the composer. Absent, and there is no Attach. */
  upload?: ThreadUploadConfig;
  /** Beside Send, in the same row: the buyer's accept. Buttons only — never a form. */
  actions?: React.ReactNode;
  /** Under the composer: what the action beside Send does, stated before it is pressed. */
  footnote?: React.ReactNode;
  /**
   * The log scrolls inside a fixed-height column on a wide screen, opened at
   * its latest message. The buyer's page is laid out that way; the seller's
   * card is not.
   */
  fill?: boolean;
}

interface PendingFile {
  id: string;
  name: string;
  state: "uploading" | "ready" | "failed";
  path?: string;
  error?: string;
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
  upload,
  actions,
  footnote,
  fill = false,
}: ThreadProps) {
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const hintId = useId();

  // Opened at the latest message, and kept there as messages arrive.
  useEffect(() => {
    const log = logRef.current;
    if (fill && log) log.scrollTop = log.scrollHeight;
  }, [fill, messages.length]);

  const uploading = files.some((file) => file.state === "uploading");
  const ready = files.filter((file) => file.state === "ready");
  const canSend = !busy && !uploading && (body.trim() !== "" || ready.length > 0);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (!canSend || !onSend) return;
    const sent = await onSend(
      body.trim(),
      ready.map((file) => ({ path: file.path!, filename: file.name })),
    );
    if (sent) {
      setBody("");
      setFiles([]);
      setFileError(null);
    }
  }

  async function pick(list: FileList | null) {
    if (!upload || !list) return;
    setFileError(null);
    const picked = Array.from(list);
    if (files.length + picked.length > upload.maxFiles) {
      setFileError(upload.tooManyLabel);
      return;
    }
    for (const file of picked) {
      const id = `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 8)}`;
      setFiles((prev) => [...prev, { id, name: file.name, state: "uploading" }]);
      const result = await upload.upload(file);
      setFiles((prev) =>
        prev.map((row) =>
          row.id !== id
            ? row
            : result.ok
              ? { ...row, state: "ready", path: result.path }
              : { ...row, state: "failed", error: result.error },
        ),
      );
    }
  }

  // Grouped by day: a list of days, each holding its list of messages.
  const days: { key: string; label: string; items: ThreadMessageView[] }[] = [];
  for (const message of messages) {
    const last = days[days.length - 1];
    if (last && last.key === message.dayKey) last.items.push(message);
    else days.push({ key: message.dayKey, label: message.dayLabel, items: [message] });
  }

  return (
    <div className={cn("flex flex-col", fill ? "min-h-0 flex-1" : "gap-4")}>
      {notice ? <div className={cn(fill && "px-4 md:px-6 pt-4")}>{notice}</div> : null}

      {/*
        A log around a list, not a log instead of one. `role="log"` on the <ol>
        replaces its list role, which leaves every <li> without a list parent —
        axe says so and a screen reader loses "3 of 7". The wrapper carries the
        live region; the list stays a list. Focusable when it scrolls, so a
        keyboard can scroll it.
      */}
      <div
        ref={logRef}
        role="log"
        aria-label={labels.logLabel}
        aria-live="polite"
        tabIndex={fill ? 0 : undefined}
        className={cn(
          fill &&
            "min-h-0 flex-1 px-4 md:px-6 py-5 focus-visible:shadow-focus focus-visible:outline-none lg:overflow-y-auto",
        )}
      >
        {messages.length === 0 ? (
          <p className="text-body-sm text-muted">{labels.empty}</p>
        ) : (
          <ol className="space-y-3.5">
            {days.map((day) => (
              <li key={day.key} className="space-y-3.5">
                <p className="text-center font-mono text-eyebrow uppercase tracking-eyebrow text-faint">
                  <time dateTime={day.key}>{day.label}</time>
                </p>
                <ol className="space-y-3.5">
                  {day.items.map((message) => (
                    <MessageItem key={message.id} message={message} labels={labels} />
                  ))}
                </ol>
              </li>
            ))}
          </ol>
        )}

        {systemNotes.length > 0 ? (
          <ul className="mt-4 space-y-1.5">
            {systemNotes.map((note, index) => (
              <li key={index} className="flex justify-center">
                <span className="rounded-pill border border-warn-line bg-warn-surface px-3 py-1.5 text-center text-caption text-warn-ink">
                  {note}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {readOnly ? null : (
        <form
          onSubmit={send}
          aria-label={labels.formLabel}
          className={cn(
            "space-y-2.5",
            fill && "border-t border-line bg-card px-4 md:px-6 py-4",
          )}
        >
          {quickReplies.length > 0 ? (
            <fieldset>
              <legend className="sr-only">{labels.quickRepliesLabel}</legend>
              <div className="flex flex-wrap gap-2">
                {quickReplies.map((reply) => (
                  <button
                    key={reply.label}
                    type="button"
                    onClick={() =>
                      setBody((prev) => (prev ? `${prev.trimEnd()} ${reply.text}` : reply.text))
                    }
                    className={cn(
                      "inline-flex min-h-8 items-center rounded-ctl bg-fill px-3 text-caption text-body",
                      "transition-colors duration-120 ease-out hover:bg-line hover:text-ink",
                      "focus-visible:shadow-focus focus-visible:outline-none",
                    )}
                  >
                    {reply.label}
                  </button>
                ))}
              </div>
            </fieldset>
          ) : null}

          {files.length > 0 ? (
            <ul className="flex flex-wrap gap-2" aria-live="polite">
              {files.map((file) => (
                <li
                  key={file.id}
                  className={cn(
                    "inline-flex max-w-full items-center gap-1.5 rounded-ctl border px-2 py-1 text-caption",
                    file.state === "failed" ? "border-bad-line bg-bad-surface text-bad-ink" : "border-line bg-paper text-body",
                  )}
                >
                  {file.state === "uploading" ? <Spinner size={12} /> : <FileIcon size={12} />}
                  <span className="max-w-[24ch] truncate">{file.name}</span>
                  {file.state === "uploading" ? (
                    <span className="text-muted">{upload?.uploadingLabel}</span>
                  ) : file.state === "failed" ? (
                    <span>{file.error}</span>
                  ) : null}
                  {file.state !== "uploading" ? (
                    <button
                      type="button"
                      onClick={() => setFiles((prev) => prev.filter((row) => row.id !== file.id))}
                      aria-label={upload?.removeLabel(file.name)}
                      className="rounded-tag p-0.5 text-muted hover:text-ink focus-visible:shadow-focus focus-visible:outline-none"
                    >
                      <Close size={12} />
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}

          {/*
            One row while there is room for the box beside the buttons, and the
            buttons below it once there is not — decided by the width the
            composer actually has, not the viewport's.
          */}
          <div className="flex flex-wrap items-end gap-2.5">
            <div className="min-w-[min(100%,18rem)] flex-1">
              <Textarea
                rows={1}
                aria-label={labels.composerLabel}
                aria-describedby={upload ? hintId : undefined}
                placeholder={labels.placeholder}
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
            </div>

            {upload ? (
              <>
                <input
                  ref={inputRef}
                  type="file"
                  multiple
                  accept={upload.accept}
                  className="sr-only"
                  tabIndex={-1}
                  aria-hidden="true"
                  onChange={(event) => {
                    void pick(event.target.files);
                    event.target.value = "";
                  }}
                />
                <Button variant="secondary" size="lg" onClick={() => inputRef.current?.click()} disabled={busy}>
                  {upload.label}
                </Button>
              </>
            ) : null}

            {/*
              Ink, not moss. Moss marks the action a screen is for, and on the
              buyer's thread that is accepting; sending is the ordinary act
              beside it. The products page's own ink button is the precedent.
            */}
            <button
              type="submit"
              disabled={!canSend}
              aria-busy={busy || undefined}
              className={cn(
                "inline-flex h-11 items-center justify-center gap-2 whitespace-nowrap rounded-ctl border px-5 text-body font-medium",
                "border-ink bg-ink text-on-ink transition-colors duration-120 ease-out hover:bg-ink-raised",
                "focus-visible:shadow-focus focus-visible:outline-none",
                "disabled:cursor-not-allowed disabled:border-disabled-fill disabled:bg-disabled-fill disabled:text-disabled-text",
              )}
            >
              {busy ? <Spinner size={14} /> : null}
              {busy ? labels.sending : labels.send}
            </button>

            {actions}
          </div>

          {upload ? (
            <p id={hintId} className={cn("text-caption text-muted", files.length === 0 && "sr-only")}>
              {upload.hint}
            </p>
          ) : null}

          {fileError ? (
            <p role="alert" className="text-caption text-bad-ink">
              {fileError}
            </p>
          ) : null}

          {error ? (
            <p role="alert" className="rounded-ctl border border-bad-line bg-bad-surface px-3 py-2 text-body-sm text-bad-ink">
              {error}
            </p>
          ) : null}

          {footnote ? <div className="max-w-[var(--measure-prose)] text-caption text-muted">{footnote}</div> : null}
        </form>
      )}
    </div>
  );
}

function MessageItem({ message, labels }: { message: ThreadMessageView; labels: ThreadLabels }) {
  const meta = [message.senderLabel, message.at, message.atRelative, message.receipt].filter(Boolean).join(" · ");

  return (
    <li className={cn("flex", message.fromMe ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "min-w-0 max-w-full px-4 py-3",
          // A priced table needs its three columns; prose reads best narrower.
          message.quote?.presentation === "table" ? "w-full md:max-w-[42rem]" : "w-fit md:max-w-[62%]",
          message.fromMe
            ? "rounded-[10px_10px_3px_10px] bg-moss-wash"
            : "rounded-[10px_10px_10px_3px] border bg-card",
          !message.fromMe && (message.emphasis ? "border-[1.5px] border-moss" : "border-line"),
          message.fromMe && message.emphasis && "border-[1.5px] border-moss",
          message.flagged && "border border-warn-line-strong bg-warn-surface",
        )}
      >
        {message.body ? (
          <p className={cn("whitespace-pre-wrap text-body-sm leading-relaxed", message.fromMe ? "text-moss-deep" : "text-prose")}>
            {message.body}
          </p>
        ) : null}

        {message.quote ? (
          message.quote.presentation === "table" ? (
            <QuoteTable quote={message.quote} labels={labels} className={cn(message.body && "mt-3")} />
          ) : (
            <QuoteCard quote={message.quote} labels={labels} className={cn(message.body && "mt-3")} />
          )
        ) : null}

        {message.attachments && message.attachments.length > 0 ? (
          <ul className={cn("space-y-1.5", (message.body || message.quote) && "mt-3")}>
            {message.attachments.map((file) => (
              <li key={file.key}>
                <FileRow file={file} labels={labels} fromMe={message.fromMe} />
              </li>
            ))}
          </ul>
        ) : null}

        {message.automatic && labels.automatic ? (
          <p className="mt-2 flex flex-wrap items-center gap-1.5">
            <StatusBadge tone="info" size="sm" shape="chip">
              {labels.automatic}
            </StatusBadge>
            {labels.automaticExplain ? <span className="text-caption text-muted">{labels.automaticExplain}</span> : null}
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

        <p
          className={cn(
            "mt-2 font-mono text-eyebrow uppercase tracking-eyebrow tabular-nums",
            message.fromMe ? "text-moss" : "text-faint",
          )}
        >
          {meta}
        </p>
      </div>
    </li>
  );
}

/**
 * A revision, inline — board `10h`'s *"a revised quote is a message and a
 * document at once"*.
 *
 * Every line the total sums, each with its unit price, the previous unit price
 * struck through where it moved, and its line total, so a buyer can check the
 * figure row by row rather than take the total on trust. Requirement lines the
 * revision leaves unpriced and lines it dropped sit in the same table, grey, and
 * add nothing.
 */
function QuoteTable({ quote, labels, className }: { quote: ThreadQuoteView; labels: ThreadLabels; className?: string }) {
  return (
    <div className={cn("overflow-hidden rounded-card border border-line bg-card", className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-line bg-paper-sunk px-3 py-2">
        <span className="font-mono text-eyebrow uppercase tracking-eyebrow text-muted">{quote.title}</span>
        {quote.deltaLabel ? (
          <span
            className={cn(
              "text-caption font-medium tabular-nums",
              quote.direction === "down" ? "text-ok-ink" : quote.direction === "up" ? "text-bad-ink" : "text-muted",
            )}
          >
            {quote.deltaLabel}
          </span>
        ) : null}
      </div>
      <div className="overflow-x-auto" tabIndex={0} role="group" aria-label={quote.title}>
        <LinesTable quote={quote} labels={labels} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-line px-3 py-2">
        {quote.validityLabel ? (
          <span className={cn("font-mono text-eyebrow uppercase tracking-eyebrow", quote.expired ? "text-bad-ink" : "text-muted")}>
            {quote.validityLabel}
          </span>
        ) : (
          <span />
        )}
        {quote.pdfHref ? (
          <a
            href={quote.pdfHref}
            className="rounded-tag text-caption text-moss underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
          >
            {labels.pdf} · <span className="font-mono">{quote.ref}</span>
          </a>
        ) : null}
      </div>
    </div>
  );
}

function LinesTable({ quote, labels }: { quote: ThreadQuoteView; labels: ThreadLabels }) {
  // Figures never wrap; the line's words do, so three columns hold at phone width.
  const figure = "whitespace-nowrap px-3 py-2 text-right align-top font-mono text-caption tabular-nums";
  return (
    <table className="w-full border-collapse text-left">
      <thead>
        <tr className="border-b border-line">
          <th scope="col" className="px-3 py-1.5 font-mono text-eyebrow font-normal uppercase tracking-eyebrow text-faint">
            {labels.colLine}
          </th>
          <th scope="col" className="px-3 py-1.5 text-right font-mono text-eyebrow font-normal uppercase tracking-eyebrow text-faint">
            {labels.colUnit}
          </th>
          <th scope="col" className="px-3 py-1.5 text-right font-mono text-eyebrow font-normal uppercase tracking-eyebrow text-faint">
            {labels.colLineTotal}
          </th>
        </tr>
      </thead>
      <tbody>
        {(quote.lines ?? []).map((line) => (
          <tr key={line.key} className="border-b border-paper-sunk">
            <th scope="row" className="px-3 py-2 align-top text-caption font-normal text-body">
              {line.label}
              {line.previousQtyLabel ? (
                <s className="ml-1.5 font-mono text-faint">
                  <span className="sr-only">{labels.was(line.previousQtyLabel)}</span>
                  <span aria-hidden="true">{line.previousQtyLabel}</span>
                </s>
              ) : null}
              {line.isNew ? (
                <span className="ml-1.5 font-mono text-eyebrow uppercase tracking-eyebrow text-ok-ink">{labels.newLine}</span>
              ) : null}
            </th>
            <td className={figure}>
              {line.previousUnitLabel ? (
                <s className="mr-2 text-faint">
                  <span className="sr-only">{labels.was(line.previousUnitLabel)}</span>
                  <span aria-hidden="true">{line.previousUnitLabel}</span>
                </s>
              ) : null}
              <span className="text-ink">{line.unitLabel}</span>
            </td>
            <td className={cn(figure, "text-body")}>{line.lineTotalLabel}</td>
          </tr>
        ))}
        {(quote.notQuoted ?? []).map((row) => (
          <tr key={row.key} className="border-b border-paper-sunk bg-paper">
            <th scope="row" className="px-3 py-2 text-caption font-normal text-muted">
              {row.label}
            </th>
            <td className={cn(figure, "text-muted")} colSpan={2}>
              {labels.notQuoted}
            </td>
          </tr>
        ))}
        {(quote.dropped ?? []).map((row) => (
          <tr key={row.key} className="border-b border-paper-sunk bg-paper">
            <th scope="row" className="px-3 py-2 text-caption font-normal text-muted">
              {row.label}
            </th>
            <td className={cn(figure, "text-muted")} colSpan={2}>
              <s className="mr-2">
                <span className="sr-only">{labels.was(row.previousUnitLabel)}</span>
                <span aria-hidden="true">{row.previousUnitLabel}</span>
              </s>
              {labels.dropped}
            </td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="bg-paper">
          <th scope="row" colSpan={2} className="px-3 py-2 text-caption font-medium text-ink">
            {labels.total}
          </th>
          <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-caption font-medium tabular-nums text-ink">{quote.totalLabel}</td>
        </tr>
      </tfoot>
    </table>
  );
}

/**
 * A revision on the record — the superseded r1 the board draws as a PDF, or a
 * proposal. Its lines open in place, so reading r1 does not mean leaving the
 * thread for a file.
 */
function QuoteCard({ quote, labels, className }: { quote: ThreadQuoteView; labels: ThreadLabels; className?: string }) {
  const meta = [quote.totalLabel, quote.validityLabel].filter(Boolean).join(" · ");
  const lines = quote.lines ?? [];
  return (
    <div className={cn("rounded-ctl bg-paper-sunk px-3 py-2.5", className)}>
      <div className="flex items-center gap-2.5">
        {quote.pdfHref ? (
          <a
            href={quote.pdfHref}
            className="flex size-8 shrink-0 items-center justify-center rounded-tag bg-fill font-mono text-eyebrow text-muted hover:text-ink focus-visible:shadow-focus focus-visible:outline-none"
          >
            <span aria-hidden="true">{labels.pdf}</span>
            <span className="sr-only">{labels.openFile(`${labels.pdf} ${quote.ref}`)}</span>
          </a>
        ) : (
          <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-tag bg-fill text-muted">
            <FileIcon size={14} />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-caption text-ink">{quote.title}</p>
          <p className="mt-0.5 font-mono text-eyebrow uppercase tracking-eyebrow text-faint">
            {quote.previousTotalLabel ? (
              <s className="mr-1.5">
                <span className="sr-only">{labels.was(quote.previousTotalLabel)}</span>
                <span aria-hidden="true">{quote.previousTotalLabel}</span>
              </s>
            ) : null}
            {meta}
            {quote.deltaLabel ? <span className="ml-1.5 normal-case">{quote.deltaLabel}</span> : null}
          </p>
        </div>
      </div>
      {lines.length > 0 ? (
        <details className="mt-2 group">
          <summary className="cursor-pointer rounded-tag text-caption text-moss underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none">
            {labels.showLines(lines.length)}
          </summary>
          <div className="mt-2 overflow-x-auto rounded-ctl border border-line bg-card" tabIndex={0} role="group" aria-label={quote.title}>
            <LinesTable quote={quote} labels={labels} />
          </div>
        </details>
      ) : null}
    </div>
  );
}

function FileRow({ file, labels, fromMe }: { file: ThreadAttachmentView; labels: ThreadLabels; fromMe: boolean }) {
  const inner = (
    <>
      <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-tag bg-fill text-muted">
        <FileIcon size={13} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-caption text-ink">{file.name}</span>
        <span className="block font-mono text-eyebrow uppercase tracking-eyebrow text-faint">{file.meta}</span>
      </span>
    </>
  );
  const shell = cn("flex items-center gap-2 rounded-ctl px-2.5 py-2", fromMe ? "bg-card/60" : "bg-paper-sunk");
  return file.href ? (
    <a
      href={file.href}
      aria-label={labels.openFile(file.name)}
      className={cn(shell, "hover:bg-fill focus-visible:shadow-focus focus-visible:outline-none")}
    >
      {inner}
    </a>
  ) : (
    <span className={shell}>{inner}</span>
  );
}
