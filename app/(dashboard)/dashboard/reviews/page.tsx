import Link from "next/link";
import { Card, Panel } from "@/components/structure";
import { ChipLink, Eyebrow, RatingMarks } from "@/components/display";
import { DISPUTE_GROUNDS, REQUEST_WINDOW_DAYS } from "@/lib/reviews/eligibility";
import { parseTab, reviewsBoard, REVIEW_TABS, type ReviewTab } from "@/lib/reviews/board";
import { formatCount, formatDate } from "@/lib/format";
import { t } from "@/lib/i18n";
import { getNavBadges, requireSellerSeat, SellerPage } from "../_shell";
import { RequestPanel } from "./RequestPanel";
import { ReviewCard, type SellerReviewView } from "./ReviewCard";
import { postReply, raiseDispute, sendRequests } from "./actions";

/**
 * Board `11c` — the seller's reviews. Request, reply, dispute.
 *
 * Three actions, each bounded so that none becomes a way to shape the rating:
 * one request per buyer ever, one reply that cannot be edited, and a dispute
 * that succeeds on four grounds and no others. That is the board's own rule and
 * it is the shape of this page.
 *
 * ## Not gated by plan — `Q5`
 *
 * Nothing here reads an entitlement, deliberately. Reviews are reputation
 * rather than a paid feature, and gating a reply would punish the buyer who
 * wrote the review rather than the seller who did not pay: their question would
 * sit unanswered on a public page for want of a subscription. It is the one
 * seller surface in this product with no plan check on it, and that is a
 * decision rather than an omission.
 *
 * ## The header reconciles — criterion 5
 *
 * `4.8 · 126 reviews · 94 from an accepted quote, 32 from a confirmed enquiry`,
 * and those two numbers add to the first because they are computed from the
 * same rows the list beneath renders. The board's version counted 126 and
 * accounted for 94.
 */
export const metadata = { title: t("reviews.title") };
export const dynamic = "force-dynamic";

const DIMENSION_LABEL = {
  quotedAccurate: "reviews.dimension.quotedAccurate",
  onTime: "reviews.dimension.onTime",
  asDescribed: "reviews.dimension.asDescribed",
  responsiveness: "reviews.dimension.responsiveness",
} as const;

const PROVENANCE_TONE = { accepted_quote: "ok", verified_enquiry: "neutral" } as const;

export default async function SellerReviewsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const seat = await requireSellerSeat();
  const params = await searchParams;
  const tab: ReviewTab = parseTab(params["show"]);
  const now = new Date();

  const [board, badges] = await Promise.all([
    reviewsBoard(seat.actor, seat.businessId, tab, now),
    getNavBadges(seat.businessId),
  ]);

  const cards: SellerReviewView[] = board.reviews.map((review) => ({
    id: review.id,
    state: review.state,
    provenanceLabel: t(
      `reviewpage.provenance.${review.provenance}` as "reviewpage.provenance.accepted_quote",
    ),
    provenanceTone: PROVENANCE_TONE[review.provenance],
    overall: review.overall,
    body: review.body,
    buyerLabel: review.buyerLabel,
    /*
       A date, not "4 d 6 h ago".

       The board's own defect was a relative countdown — `21 DAYS TO REPLY` —
       that had expired against a page rendered a fortnight later. Every date on
       this card is measured against the same twenty-eight-day window, and a
       reader comparing "4 days ago" with "reply by 23 Sep" has to do the
       arithmetic the page is supposed to have done.
    */
    at: formatDate(review.createdAt),
    replyBy: formatDate(review.replyBy),
    replyOpen: review.replyOpen,
    dimensions: review.dimensions.map((dimension) => ({
      label: t(DIMENSION_LABEL[dimension.key]),
      score: dimension.score,
    })),
    sellerReply: review.sellerReply,
    repliedAt: review.repliedAt ? formatDate(review.repliedAt) : null,
    replyRemoved: review.replyRemoved,
    removalGround: review.removal?.ground
      ? t(`moderation.ground.${review.removal.ground}` as "moderation.ground.abuse")
      : null,
    removalNote: review.removal?.note ?? null,
    dispute: review.dispute
      ? {
          groundLabel: t(
            `reviews.dispute.ground.${review.dispute.ground}` as "reviews.dispute.ground.abuse",
          ),
          outcomeLabel: review.dispute.outcome
            ? t(
                `reviews.dispute.outcome.${review.dispute.outcome}` as "reviews.dispute.outcome.upheld",
              )
            : null,
          reason: review.dispute.reason,
          decidedAt: review.dispute.decidedAt ? formatDate(review.dispute.decidedAt) : null,
        }
      : null,
  }));

  return (
    <SellerPage
      seat={seat}
      badges={badges}
      activeHref="/dashboard/reviews"
      title={t("reviews.title")}
      meta={
        <span className="text-caption text-muted">
          {/*
             Criterion 5, and the board's largest arithmetic failure: it read
             "126 · 94 from a verified enquiry, 32 unverified" over a state that
             cannot exist. Two partitions here, both stated and both adding up —
             the split of what is on the page, and the rows that are off it.
          */}
          {board.average === null
            ? t("reviews.subtitle", { count: 0 })
            : [
                t("reviews.average", { score: board.average }),
                t("reviews.header_count", { count: board.total }),
                t("reviews.header_split", {
                  accepted: formatCount(board.fromAcceptedQuote),
                  enquiry: formatCount(board.fromConfirmedEnquiry),
                }),
                ...(board.counts.off_page > 0
                  ? [t("reviews.header_off_page", { count: board.counts.off_page })]
                  : []),
              ].join(" · ")}
        </span>
      }
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_21.5rem]">
        <div className="flex flex-col gap-4">
          {board.may.request ? (
            <Panel title={t("reviews.request_heading")}>
              {board.askable.length > 0 ? (
                <RequestPanel
                  buyers={board.askable.map((buyer) => ({
                    enquiryId: buyer.enquiryId,
                    ref: buyer.ref,
                    buyerName: buyer.buyerName,
                    acceptedAt: formatDate(buyer.acceptedAt),
                    channel: buyer.channel,
                  }))}
                  reachable={board.reachable}
                  sendRequests={sendRequests}
                />
              ) : board.hasAcceptedQuotes ? (
                <p className="max-w-[var(--measure-prose)] text-body-sm text-muted">
                  {t("reviews.request_exhausted", { days: REQUEST_WINDOW_DAYS })}
                </p>
              ) : (
                /*
                   §States: *"a seller with no accepted quotes cannot ask, and
                   should be told why rather than shown a dead button."* So this
                   is a sentence and a link to `3k`, where the quotes they have
                   sent are waiting, rather than a disabled control.
                */
                <div className="flex flex-col items-start gap-2">
                  <p className="max-w-[var(--measure-prose)] text-body-sm text-muted">
                    {t("reviews.request_no_quotes", { days: REQUEST_WINDOW_DAYS })}
                  </p>
                  <Link
                    href="/dashboard/quotes"
                    className="text-body-sm text-link underline underline-offset-2"
                  >
                    {t("reviews.request_no_quotes_link")}
                  </Link>
                </div>
              )}
            </Panel>
          ) : null}

          <section aria-labelledby="reviews-list-heading" className="flex flex-col gap-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="reviews-list-heading" className="text-h3 text-ink">
                {t("reviews.list_heading")}
                {board.needingReply > 0 ? (
                  <span className="ms-2 text-caption font-normal text-warn-ink">
                    {t("reviews.needs_reply_count", { count: board.needingReply })}
                  </span>
                ) : null}
              </h2>
              {board.reviews.length > 0 || board.counts.on_page > 0 ? (
                <ul className="flex flex-wrap gap-1.5">
                  {REVIEW_TABS.map((key) => (
                    <li key={key}>
                      {/*
                         Every chip carries its own count, and the counts come
                         from the same rows the list renders. A filter that
                         states no number is a filter a seller has to click to
                         find out is empty.
                      */}
                      <ChipLink
                        href={
                          key === "on_page"
                            ? "/dashboard/reviews"
                            : `/dashboard/reviews?show=${key}`
                        }
                        selected={board.tab === key}
                        size="sm"
                        dashed
                        count={formatCount(board.counts[key])}
                      >
                        {t(`reviews.tab.${key}` as "reviews.tab.on_page")}
                      </ChipLink>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>

            {board.counts.on_page + board.counts.off_page === 0 ? (
              /*
                 The state this board spends its first months in, and the
                 original had none. It is a page about earning reviews rather
                 than an empty table — criterion 11.
              */
              <Card padded>
                <h3 className="text-h3 text-ink">{t("reviews.empty_title")}</h3>
                <p className="mt-2 max-w-[var(--measure-prose)] text-body-sm text-muted">
                  {t("reviews.empty_body")}
                </p>
                {/*
                   Only where there is somebody to ask, and pointing at the
                   panel that is actually on screen. "Ask the buyers below" over
                   a page with no eligible buyers and the panel above it is two
                   errors in one sentence, on the state this board spends its
                   first months in.
                */}
                {board.may.request && board.reachable > 0 ? (
                  <p className="mt-2 max-w-[var(--measure-prose)] text-body-sm text-muted">
                    {t("reviews.empty_next", { count: board.reachable })}
                  </p>
                ) : null}
              </Card>
            ) : cards.length === 0 ? (
              <Card padded>
                <p className="text-body-sm text-muted">{t("reviews.none_in_filter")}</p>
              </Card>
            ) : (
              <>
                {cards.map((review) => (
                  <ReviewCard
                    key={review.id}
                    review={review}
                    mayReply={board.may.reply}
                    mayDispute={board.may.dispute}
                    postReply={postReply}
                    raiseDispute={raiseDispute}
                  />
                ))}
                <p className="max-w-[var(--measure-prose)] text-caption text-muted">
                  {t("reviews.not_deletable")}
                </p>
              </>
            )}
          </section>
        </div>

        <div className="flex flex-col gap-4">
          <Card padded>
            <Eyebrow as="h2">{t("reviews.dispute.rail_title")}</Eyebrow>
            <p className="mt-2 max-w-[var(--measure-prose)] text-body-sm text-body">
              {t("reviews.dispute.rail_body")}
            </p>
            {/*
               The rail explains the grounds and has no form on it — criterion 7.
               An ordered list, because the board numbers them 01–04 and because
               they are four separate grounds with separate evidence: the render
               that shipped merged abuse and private information into one row
               while the prose above it counted them as two.
            */}
            <ol className="mt-3 flex flex-col gap-2">
              {DISPUTE_GROUNDS.map((ground, index) => (
                <li key={ground} className="flex gap-2">
                  <span className="font-mono text-caption tabular-nums text-muted">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="text-body-sm text-body">
                    {t(`reviews.dispute.ground.${ground}` as "reviews.dispute.ground.abuse")}
                  </span>
                </li>
              ))}
            </ol>
            <p className="mt-3 max-w-[var(--measure-prose)] border-t border-line pt-3 text-caption text-muted">
              {t("reviews.dispute.not_a_ground")}
            </p>
            <p className="mt-2 max-w-[var(--measure-prose)] text-caption text-muted">
              {t("reviews.dispute.sla")}
            </p>
            {board.may.dispute ? null : (
              <p className="mt-2 max-w-[var(--measure-prose)] text-caption text-muted">
                {t("reviews.dispute.owner_only")}
              </p>
            )}
          </Card>

          <Card padded>
            <Eyebrow as="h2">{t("reviews.rated_on")}</Eyebrow>
            {board.total === 0 ? (
              <p className="mt-2 text-body-sm text-muted">{t("reviews.no_scores")}</p>
            ) : (
              <>
                <dl className="mt-3 flex flex-col gap-3">
                  {board.dimensions.map((dimension) => (
                    <div key={dimension.key}>
                      <div className="flex items-baseline justify-between gap-2">
                        <dt className="text-body-sm text-body">
                          {t(DIMENSION_LABEL[dimension.key])}
                          {/*
                             Criterion 4: the weakest line says so in words. The
                             board marked it with an amber bar and an amber
                             figure and nothing a reader who cannot separate the
                             ambers from the greens could use.
                          */}
                          {dimension.weakest ? (
                            <span className="ms-1.5 text-caption text-warn-ink">
                              · {t("reviews.weakest")}
                            </span>
                          ) : null}
                        </dt>
                        <dd className="flex items-center gap-2">
                          <RatingMarks
                            value={dimension.average}
                            size="sm"
                            label={t("reviews.rated", { score: dimension.average })}
                          />
                          <span className="font-mono text-body-sm tabular-nums text-ink">
                            {dimension.average.toFixed(1)}
                          </span>
                        </dd>
                      </div>
                      {dimension.themes.map((theme) => (
                        <p
                          key={theme.key}
                          className="mt-1 max-w-[var(--measure-prose)] text-caption text-muted"
                        >
                          {t("reviews.theme", {
                            count: theme.count,
                            theme: t(
                              `reviews.theme.${theme.key}` as "reviews.theme.brand_substitution",
                            ),
                          })}{" "}
                          {t("reviews.theme_note")}
                        </p>
                      ))}
                    </div>
                  ))}
                </dl>
                <p className="mt-3 max-w-[var(--measure-prose)] border-t border-line pt-3 text-caption text-muted">
                  {t("reviews.overall_is_answered")}
                </p>
              </>
            )}
          </Card>

          <Card padded>
            <Eyebrow as="h2">{t("reviews.more_title")}</Eyebrow>
            <p className="mt-2 max-w-[var(--measure-prose)] text-body-sm text-muted">
              {t("reviews.more_body", { days: REQUEST_WINDOW_DAYS })}
            </p>
          </Card>
        </div>
      </div>
    </SellerPage>
  );
}
