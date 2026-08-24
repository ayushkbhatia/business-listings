"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Textarea } from "@/components/primitives";
import { Card } from "@/components/structure";
import { StatusBadge } from "@/components/display/StatusBadge";
import { t } from "@/lib/i18n";
import { askForReview, postReply } from "./actions";

/**
 * Board 11c — the seller's side of reviews.
 *
 * Two controls and one absence. A seller may reply once and ask once; there is
 * no remove button, and the copy says why rather than leaving somebody hunting
 * for one.
 */
export interface SellerReviewView {
  id: string;
  overall: number;
  body: string;
  buyerLabel: string;
  at: string;
  dimensions: { label: string; score: number }[];
  sellerReply: string | null;
  repliedAt: string | null;
  removed: boolean;
  removalReason: string | null;
}

export function ReviewCard({ review }: { review: SellerReviewView }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <Card padded as="article">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="flex items-baseline gap-2">
          <span className="font-mono text-body tabular-nums text-ink">
            {t("reviews.average", { score: review.overall })}
          </span>
          {review.removed ? (
            <StatusBadge tone="neutral" size="sm" shape="chip">
              {t("reviews.removed")}
            </StatusBadge>
          ) : null}
        </p>
        <span className="text-caption text-muted">
          {review.buyerLabel} · {review.at}
        </span>
      </div>

      {review.removed ? (
        <p className="mt-2 text-body-sm text-muted">
          {t("reviews.removed_reason", { reason: review.removalReason ?? "" })}
        </p>
      ) : (
        <>
          <p className="mt-2 max-w-[var(--measure-prose)] text-body-sm text-prose">{review.body}</p>

          <dl className="mt-3 grid gap-x-4 gap-y-1 sm:grid-cols-2">
            {review.dimensions.map((dimension) => (
              <div key={dimension.label} className="flex items-baseline justify-between gap-2">
                <dt className="text-caption text-muted">{dimension.label}</dt>
                <dd className="font-mono text-caption tabular-nums text-ink">{dimension.score}</dd>
              </div>
            ))}
          </dl>
        </>
      )}

      {review.sellerReply ? (
        <div className="mt-3 border-s-2 border-line-strong ps-3">
          <p className="text-body-sm text-prose">{review.sellerReply}</p>
          <p className="mt-0.5 text-caption text-muted">
            {t("reviews.replied", { when: review.repliedAt ?? "" })}
          </p>
        </div>
      ) : review.removed ? null : (
        <form
          className="mt-3 space-y-2"
          action={(formData) => {
            setError(null);
            startTransition(async () => {
              const result = await postReply(formData);
              if (result.ok) router.refresh();
              else setError(result.error);
            });
          }}
        >
          <input type="hidden" name="reviewId" value={review.id} />
          <Textarea
            name="body"
            rows={3}
            required
            aria-label={t("reviews.reply_label")}
            placeholder={t("reviews.reply_placeholder")}
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-caption text-muted">{t("reviews.reply_once")}</p>
            <Button type="submit" size="sm" loading={pending}>
              {pending ? t("reviews.replying") : t("reviews.reply")}
            </Button>
          </div>
          {error ? (
            <p role="alert" className="text-caption text-bad-ink">
              {error}
            </p>
          ) : null}
        </form>
      )}
    </Card>
  );
}

export interface AskableBuyer {
  enquiryId: string;
  ref: string;
  buyerFirstName: string;
  acceptedAt: string;
}

export function AskRow({ buyer }: { buyer: AskableBuyer }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2 last:border-b-0">
      <span>
        <span className="text-body-sm text-ink">{buyer.buyerFirstName}</span>
        <span className="ms-2 font-mono text-caption text-muted">{buyer.ref}</span>
        <span className="ms-2 text-caption text-muted">{buyer.acceptedAt}</span>
        {error ? (
          <span role="alert" className="ms-2 text-caption text-bad-ink">
            {error}
          </span>
        ) : null}
      </span>
      <form
        action={(formData) => {
          setError(null);
          startTransition(async () => {
            const result = await askForReview(formData);
            if (result.ok) router.refresh();
            else setError(result.error);
          });
        }}
      >
        <input type="hidden" name="enquiryId" value={buyer.enquiryId} />
        <Button type="submit" size="sm" variant="secondary" loading={pending}>
          {pending ? t("reviews.request_sending") : t("reviews.request_send", { name: buyer.buyerFirstName })}
        </Button>
      </form>
    </li>
  );
}
