import { ResponseTime, VerificationBadge, tierSpec } from "@/components/domain";
import { formatCount, formatDate, formatDuration } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { SectionProps } from "@/lib/storefront/render-data";

/**
 * Section 3 — the trust strip.
 *
 * **No seller-fillable fields, and that is the section.** Every figure on it is
 * derived: the tier from what staff checked, the reply time from enquiry-to-
 * first-reply timestamps, the branch count from published locations. A
 * seller-editable trust signal is not a trust signal, and non-negotiable 6 says
 * the same thing about response time in as many words.
 *
 * The badge takes no theme colour. A verification badge that renders differently
 * on a plum storefront than on a steel-blue one is a badge a buyer cannot
 * compare across two suppliers, which is the only thing it is for.
 */
export function TrustStrip({ data }: SectionProps) {
  const branches = data.locations.length;
  const spec = tierSpec(data.business.verificationTier);

  return (
    <section className="rounded-card border border-line bg-paper-sunk px-4 py-3">
      <ul className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <li>
          {/* Not themed. Deliberately, and there is a test. */}
          <VerificationBadge
            tier={data.business.verificationTier}
            label={t(spec.labelKey as never)}
            checked={t(spec.checkedKey as never)}
            tierLabel={t("verify.tier", { tier: data.business.verificationTier })}
            {...(data.business.verifiedAt
              ? { date: formatDate(data.business.verifiedAt) }
              : {})}
          />
        </li>

        <li className="text-caption text-muted">
          <ResponseTime
            medianMs={data.business.responseTimeMedianMs}
            unmeasuredLabel={t("response.unmeasured")}
            {...(data.business.responseTimeMedianMs !== null
              ? {
                  durationLabel: formatDuration(data.business.responseTimeMedianMs),
                  label: t("response.median", {
                    duration: formatDuration(data.business.responseTimeMedianMs),
                  }),
                }
              : {})}
          />
        </li>

        {branches > 0 && (
          <li className="text-caption text-muted">
            {t("section.trust.branches", { count: formatCount(branches) })}
          </li>
        )}

        {data.business.establishedYear && (
          <li className="text-caption text-muted">
            {`${t("storefront.established")} ${data.business.establishedYear}`}
          </li>
        )}

        {data.reviewSummary.count > 0 && (
          <li className="text-caption text-muted">
            {t("section.trust.reviews", { count: formatCount(data.reviewSummary.count) })}
          </li>
        )}
      </ul>
    </section>
  );
}
