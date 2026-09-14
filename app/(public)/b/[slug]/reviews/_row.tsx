import { ReviewCard } from "@/components/domain";
import type { ReviewRow } from "@/lib/db/queries";
import { formatDate, formatDecimal } from "@/lib/format";
import { t } from "@/lib/i18n";
import { provenanceOf, type Provenance } from "@/lib/reviews/eligibility";
import { MEDIA_BUCKET, publicUrl } from "@/lib/storage";

/**
 * One published review, as board 1m renders it.
 *
 * Its own module since board 11i, which renders a closed business's retained
 * reviews on the notice at `/b/<slug>`. A review is a shared component in the
 * strictest sense — the same buyer's words about the same supplier — and a
 * second copy of this function on the closed page would be the second rendering
 * CLAUDE.md warns about, drifting the first time either one changed.
 */

const PROVENANCE_TONE = {
  accepted_quote: "ok",
  verified_enquiry: "neutral",
} as const satisfies Record<Provenance, "ok" | "neutral">;

/** One row: avatar-less identity line, marks, body, photos, the seller's reply. */
export function ReviewRowItem({
  review,
  sellerName,
}: {
  review: ReviewRow;
  sellerName: string;
}) {
  const provenance = provenanceOf(review);

  return (
    <ReviewCard
      as="li"
      variant="row"
      /*
         The buyer's own registered company name, suffix and all.

         Board 1m leaves this alone deliberately: the display-name rule governs
         *seller* identity, where a legal name and a trading name genuinely
         differ and a buyer who reads one lands on the other. Buyers have no
         display-name field, so stripping a suffix off theirs would be inventing
         data about a company that did not ask us to.

         With no company on file it falls to the anonymous label rather than to
         the person's name. "Show my company name" is consent to publish a
         company; a sole trader who ticked it did not thereby agree to have
         their own name on a public page, and the seller's dashboard shows a
         first name at most for the same reason.
      */
      author={
        review.showCompanyName && review.buyer.buyerCompany
          ? review.buyer.buyerCompany.name
          : t("storefront.review_anonymous")
      }
      /*
         `formatDecimal`, not `formatRating`: one review's score is an integer
         one to five, and "Rated 5.0 out of 5" reads as a measurement of
         something that was never measured. The aggregate above the list is the
         decimal, and it uses the other one.
      */
      rating={formatDecimal(review.overall)}
      ratingValue={review.overall}
      ratingLabel={t("reviewpage.rating_label", { rating: formatDecimal(review.overall) })}
      date={formatDate(review.createdAt)}
      provenance={{
        label: t(`reviewpage.provenance.${provenance}` as "reviewpage.provenance.accepted_quote"),
        tone: PROVENANCE_TONE[provenance],
      }}
      /*
         Rendered verbatim. Never normalised to platform vocabulary and never
         redacted: a buyer writing "ordered 40 DN100 valves" or naming a price
         they were quoted is describing their own experience in their own words.
         The only permitted intervention is removal, on the four grounds.
      */
      body={review.body}
      photos={review.media.map((item) => ({
        id: item.id,
        url: publicUrl(MEDIA_BUCKET, item.storagePath),
        alt: item.alt ?? t("reviewpage.photo_alt", { name: sellerName }),
      }))}
      sellerReply={review.sellerReply}
      replyLabel={t("reviewpage.seller_reply", { name: sellerName })}
    />
  );
}

