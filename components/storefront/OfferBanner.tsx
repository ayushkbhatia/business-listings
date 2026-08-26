import { formatDate } from "@/lib/format";
import { line, type SectionProps } from "@/lib/storefront/render-data";
import { t } from "@/lib/i18n";

/**
 * Section 12 — the offer banner.
 *
 * The one section in the catalogue that could have been a price mechanism.
 *
 * The specification calls its fourth field `code`, which reads as a redeemable
 * discount code — and a discount code on a public surface is a price on a
 * public surface, which non-negotiable 1 refuses. It is a `reference` here: an
 * opaque string a buyer quotes inside an enquiry, never validated, never stored
 * against a value, and never checked against anything. "Mention RAMADAN26" is a
 * marketing string; "RAMADAN26 for 15% off" is a price, and the difference is
 * the whole reason this field was renamed.
 *
 * The expiry is shown because an offer with no end date is not an offer.
 */
export function OfferBanner({ content }: SectionProps) {
  const headline = line(content, "headline");
  if (!headline) return null;

  const body = line(content, "body");
  const reference = line(content, "reference");
  const endsOn = line(content, "endsOn");

  return (
    <section className="rounded-card border border-brand-line bg-brand-wash px-5 py-4">
      <p className="text-h3 text-brand-ink">{headline}</p>
      {body && <p className="mt-1 max-w-[var(--measure-prose)] text-body-sm text-prose">{body}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
        {reference && (
          <span className="font-mono text-eyebrow uppercase text-brand">
            {t("section.offer.reference", { reference })}
          </span>
        )}
        {endsOn && (
          <span className="font-mono text-eyebrow text-muted">
            {t("section.offer.ends", { date: formatDate(new Date(endsOn)) })}
          </span>
        )}
      </div>
    </section>
  );
}
