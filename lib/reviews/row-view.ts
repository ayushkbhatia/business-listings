import type { ReviewCardProps } from "@/components/domain/ReviewCard";
import { formatDate, formatDecimal } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { Provenance } from "./eligibility";

/**
 * One review as board 1m's row presents it, from plain values.
 *
 * Pure and client-safe, and the only mapping from a review to `ReviewCard`'s
 * props: `/b/:slug/reviews`, the closed notice (11i) and board 10f's *How it
 * will appear* preview all call it. The preview is the reason it moved out of
 * `_row.tsx` — a preview built from its own copy of this mapping is a promise
 * about a rendering it does not share, and the first change to either would
 * make the buyer's preview a picture of a different page.
 */

export const PROVENANCE_TONE = {
  accepted_quote: "ok",
  verified_enquiry: "neutral",
} as const satisfies Record<Provenance, "ok" | "neutral">;

/**
 * The byline. The buyer's own registered company name, suffix and all.
 *
 * Board 1m leaves this alone deliberately: the display-name rule governs
 * *seller* identity, where a legal name and a trading name genuinely differ and
 * a buyer who reads one lands on the other. Buyers have no display-name field,
 * so stripping a suffix off theirs would be inventing data about a company that
 * did not ask us to.
 *
 * With no company on file it falls to the anonymous label rather than to the
 * person's name. "Show my company name" is consent to publish a company; a sole
 * trader who ticked it did not thereby agree to have their own name on a public
 * page.
 */
export function reviewAuthor(showCompanyName: boolean, companyName: string | null | undefined): string {
  return showCompanyName && companyName ? companyName : t("storefront.review_anonymous");
}

export interface ReviewRowValues {
  id: string;
  author: string;
  overall: number;
  createdAt: Date;
  provenance: Provenance;
  body: string;
  photos: readonly { id: string; url: string; alt: string | null }[];
  sellerReply: string | null;
  /** Board 11c `B4`: a reply staff took down. Its text is never rendered. */
  replyRemoved: boolean;
  sellerName: string;
}

export function reviewRowProps(review: ReviewRowValues): ReviewCardProps {
  return {
    as: "li",
    variant: "row",
    anchorId: `review-${review.id}`,
    author: review.author,
    /*
       `formatDecimal`, not `formatRating`: one review's score is an integer one
       to five, and "Rated 5.0 out of 5" reads as a measurement of something that
       was never measured. The aggregate above the list is the decimal, and it
       uses the other one.
    */
    rating: formatDecimal(review.overall),
    ratingValue: review.overall,
    ratingLabel: t("reviewpage.rating_label", { rating: formatDecimal(review.overall) }),
    date: formatDate(review.createdAt),
    provenance: {
      label: t(`reviewpage.provenance.${review.provenance}` as "reviewpage.provenance.accepted_quote"),
      tone: PROVENANCE_TONE[review.provenance],
    },
    /*
       Rendered verbatim. Never normalised to platform vocabulary and never
       redacted: a buyer writing "ordered 40 DN100 valves" or naming a price they
       were quoted is describing their own experience in their own words. The
       only permitted intervention is removal, on the four grounds.
    */
    body: review.body,
    photos: review.photos.map((photo) => ({
      id: photo.id,
      url: photo.url,
      alt: photo.alt ?? t("reviewpage.photo_alt", { name: review.sellerName }),
    })),
    sellerReply: review.replyRemoved ? null : review.sellerReply,
    replyRemovedLabel: review.replyRemoved ? t("reviewpage.reply_removed", { name: review.sellerName }) : null,
    replyLabel: t("reviewpage.seller_reply", { name: review.sellerName }),
  };
}
