"use client";

import { useState, useTransition } from "react";
import { Button, Radio, RadioGroup, Textarea } from "@/components/primitives";
import { DISPUTE_GROUNDS } from "@/lib/reviews/eligibility";
import { t } from "@/lib/i18n";
import type { ReviewActionResult } from "./actions";

/**
 * The dispute, started from a review. Criteria 6 and 7.
 *
 * **Nothing is pre-selected.** The board drew a radio already sitting on the
 * first ground, for a dispute that had not been started against a review that
 * had not been chosen — the same defect as `11h`'s three "you pick which"
 * lines: a choice presented as already made, on a control that accuses a named
 * customer. `ground` starts empty and the button is disabled until somebody
 * picks one.
 *
 * **The four are `DISPUTE_GROUNDS`**, the same array the rail renders and the
 * same array `openDispute` accepts. Criterion 6 is that those three are one
 * list, and the cheapest way to keep it true is for there to be one list.
 */
export function DisputeForm({
  reviewId,
  buyerLabel,
  reviewedOn,
  raiseDispute,
  onDone,
  onCancel,
}: {
  reviewId: string;
  /** Names the landmark, so a page of these is navigable. See `ReviewCard`. */
  buyerLabel: string;
  reviewedOn: string;
  raiseDispute: (formData: FormData) => Promise<ReviewActionResult>;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [ground, setGround] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="mt-3 rounded-card border border-line-strong bg-surface p-3"
      aria-label={t("reviews.dispute.form", { buyer: buyerLabel, date: reviewedOn })}
      action={(formData) => {
        setError(null);
        startTransition(async () => {
          const result = await raiseDispute(formData);
          if (result.ok) onDone();
          else setError(result.error);
        });
      }}
    >
      <input type="hidden" name="reviewId" value={reviewId} />
      <h3 className="text-body-sm text-ink">{t("reviews.dispute.heading")}</h3>

      <div className="mt-2">
        <RadioGroup
          legend={t("reviews.dispute.ground_legend")}
          hint={t("reviews.dispute.ground_hint")}
        >
          {DISPUTE_GROUNDS.map((value) => (
            <Radio
              key={value}
              name="ground"
              value={value}
              checked={ground === value}
              onChange={(event) => setGround(event.target.value)}
              label={t(`reviews.dispute.ground.${value}` as "reviews.dispute.ground.abuse")}
            />
          ))}
        </RadioGroup>
      </div>

      <label className="mt-3 flex flex-col gap-1">
        <span className="text-body-sm text-ink">{t("reviews.dispute.detail_label")}</span>
        <span className="text-caption text-muted">{t("reviews.dispute.detail_hint")}</span>
        <Textarea name="detail" rows={3} required minLength={20} />
      </label>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" loading={pending} disabled={ground === ""}>
          {pending ? t("reviews.dispute.sending") : t("reviews.dispute.submit")}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          {t("reviews.dispute.cancel")}
        </Button>
        <p className="text-caption text-muted">{t("reviews.dispute.sla")}</p>
      </div>

      {error ? (
        <p role="alert" className="mt-2 text-caption text-bad-ink">
          {error}
        </p>
      ) : null}
    </form>
  );
}
