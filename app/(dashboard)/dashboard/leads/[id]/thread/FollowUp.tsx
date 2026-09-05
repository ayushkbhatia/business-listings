"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Textarea, Toggle } from "@/components/primitives";
import { t } from "@/lib/i18n";
import { cancelFollowUpAction, scheduleFollowUpAction, sendFollowUpNow } from "./actions";

/**
 * Board 11b §4 — the one follow-up, and the schedule behind it.
 *
 * ## What this replaced
 *
 * A button that stamped a column and sent nothing. `nudge()` wrote `nudgedAt`,
 * returned, and the rail said "Follow-up sent {when}" over a message no buyer
 * ever received. The service now writes a message, tags it `AUTOMATIC` and
 * notifies; this is the surface that arms it.
 *
 * ## The draft is the seller's
 *
 * The board's own correction: we do not draft commercial commitments on a
 * seller's behalf. The field starts empty with a placeholder that carries no
 * price, no discount and no deadline, and the schedule refuses to arm without
 * words the seller typed. A pre-written body would be the platform speaking in
 * a supplier's voice on a channel the supplier cannot see.
 *
 * ## One
 *
 * The rail states the cap before it is used rather than after, and there is no
 * second toggle to find. Once it has gone, the card says when and offers
 * nothing — a disabled button invites a second attempt, and the whole point is
 * that there is no second.
 */

export function FollowUp({
  enquiryId,
  state,
  sentLabel,
  scheduledLabel,
}: {
  enquiryId: string;
  /** Which of the four the card is in. Decided on the server, from the row. */
  state: "sent" | "scheduled" | "available" | "too_early";
  /** "Follow-up sent 2 days ago", already formatted. */
  sentLabel: string | null;
  /** "Sends tomorrow at 09:00 unless the buyer replies first". */
  scheduledLabel: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);

  function run(work: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await work();
      if (result.ok) router.refresh();
      else setError(result.error ?? null);
    });
  }

  return (
    <section aria-labelledby={`followup-${enquiryId}`} className="space-y-2.5">
      <h2
        id={`followup-${enquiryId}`}
        className="font-mono text-eyebrow uppercase tracking-wide text-muted"
      >
        {t("thread.followup_heading")}
      </h2>

      {state === "sent" ? (
        <p className="text-body-sm text-ink">{sentLabel}</p>
      ) : state === "too_early" ? (
        <p className="text-body-sm text-muted">{t("thread.nudge_not_yet")}</p>
      ) : state === "scheduled" ? (
        <div className="space-y-2">
          <p className="text-body-sm text-ink">{scheduledLabel}</p>
          <Toggle
            checked
            label={t("thread.nudge_toggle")}
            disabled={pending}
            onChange={() => run(() => cancelFollowUpAction(enquiryId))}
          />
        </div>
      ) : (
        <div className="space-y-2">
          <label className="block space-y-1.5">
            <span className="block text-body-sm text-ink">{t("thread.nudge_body_label")}</span>
            <Textarea
              rows={3}
              placeholder={t("thread.nudge_body_placeholder")}
              value={body}
              onChange={(event) => setBody(event.target.value)}
            />
          </label>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              loading={pending}
              disabled={body.trim() === ""}
              onClick={() => run(() => scheduleFollowUpAction({ enquiryId, body }))}
            >
              {t("thread.nudge_toggle")}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              loading={pending}
              disabled={body.trim() === ""}
              onClick={() => run(() => sendFollowUpNow({ enquiryId, body }))}
            >
              {t("thread.nudge_send_now")}
            </Button>
          </div>
        </div>
      )}

      {error ? (
        <p role="alert" className="text-caption text-bad-ink">
          {error}
        </p>
      ) : null}

      {/*
        Load-bearing copy, kept in every state. Board 11b: "the rail explains
        why; keep that sentence." A seller who only meets the cap at the moment
        they hit it reads it as a limit; one who meets it beforehand reads it as
        a decision the product made, which is what it is.
      */}
      <p className="max-w-[var(--measure-prose)] text-caption text-muted">
        {t("thread.nudge_help")}
      </p>
      {state === "scheduled" || state === "available" ? (
        <p className="max-w-[var(--measure-prose)] text-caption text-faint">
          {t("thread.nudge_schedule_hint")}
        </p>
      ) : null}
    </section>
  );
}
