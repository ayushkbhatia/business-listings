"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { Button, Radio, Textarea } from "@/components/primitives";
import { Alert } from "@/components/display";
import { Card } from "@/components/structure";
import { cn } from "@/lib/cn";
import { confirmCancellation } from "../../actions";

/**
 * Board 11j — the reason, and the confirm.
 *
 * Every string arrives resolved. Nothing here calls `t()` and nothing takes a
 * function prop: a function crossing the server–client boundary is the repo's
 * most repeated defect and `tests/unit/client-labels` fails the build on it.
 * The rail's static cards arrive as `rail`, rendered by the server page, so the
 * only thing this file owns is the state three controls share.
 *
 * ## What is required, and what is never required
 *
 * The reason is required — it is the only churn signal the product gets, and
 * the required mark sits on the reason alone. **Confirming is never blocked on
 * the free-text box**, and the header says so at the point of asking rather
 * than in a hint underneath. The one exception is `Something else`, where the
 * box becomes the only place the reason can be recorded; the option says so on
 * itself, so it is read before it is chosen rather than discovered on submit.
 *
 * ## Choosing "the business is closing" cancels nothing
 *
 * Criterion 7, and it is enforced in three places rather than one: the button
 * changes to `Continue to close account`, this component never posts, and
 * `scheduleCancellation` refuses that reason outright. `11i` is not drawn and
 * is blocked, so the control is inert and says why — never a 404 out of a
 * cancellation flow.
 */

export interface ReasonOption {
  value: string;
  label: string;
  /** The line under the option, where one option needs it. */
  note?: string;
}

export interface ReasonFormLabels {
  legend: string;
  required: string;
  hint: string;
  noteLabel: string;
  noteOptional: string;
  noteRequired: string;
  notePlaceholder: string;
  noteRequiredHint: string;
  /** `{used} of {limit}`, with both placeholders intact. See below. */
  noteCounter: string;
  keepPlan: string;
  confirm: string;
  confirmClosing: string;
  closingBlocked: string;
  resumeNote: string;
  errorNoReason: string;
  errorNoteRequired: string;
}

export interface ReasonFormProps {
  options: readonly ReasonOption[];
  /** The value that forks to `11i` instead of cancelling. */
  closingValue: string;
  /** The value whose free-text box stops being optional. */
  noteRequiredValue: string;
  maxNoteLength: number;
  labels: ReasonFormLabels;
  /** The rail's cards above the buttons: what happens, and the dates. */
  rail: React.ReactNode;
  /**
   * The card below them — what the seller gets by confirming.
   *
   * Split from `rail` because the board puts the buttons between the two, and
   * the order is the argument: what happens, when it happens, decide, then what
   * arrives. Reading "you get a confirmation email" before the decision is
   * offered is the same inversion as the reason gating the information.
   */
  railBelow: React.ReactNode;
}

export function ReasonForm({
  options,
  closingValue,
  noteRequiredValue,
  maxNoteLength,
  labels,
  rail,
  railBelow,
}: ReasonFormProps) {
  const router = useRouter();
  const noteId = useId();
  const legendId = useId();
  const [reason, setReason] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const closing = reason === closingValue;
  const noteRequired = reason === noteRequiredValue;
  /*
     Disabled, and the reason is stated above rather than only implied by a grey
     button. A control that refuses without saying why is the shape errors are
     supposed to prevent — so the two conditions each have their own sentence
     under the button, and the button itself is never the only signal.
  */
  const blocked = reason === null || (noteRequired && note.trim().length === 0);

  return (
    <form
      className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_21.5rem]"
      onSubmit={(event) => {
        event.preventDefault();
        if (closing) return;
        if (reason === null) {
          setError(labels.errorNoReason);
          return;
        }
        if (noteRequired && note.trim().length === 0) {
          setError(labels.errorNoteRequired);
          return;
        }

        setError(null);
        const data = new FormData();
        data.set("reason", reason);
        data.set("note", note);
        startTransition(async () => {
          const result = await confirmCancellation(data);
          if (result.ok) router.push("/dashboard/billing");
          else setError(result.error);
        });
      }}
    >
      <div className="flex min-w-0 flex-col gap-3.5">
        <Card surface="card" padded={false}>
          <fieldset className="min-w-0 border-0 p-0" aria-labelledby={legendId}>
            {/*
               The legend is the fieldset's **first child**, and it has to be.

               It was inside a wrapper div for the layout, which is legal markup
               and silently costs the fieldset its caption: a `<legend>` only
               names its group when it is the first child. The radios were
               announced as six loose controls with no question attached, and
               `getByRole("group", { name })` found nothing — which is how this
               was caught rather than by reading it back.

               So the layout lives on the legend itself. It is `display: block`
               by default and takes flex like anything else.

               `aria-labelledby` as well as the legend, and belt-and-braces is
               the point: the name then comes from the question alone rather
               than from the question plus the hint, and it no longer depends on
               how a browser treats a legend that is laid out with flex.
            */}
            <legend className="flex w-full flex-wrap items-baseline justify-between gap-3 border-b border-line px-4 py-3.5">
              <span id={legendId} className="text-body font-medium text-ink">
                {labels.legend}{" "}
                {/*
                   The required mark is on the reason and on nothing else. The
                   board put it here and then let a hint underneath imply the
                   text box carried one too.
                */}
                <span className="ml-1 align-middle font-mono text-eyebrow uppercase tracking-[0.1em] text-warn-ink">
                  {labels.required}
                </span>
              </span>
              <span className="text-caption text-muted">{labels.hint}</span>
            </legend>

            <ul className="flex flex-col">
              {options.map((option) => (
                <li
                  key={option.value}
                  className={cn(
                    "border-b border-line-soft px-4 py-3 last:border-0",
                    reason === option.value && "bg-fill",
                  )}
                >
                  <Radio
                    name="reason"
                    value={option.value}
                    checked={reason === option.value}
                    onChange={() => {
                      setReason(option.value);
                      setError(null);
                    }}
                    label={option.label}
                    {...(option.note ? { description: option.note } : {})}
                  />
                </li>
              ))}
            </ul>
          </fieldset>
        </Card>

        <Card surface="card" padded>
          <div className="flex flex-wrap items-baseline gap-2">
            <label htmlFor={noteId} className="text-body font-medium text-ink">
              {labels.noteLabel}
            </label>
            <span className="text-caption text-muted">
              {noteRequired ? labels.noteRequired : labels.noteOptional}
            </span>
          </div>
          <Textarea
            id={noteId}
            name="note"
            rows={4}
            limit={maxNoteLength}
            /*
               The counter is built here from a template the server resolved.

               `counterLabel` is a function and a function prop may not cross the
               boundary — the repo's most repeated defect. The *string* crosses,
               with its placeholders intact, and the closure is made on this side.
            */
            counterLabel={(used, limit) =>
              labels.noteCounter.replace("{used}", String(used)).replace("{limit}", String(limit))
            }
            value={note}
            onChange={(event) => {
              setNote(event.target.value);
              setError(null);
            }}
            placeholder={labels.notePlaceholder}
            required={noteRequired}
          />
          {noteRequired && (
            <p className="mt-1.5 text-caption text-warn-ink">{labels.noteRequiredHint}</p>
          )}
        </Card>
      </div>

      <aside className="flex flex-col gap-3.5">
        {rail}

        <div className="flex flex-col gap-2.5">
          <Link href="/dashboard/billing" className="inline-flex h-9 w-full items-center justify-center rounded-ctl border border-moss bg-moss px-3.5 text-caption font-medium text-on-ink hover:border-moss-hover hover:bg-moss-hover focus-visible:shadow-focus focus-visible:outline-none">
            {labels.keepPlan}
          </Link>

          {closing ? (
            /*
               The fork. Nothing is cancelled from this screen, and the control
               is inert because `11i` does not exist — build note `B5`. It stays
               visible rather than disappearing: the seller chose this because it
               is true of their business, and a control that vanishes reads as
               having done something.
            */
            <>
              <Button type="button" variant="secondary" disabled block>
                {labels.confirmClosing}
              </Button>
              <p className="text-caption leading-relaxed text-muted">{labels.closingBlocked}</p>
            </>
          ) : (
            <>
              <button
                type="submit"
                disabled={blocked || pending}
                className={cn(
                  "inline-flex h-9 w-full items-center justify-center rounded-ctl border px-3.5 text-caption font-medium",
                  "focus-visible:shadow-focus-danger focus-visible:outline-none",
                  blocked || pending
                    ? "cursor-not-allowed border-line bg-fill text-disabled-text"
                    : "border-bad-line bg-card text-bad-ink hover:bg-bad-surface",
                )}
              >
                {labels.confirm}
              </button>
              <p className="text-center text-caption leading-relaxed text-muted">
                {labels.resumeNote}
              </p>
            </>
          )}

          {error && (
            <Alert tone="bad" live="assertive">
              {error}
            </Alert>
          )}
        </div>

        {railBelow}
      </aside>
    </form>
  );
}
