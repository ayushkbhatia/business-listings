import { Card, Panel } from "@/components/structure";
import { prisma } from "@/lib/db/client";
import { firstNameOf } from "@/lib/db/queries/seller-visibility";
import { REQUEST_WINDOW_DAYS } from "@/lib/reviews/eligibility";
import { formatDate, formatRelative } from "@/lib/format";
import { t } from "@/lib/i18n";
import { getNavBadges, requireSellerSeat, SellerPage } from "../_shell";
import { AskRow, ReviewCard, type AskableBuyer, type SellerReviewView } from "./ReviewCards";

/**
 * Board 11c — the seller's reviews.
 *
 * Removed reviews stay on this page, marked and with their reason. A supplier
 * who cannot see that one was taken down cannot learn anything from it, and
 * hiding it would look like the review had never existed — which is the thing
 * a removal must never resemble.
 */
export const metadata = { title: t("reviews.title") };
export const dynamic = "force-dynamic";

const DIMENSIONS = [
  ["quotedAccurate", "review.dimension.quotedAccurate"],
  ["onTime", "review.dimension.onTime"],
  ["asDescribed", "review.dimension.asDescribed"],
  ["responsiveness", "review.dimension.responsiveness"],
] as const;

export default async function SellerReviewsPage() {
  const seat = await requireSellerSeat();
  const now = new Date();
  const windowStart = new Date(now.getTime() - REQUEST_WINDOW_DAYS * 86_400_000);

  const [reviews, badges, askable, alreadyAsked] = await Promise.all([
    prisma.review.findMany({
      where: { businessId: seat.businessId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        overall: true,
        quotedAccurate: true,
        onTime: true,
        asDescribed: true,
        responsiveness: true,
        body: true,
        showCompanyName: true,
        sellerReply: true,
        sellerRepliedAt: true,
        removedAt: true,
        heldAt: true,
        removalReason: true,
        createdAt: true,
        buyer: { select: { fullName: true, buyerCompany: { select: { name: true } } } },
      },
    }),
    getNavBadges(seat.businessId),
    // Buyers who accepted inside the window and have not written one.
    prisma.enquiry.findMany({
      where: {
        contactReleasedToBusinessId: seat.businessId,
        contactReleasedAt: { gte: windowStart },
        review: null,
      },
      orderBy: { contactReleasedAt: "desc" },
      select: {
        id: true,
        ref: true,
        buyerId: true,
        contactReleasedAt: true,
        buyer: { select: { fullName: true } },
      },
    }),
    prisma.reviewRequest.findMany({
      where: { businessId: seat.businessId },
      select: { buyerId: true },
    }),
  ]);

  const askedBuyerIds = new Set(alreadyAsked.map((r) => r.buyerId));
  const toAsk: AskableBuyer[] = askable
    .filter((enquiry) => !askedBuyerIds.has(enquiry.buyerId))
    .map((enquiry) => ({
      enquiryId: enquiry.id,
      ref: enquiry.ref,
      buyerFirstName: firstNameOf(enquiry.buyer.fullName),
      acceptedAt: enquiry.contactReleasedAt ? formatDate(enquiry.contactReleasedAt) : "",
    }));

  /*
     The seller's average is the buyer's average.

     Removed and held are both out of it. A held review is off the public page
     while a decision is made, and a dashboard that kept counting it would show
     the seller a figure their own storefront disagrees with — which is the
     shared-record failure, one surface removed.
  */
  const visible = reviews.filter(
    (review) => review.removedAt === null && review.heldAt === null,
  );
  const average =
    visible.length === 0
      ? null
      : Math.round((visible.reduce((sum, r) => sum + r.overall, 0) / visible.length) * 10) / 10;

  const cards: SellerReviewView[] = reviews.map((review) => ({
    id: review.id,
    overall: review.overall,
    body: review.body,
    // The buyer's own choice about their name. Off means a buyer with no name
    // shown — never their phone, never their email. The provenance badge is a
    // separate thing and is not the buyer's to switch off.
    buyerLabel: review.showCompanyName
      ? (review.buyer.buyerCompany?.name ?? firstNameOf(review.buyer.fullName))
      : firstNameOf(review.buyer.fullName),
    at: formatRelative(review.createdAt, { now }),
    dimensions: DIMENSIONS.map(([key, labelKey]) => ({
      label: t(labelKey),
      score: review[key],
    })),
    sellerReply: review.sellerReply,
    repliedAt: review.sellerRepliedAt ? formatRelative(review.sellerRepliedAt, { now }) : null,
    removed: review.removedAt !== null,
    removalReason: review.removalReason,
  }));

  return (
    <SellerPage
      seat={seat}
      badges={badges}
      activeHref="/dashboard/reviews"
      title={t("reviews.title")}
      meta={
        <span className="text-caption text-muted">
          {t("reviews.subtitle", { count: visible.length })}
          {average !== null ? ` · ${t("reviews.average", { score: average })}` : ""}
        </span>
      }
    >
      <div className="space-y-[var(--gutter)]">
        {cards.length === 0 ? (
          <Card padded>
            <h2 className="text-h3 text-ink">{t("reviews.empty_title")}</h2>
            <p className="mt-2 max-w-[var(--measure-prose)] text-body-sm text-muted">
              {t("reviews.empty_body")}
            </p>
          </Card>
        ) : (
          <div className="space-y-[var(--gutter)]">
            {cards.map((review) => (
              <ReviewCard key={review.id} review={review} />
            ))}
            {/* Said, rather than left as a missing button somebody hunts for. */}
            <p className="max-w-[var(--measure-prose)] text-caption text-muted">
              {t("reviews.not_deletable")}
            </p>
          </div>
        )}

        <Panel
          title={t("reviews.request_heading")}
          description={t("reviews.request_body", { days: REQUEST_WINDOW_DAYS })}
        >
          {toAsk.length === 0 ? (
            <p className="text-body-sm text-muted">{t("reviews.request_none")}</p>
          ) : (
            <ul className="rounded-card border border-line">
              {toAsk.map((buyer) => (
                <AskRow key={buyer.enquiryId} buyer={buyer} />
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </SellerPage>
  );
}
