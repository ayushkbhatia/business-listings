"use client";

import { useState, useTransition } from "react";
import { Button, Checkbox, Radio, RadioGroup, Textarea } from "@/components/primitives";
import { t } from "@/lib/i18n";
import { postReview } from "../actions";

/**
 * Board 10f — four dimensions plus overall.
 *
 * Radios rather than stars. A star widget is five buttons pretending to be one
 * control: it is hard to reach by keyboard, ambiguous to a screen reader, and
 * on a phone in a warehouse it is five small targets where one row of five
 * would do. A radio group is exactly this control, and the platform already
 * knows how to announce it.
 */
const DIMENSIONS = ["quotedAccurate", "onTime", "asDescribed", "responsiveness"] as const;
const SCORES = [1, 2, 3, 4, 5] as const;

export function ReviewForm({
  enquiryId,
  businessId,
  token,
  editableDays,
}: {
  enquiryId: string;
  /**
   * The supplier being reviewed, as the gate resolved it.
   *
   * Carried through so a fan-out that drew replies from several suppliers
   * writes the review against the one the page said it was about. The server
   * re-checks it: an id the enquiry cannot account for is refused there, not
   * here.
   */
  businessId?: string;
  token: string | null;
  editableDays: number;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      action={(formData) => {
        setError(null);
        startTransition(async () => {
          const result = await postReview(formData);
          if (result && !result.ok) setError(result.error);
        });
      }}
      className="space-y-5"
    >
      <input type="hidden" name="enquiryId" value={enquiryId} />
      {businessId ? <input type="hidden" name="businessId" value={businessId} /> : null}
      {token ? <input type="hidden" name="t" value={token} /> : null}

      <Scale name="overall" label={t("review.overall")} />

      <fieldset>
        <legend className="text-body-sm text-ink">{t("reviews.dimension_scores")}</legend>
        <div className="mt-2 space-y-4">
          {DIMENSIONS.map((dimension) => (
            <Scale
              key={dimension}
              name={dimension}
              label={t(`review.dimension.${dimension}` as "review.dimension.onTime")}
            />
          ))}
        </div>
      </fieldset>

      <div>
        <label htmlFor="body" className="mb-1.5 block text-body-sm text-ink">
          {t("review.body")}
        </label>
        <Textarea
          id="body"
          name="body"
          rows={5}
          required
          minLength={20}
          placeholder={t("review.body_placeholder")}
          aria-describedby="body-hint"
        />
        <p id="body-hint" className="mt-1.5 text-caption text-muted">
          {t("review.body_hint")}
        </p>
      </div>

      <div>
        <Checkbox name="showCompanyName" defaultChecked label={t("review.show_company")} />
        <p className="mt-1 ps-7 text-caption text-muted">{t("review.show_company_hint")}</p>
      </div>

      {error ? (
        <p role="alert" className="rounded-ctl border border-bad-line bg-bad-surface px-3 py-2 text-body-sm text-bad-ink">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-caption text-muted">{t("review.editable", { days: editableDays })}</p>
        <Button type="submit" loading={pending}>
          {pending ? t("review.submitting") : t("review.submit")}
        </Button>
      </div>
    </form>
  );
}

/** One to five, as a radio group rather than as five buttons pretending to be one. */
function Scale({ name, label }: { name: string; label: string }) {
  return (
    <RadioGroup legend={label} orientation="horizontal">
      {SCORES.map((score) => (
        <Radio
          key={score}
          name={name}
          value={String(score)}
          required
          label={String(score)}
          aria-label={t("review.rating_label", { dimension: label, count: score })}
        />
      ))}
    </RadioGroup>
  );
}
