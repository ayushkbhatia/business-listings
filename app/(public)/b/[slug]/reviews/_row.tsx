import { ReviewCard } from "@/components/domain";
import type { ReviewRow } from "@/lib/db/queries";
import { provenanceOf } from "@/lib/reviews/eligibility";
import { reviewAuthor, reviewRowProps } from "@/lib/reviews/row-view";
import { MEDIA_BUCKET, publicUrl } from "@/lib/storage";

/**
 * One published review, as board 1m renders it.
 *
 * Its own module since board 11i, which renders a closed business's retained
 * reviews on the notice at `/b/<slug>`. A review is a shared component in the
 * strictest sense — the same buyer's words about the same supplier — and a
 * second copy of this function on the closed page would be the second rendering
 * CLAUDE.md warns about, drifting the first time either one changed.
 *
 * The mapping itself is `reviewRowProps`, which board 10f's preview calls too.
 * This file adds the two things only a server has: the row as Prisma returns it,
 * and a public URL for each photograph.
 */
export function ReviewRowItem({
  review,
  sellerName,
}: {
  review: ReviewRow;
  sellerName: string;
}) {
  return (
    <ReviewCard
      {...reviewRowProps({
        id: review.id,
        author: reviewAuthor(review.showCompanyName, review.buyer.buyerCompany?.name),
        overall: review.overall,
        createdAt: review.createdAt,
        provenance: provenanceOf(review),
        body: review.body,
        photos: review.media.map((item) => ({
          id: item.id,
          url: publicUrl(MEDIA_BUCKET, item.storagePath),
          alt: item.alt,
        })),
        sellerReply: review.sellerReply,
        replyRemoved: review.replyRemovedAt !== null,
        sellerName,
      })}
    />
  );
}
