"use client";

import { useState, useTransition } from "react";
import { Button, Input } from "@/components/primitives";
import { Alert } from "@/components/display";
import { ModerationRow } from "@/components/domain/ModerationRow";
import { t } from "@/lib/i18n";
import type { DisputeGround } from "@/lib/reviews/eligibility";
import type { ActionResult } from "./actions";

/**
 * Board 11c `B5` — the review-dispute queue, on 4h.
 *
 * The board promised a decision in about two working days and named no queue.
 * This is it, beside the conduct reports rather than mixed into them: the row
 * shapes are different in every field, so they render as two lists on one page.
 *
 * ## Two outcomes and the reason is not optional
 *
 * The queue's whole promise to a seller, in the seller's own copy, is *"the
 * outcome and the reason are logged and sent to you"*. So the reason box is the
 * gate on both buttons rather than something to fill in afterwards.
 *
 * ## Upholding is not offered to a seat that cannot do it
 *
 * Upholding removes the review, and `review.remove` is ops lead alone. A
 * moderator gets the refusal control and a line saying where the other decision
 * lives — not a button that submits and comes back with a no.
 *
 * Both halves, as board 4i's own spec puts it: *"a hidden button is a UI
 * opinion and a server action is a URL."* `resolveDispute` checks the
 * capability before it opens a transaction, and this decides what to draw.
 */

export interface DisputeQueueRow {
  id: string;
  businessName: string;
  businessSlug: string;
  ground: DisputeGround;
  detail: string;
  reviewBody: string;
  reviewOverall: number;
  buyerName: string | null;
  fromAcceptedQuote: boolean;
  createdAt: string;
  ageDays: number;
}

const MIN_REASON = 4;

export function DisputeQueue({
  rows,
  decide,
  mayUphold,
}: {
  rows: readonly DisputeQueueRow[];
  decide: (formData: FormData) => Promise<ActionResult>;
  /** `review.remove` — ops lead. A moderator may refuse one and not grant one. */
  mayUphold: boolean;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  const ready = reason.trim().length >= MIN_REASON && !pending;

  function send(disputeId: string, outcome: "upheld" | "refused") {
    const form = new FormData();
    form.set("disputeId", disputeId);
    form.set("outcome", outcome);
    form.set("reason", reason);
    startTransition(async () => {
      const outcomeResult = await decide(form);
      setResult(outcomeResult);
      if (outcomeResult.ok) {
        setOpen(null);
        setReason("");
      }
    });
  }

  if (rows.length === 0) {
    return <p className="text-caption text-muted">{t("admin.disputes.empty")}</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col">
        {rows.map((row) => (
          <ModerationRow
            key={row.id}
            as="li"
            kindLabel={t("admin.disputes.kind")}
            reference={`${row.reviewOverall}/5`}
            subjectName={row.businessName}
            subjectHref={`/b/${row.businessSlug}`}
            quoted={row.reviewBody}
            groundLabel={t(
              `moderation.ground.${row.ground}` as "moderation.ground.abuse",
            )}
            raisedAt={t("admin.disputes.age", { date: row.createdAt, days: row.ageDays })}
            raisedByLabel={t("admin.disputes.raised_by", { name: row.businessName })}
            actions={
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setOpen(row.id);
                  setReason("");
                  setResult(null);
                }}
              >
                {t("admin.disputes.decide")}
              </Button>
            }
          />
        ))}
      </ul>

      {open && (
        <div className="flex flex-col gap-3 rounded-card border border-line bg-card p-3">
          {/*
             The seller's case and the one fact that most often answers it.

             A `no_traceable_enquiry` dispute against a review attached to a
             quote this seller's own account accepted has answered itself, and a
             moderator should not have to open two other screens to find that
             out. Derived from the enquiry rather than stored on the review —
             `provenanceOf`, the same read board 1m badges the buyer with.
          */}
          <p className="max-w-prose text-body-sm text-prose">
            {rows.find((row) => row.id === open)?.detail}
          </p>
          <p className="text-caption text-muted">
            {rows.find((row) => row.id === open)?.fromAcceptedQuote
              ? t("admin.disputes.from_accepted_quote")
              : t("admin.disputes.from_confirmed_enquiry")}
          </p>

          <div className="flex flex-wrap items-end gap-2">
            <label className="flex min-w-64 flex-1 flex-col gap-1">
              <span className="text-body-sm text-ink">{t("admin.review.reason_label")}</span>
              <Input value={reason} onChange={(event) => setReason(event.target.value)} />
            </label>
            {mayUphold ? (
              <Button disabled={!ready} onClick={() => send(open, "upheld")}>
                {t("admin.disputes.uphold")}
              </Button>
            ) : null}
            <Button
              variant={mayUphold ? "secondary" : "primary"}
              disabled={!ready}
              onClick={() => send(open, "refused")}
            >
              {t("admin.disputes.refuse")}
            </Button>
            <Button variant="ghost" onClick={() => setOpen(null)}>
              {t("action.cancel")}
            </Button>
          </div>

          <p className="text-caption text-muted">
            {mayUphold ? t("admin.disputes.note") : t("admin.disputes.refuse_only")}
          </p>
        </div>
      )}

      {result && (
        <Alert
          tone={result.ok ? "ok" : "bad"}
          live={result.ok ? "polite" : "assertive"}
          {...(result.ok ? {} : { fix: t("admin.review.reason_hint") })}
        >
          {result.ok ? result.message : result.error}
        </Alert>
      )}
    </div>
  );
}
