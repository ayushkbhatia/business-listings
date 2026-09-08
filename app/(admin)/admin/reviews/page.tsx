import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth/staff";
import { can } from "@/lib/auth/can";
import { prisma } from "@/lib/db/client";
import { reviewsForModeration } from "@/lib/reviews/service";
import { formatCount, formatDate } from "@/lib/format";
import { t } from "@/lib/i18n";
import { AdminPage, getAdminNavBadges } from "../../_shell";
import { ReviewList, type ReviewRow } from "./ReviewList";
import { logIncentive, remove, removeReply } from "./actions";

/**
 * Criterion 9 — reviews, and removing one.
 *
 * A screen `removeReview` never had. The service was written, audited and
 * capability-checked from the start and no screen called it, so the only route
 * to a bad review was a supplier report — and `SupplierReport` has a
 * `review_integrity` kind with no `reviewId` on it. A review nobody reported
 * was unreachable.
 *
 * Gated on `review.remove`, which is ops lead alone. A moderator holds
 * `report.resolve` and may act on the report about a review while not being
 * able to remove the review itself, so this screen 404s for them — §07, and
 * the `staff-moderator` project asserts it.
 */

export const dynamic = "force-dynamic";

export default async function ReviewsPage() {
  const seat = await requireStaff();
  if (!can(seat.actor, "review.remove")) notFound();

  const [reviews, badges] = await Promise.all([
    reviewsForModeration(),
    getAdminNavBadges(seat),
  ]);

  /*
     Which of these already carry an incentive finding. Board 11c `B6`.

     One query for the page rather than one per row, and it is the reason
     `SupplierReport.reviewId` exists: `review_integrity` has been a report kind
     since board 1m with nothing to join it to, so a finding could be filed and
     never found again.
  */
  /*
     The header's two numbers, counted rather than inferred from the page.

     `reviewsForModeration` takes the two hundred most recent and sorts open
     rows first, so on a database with more than that every removed review falls
     off the end — and the header said "0 removed" over a table that had them.
     Board 11c's criterion 5 is about a seller's page and the rule is general:
     if a header states a count, count the thing rather than the slice.
  */
  const [openCount, removedCount] = await Promise.all([
    prisma.review.count({ where: { removedAt: null } }),
    prisma.review.count({ where: { removedAt: { not: null } } }),
  ]);

  const logged = new Set(
    (
      await prisma.supplierReport.findMany({
        where: { kind: "review_integrity", reviewId: { in: reviews.map((r) => r.id) } },
        select: { reviewId: true },
      })
    ).flatMap((row) => (row.reviewId === null ? [] : [row.reviewId])),
  );

  const rows: ReviewRow[] = reviews.map((review) => ({
    id: review.id,
    businessName: review.businessName,
    businessSlug: review.businessSlug,
    buyerName: review.buyerName,
    overall: review.overall,
    body: review.body,
    createdAt: formatDate(review.createdAt),
    removedAt: review.removedAt ? formatDate(review.removedAt) : null,
    removalReason: review.removalReason,
    sellerReply: review.sellerReply,
    replyRemovedAt: review.replyRemovedAt ? formatDate(review.replyRemovedAt) : null,
    incentiveLogged: logged.has(review.id),
  }));


  return (
    <AdminPage
      seat={seat}
      badges={badges}
      activeHref="/admin/reviews"
      title={t("admin.reviews.title")}
      eyebrow={t("admin.reviews.eyebrow")}
      meta={
        <span className="text-caption text-muted">
          {t("admin.reviews.meta", {
            count: formatCount(openCount),
            removed: formatCount(removedCount),
            shown: formatCount(rows.length),
          })}
        </span>
      }
    >
      <ReviewList
        rows={rows}
        remove={remove}
        removeReply={removeReply}
        logIncentive={logIncentive}
      />

      <p className="mt-[var(--gutter)] max-w-prose text-caption text-muted">
        {t("admin.reviews.note")}
      </p>
    </AdminPage>
  );
}
