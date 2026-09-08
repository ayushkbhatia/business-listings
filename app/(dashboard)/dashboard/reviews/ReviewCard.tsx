"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Textarea } from "@/components/primitives";
import { Card } from "@/components/structure";
import { RatingMarks, StatusBadge } from "@/components/display";
import { t } from "@/lib/i18n";
import type { ReviewCardState } from "@/lib/reviews/eligibility";
import type { ReviewActionResult } from "./actions";
import { DisputeForm } from "./DisputeForm";

/**
 * One review, in whichever of six states it is actually in.
 *
 * The board drew three — awaiting a reply, replied, and an unverified one that
 * cannot exist — and left three that can. `removed` and `held` were both
 * reachable before this board and neither was drawn; `window_closed` is `Q6`
 * arriving, and `under_dispute` is `B5`'s.
 *
 * The state comes from `cardStateOf`, which derives it from the row. There is
 * no state machine here to fall out of step with the columns underneath it.
 */

export interface SellerReviewView {
  id: string;
  state: ReviewCardState;
  provenanceLabel: string;
  provenanceTone: "ok" | "neutral";
  overall: number;
  body: string;
  buyerLabel: string;
  at: string;
  replyBy: string;
  replyOpen: boolean;
  dimensions: { label: string; score: number }[];
  sellerReply: string | null;
  repliedAt: string | null;
  replyRemoved: boolean;
  removalGround: string | null;
  removalNote: string | null;
  /** Open, or decided and still worth showing. Null when there has never been one. */
  dispute: {
    groundLabel: string;
    outcomeLabel: string | null;
    reason: string | null;
    decidedAt: string | null;
  } | null;
}

export interface ReviewCardProps {
  review: SellerReviewView;
  mayReply: boolean;
  mayDispute: boolean;
  /*
     The two actions, injected rather than imported.

     The same shape `ReportTable` and `ReviewList` already use on the console
     side, and the reason is the gallery: a card that reaches for its own server
     action can only be rendered on the page that owns it, and this one has six
     states that each need looking at. A server action passed as a prop is a
     reference the framework serialises, not a function crossing the boundary —
     which is the thing this repo gets wrong most often and is not this.
  */
  postReply: (formData: FormData) => Promise<ReviewActionResult>;
  raiseDispute: (formData: FormData) => Promise<ReviewActionResult>;
}

export function ReviewCard({
  review,
  mayReply,
  mayDispute,
  postReply,
  raiseDispute,
}: ReviewCardProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [disputing, setDisputing] = useState(false);

  const gone = review.state === "removed" || review.state === "held";
  const canReplyNow = mayReply && review.replyOpen;
  /*
     The control is offered only where the service would accept it.

     A review already under dispute cannot be disputed again — the same case
     decided twice, on a queue whose promise is one answer in two working days —
     and `canDisputeReview` refuses it. A button that opens a form the service
     will refuse is the shape this board's own render got wrong in the other
     direction.
  */
  const openDispute = review.dispute?.outcomeLabel === null ? review.dispute : null;
  /*
     A review already under dispute cannot be disputed again — the same case
     decided twice — but one that was **refused** can be, on a different ground
     and with different evidence. `canDisputeReview` allows exactly that, and
     the constraint underneath is on *open* rather than on ever.
  */
  const canDisputeNow = mayDispute && openDispute === null && !gone;

  return (
    <Card padded as="article">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="flex flex-wrap items-center gap-2">
          <span className="text-body-sm text-ink">{review.buyerLabel}</span>
          {/*
             The same words the buyer reads on the storefront, from the same
             `reviewpage.provenance.*` strings. Criterion 3 asks for one
             vocabulary across both surfaces, and two catalogues of synonyms is
             how that stops being true six months later.
          */}
          <StatusBadge tone={review.provenanceTone} size="sm" shape="chip">
            {review.provenanceLabel}
          </StatusBadge>
          {gone ? null : (
            <RatingMarks
              value={review.overall}
              size="sm"
              label={t("reviews.rated", { score: review.overall })}
            />
          )}
        </p>
        <span className="text-caption uppercase tracking-wide text-muted">
          {review.at}
          {review.replyOpen ? ` · ${t("reviews.reply_by", { date: review.replyBy })}` : ""}
        </span>
      </div>

      {review.state === "removed" ? (
        <div className="mt-2">
          <StatusBadge tone="neutral" size="sm" shape="chip">
            {t("reviews.removed")}
          </StatusBadge>
          {/*
             The reason and not the words. A supplier who cannot see that a
             review was taken down learns nothing from it, so the row stays and
             says so — but one ground for removal is that the text carried
             private information about a third party, and re-showing it here
             would be the platform keeping a copy on the page it removed it from.
          */}
          <p className="mt-2 max-w-[var(--measure-prose)] text-body-sm text-muted">
            {review.removalGround ? `${review.removalGround} · ` : ""}
            {review.removalNote ?? ""}
          </p>
        </div>
      ) : review.state === "held" ? (
        <div className="mt-2">
          <StatusBadge tone="warn" size="sm" shape="chip">
            {t("reviews.held")}
          </StatusBadge>
          <p className="mt-2 max-w-[var(--measure-prose)] text-body-sm text-muted">
            {t("reviews.held_body")}
          </p>
        </div>
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

      {openDispute ? (
        <div className="mt-3 rounded-card border border-warn-line bg-warn-surface p-3">
          <StatusBadge tone="warn" size="sm" shape="chip">
            {t("reviews.dispute.open")}
          </StatusBadge>
          {/*
             `Q3`: buyers see a disputed review unchanged, and the seller is told
             so here rather than left to assume the opposite. Hiding it during a
             dispute would make disputing a way to take a review down for two
             days at a time, which is the takedown tool the four grounds exist
             to stop being necessary.
          */}
          <p className="mt-1.5 max-w-[var(--measure-prose)] text-caption text-warn-ink">
            {t("reviews.dispute.open_body", { ground: openDispute.groundLabel })}
          </p>
        </div>
      ) : review.dispute?.outcomeLabel && !gone ? (
        /*
           A decision the seller is owed on the page as well as in the email.

           §States: a refused dispute leaves "the reason logged and emailed" —
           and a seller who raised one, waited the two working days and came back
           to a page that looked exactly as it did before has been told nothing.
           The moderator's own words, because those are the reason.
        */
        <div className="mt-3 rounded-card border border-line bg-surface p-3">
          <StatusBadge tone="neutral" size="sm" shape="chip">
            {t("reviews.dispute.decided", {
              outcome: review.dispute.outcomeLabel,
              date: review.dispute.decidedAt ?? "",
            })}
          </StatusBadge>
          <p className="mt-1.5 max-w-[var(--measure-prose)] text-caption text-muted">
            {review.dispute.groundLabel} · {review.dispute.reason ?? ""}
          </p>
          <p className="mt-1.5 max-w-[var(--measure-prose)] text-caption text-muted">
            {t("reviews.dispute.refused_body")}
          </p>
        </div>
      ) : null}

      {review.sellerReply !== null ? (
        review.replyRemoved ? (
          <div className="mt-3 border-s-2 border-line-strong ps-3">
            <StatusBadge tone="neutral" size="sm" shape="chip">
              {t("reviews.reply_removed")}
            </StatusBadge>
            <p className="mt-1.5 max-w-[var(--measure-prose)] text-caption text-muted">
              {t("reviews.reply_removed_body")}
            </p>
          </div>
        ) : (
          <div className="mt-3 border-s-2 border-line-strong ps-3">
            <p className="text-caption text-muted">
              {t("reviews.replied", { when: review.repliedAt ?? "" })}
            </p>
            <p className="mt-0.5 max-w-[var(--measure-prose)] text-body-sm text-prose">
              {review.sellerReply}
            </p>
          </div>
        )
      ) : canReplyNow ? (
        <form
          className="mt-3 rounded-card border border-line bg-surface p-3"
          /*
             Named, and named after *this* review.

             A `<form>` is a landmark, and this page renders one per unanswered
             review — so without a name a screen reader's landmark list reads
             "form, form, form, form" and none of them says which buyer it
             answers. `tests/e2e/landmarks.spec.ts` catches the duplicates on
             /dev/gallery; the page they were duplicated on is this one.
          */
          aria-label={t("reviews.reply_form", { buyer: review.buyerLabel, date: review.at })}
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
          <p className="text-caption text-muted" id={`reply-heading-${review.id}`}>
            {t("reviews.reply_heading")}
          </p>
          <div className="mt-2">
            <Textarea
              name="body"
              rows={3}
              required
              aria-label={t("reviews.reply_label")}
              placeholder={t("reviews.reply_placeholder")}
            />
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2">
              <Button type="submit" size="sm" loading={pending}>
                {pending ? t("reviews.replying") : t("reviews.reply")}
              </Button>
              {canDisputeNow && !disputing ? (
                <Button type="button" size="sm" variant="ghost" onClick={() => setDisputing(true)}>
                  {t("reviews.dispute.start")}
                </Button>
              ) : null}
            </div>
            <p className="text-caption text-muted">
              {t("reviews.reply_consequence", { date: review.replyBy })}
            </p>
          </div>
          {error ? (
            <p role="alert" className="mt-2 text-caption text-bad-ink">
              {error}
            </p>
          ) : null}
        </form>
      ) : review.state === "window_closed" ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-card border border-line bg-surface p-3">
          <div>
            <p className="text-body-sm text-ink">
              {t("reviews.reply_closed", { date: review.replyBy })}
            </p>
            <p className="mt-0.5 max-w-[var(--measure-prose)] text-caption text-muted">
              {t("reviews.reply_closed_body")}
            </p>
          </div>
          {canDisputeNow && !disputing ? (
            <Button type="button" size="sm" variant="ghost" onClick={() => setDisputing(true)}>
              {t("reviews.dispute.start")}
            </Button>
          ) : null}
        </div>
      ) : canDisputeNow && !disputing ? (
        /*
           A replied review, inside or outside its window, can still be
           disputed. §States is explicit that a refused dispute leaves the reply
           available if the window is open, which only makes sense if the two
           are independent — and the order that produces this case is ordinary:
           a seller answers politely, then finds out who wrote it.
        */
        <div className="mt-3">
          <Button type="button" size="sm" variant="ghost" onClick={() => setDisputing(true)}>
            {t("reviews.dispute.start")}
          </Button>
        </div>
      ) : null}

      {/*
         The dispute starts here and only here — criterion 7. There is no form
         on the rail; the rail explains the grounds and this is the control that
         carries a review id.
      */}
      {disputing ? (
        <DisputeForm
          reviewId={review.id}
          buyerLabel={review.buyerLabel}
          reviewedOn={review.at}
          raiseDispute={raiseDispute}
          onDone={() => {
            setDisputing(false);
            router.refresh();
          }}
          onCancel={() => setDisputing(false)}
        />
      ) : null}
    </Card>
  );
}
