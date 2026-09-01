import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth/staff";
import { can } from "@/lib/auth/can";
import { reviewsForModeration } from "@/lib/reviews/service";
import { formatCount, formatDate } from "@/lib/format";
import { t } from "@/lib/i18n";
import { AdminPage, getAdminNavBadges } from "../../_shell";
import { ReviewList, type ReviewRow } from "./ReviewList";
import { remove } from "./actions";

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
    hasSellerReply: review.hasSellerReply,
  }));

  const open = rows.filter((row) => row.removedAt === null).length;

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
            count: formatCount(open),
            removed: formatCount(rows.length - open),
          })}
        </span>
      }
    >
      <ReviewList rows={rows} remove={remove} />

      <p className="mt-[var(--gutter)] max-w-prose text-caption text-muted">
        {t("admin.reviews.note")}
      </p>
    </AdminPage>
  );
}
