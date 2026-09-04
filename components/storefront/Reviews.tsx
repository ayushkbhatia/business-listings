import { ReviewCard } from "@/components/domain";
import { formatCount, formatDate, formatDecimal } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { SectionProps } from "@/lib/storefront/render-data";

/**
 * Section 9 — reviews.
 *
 * Composes `ReviewCard`, which was extracted from `/b/[slug]/reviews` for this
 * section rather than copied. The inventory's note on `Thread` says why: a
 * buyer and a seller reading different renderings of the same record is the one
 * thing a record must never do, and two copies of this markup would have
 * drifted the first time somebody changed one.
 *
 * No seller-fillable fields, and no way to hide a bad one. A review is removed
 * by staff with a written reason or it is shown.
 */
export function Reviews({ data }: SectionProps) {
  return (
    <section>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-h2 text-brand-ink">{t("section.reviews.title")}</h2>
        {data.reviewSummary.average !== null && (
          <span className="font-mono text-eyebrow tabular-nums text-muted">
            {t("section.reviews.average", {
              average: formatDecimal(data.reviewSummary.average),
              count: formatCount(data.reviewSummary.count),
            })}
          </span>
        )}
      </div>

      {data.reviews.length === 0 ? (
        <p className="mt-2 max-w-prose text-body-sm text-muted">{t("section.reviews.empty")}</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-3">
          {data.reviews.map((review) => (
            <ReviewCard
              key={review.id}
              as="li"
              /*
                 An empty author is a buyer who withheld their name, which is a
                 label rather than a blank line. The loader hands over the
                 company or nothing, because a data loader has no business
                 calling `t()`; the fallback belongs here.
              */
              author={review.author || t("storefront.review_anonymous")}
              rating={formatDecimal(review.overall)}
              date={formatDate(review.createdAt)}
              body={review.body}
              sellerReply={review.sellerReply}
              replyLabel={t("storefront.seller_reply")}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
