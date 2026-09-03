import { buttonClassName } from "@/components/primitives";
import { line, type SectionProps } from "@/lib/storefront/render-data";
import { t } from "@/lib/i18n";

/**
 * Section 10 — the enquiry form.
 *
 * The conversion event. One seller-fillable field, an intro line, and no price
 * anywhere near it: what a buyer sends is a requirement, and what comes back is
 * a quote that is private to the two of them.
 *
 * Renders a link to the real composer rather than embedding it. `EnquiryComposer`
 * is a client component with its own state and its own server action, and a
 * storefront section that inlined it would put an unauthenticated write path on
 * every page of every storefront — which is the same reason the embed was cut.
 */
export function EnquiryForm({ content, enquireHref, enquireSlot }: SectionProps) {
  const intro = line(content, "intro", t("section.enquiry.default_intro"));

  return (
    <section className="rounded-card border border-brand-line bg-brand-wash p-6">
      <h2 className="text-h2 text-brand-ink">{t("section.enquiry.title")}</h2>
      <p className="mt-2 max-w-[var(--measure-prose)] text-body-sm text-prose">{intro}</p>
      <div className="mt-4">
        {/*
             Composes in place. Board 1h criterion 3: a storefront must not
             link to the fan-out — the buyer has already chosen a supplier,
             and sending them to a picker undoes that.
          */}
          {enquireSlot ?? (
            <a className={buttonClassName({ variant: "primary" })} href={enquireHref}>
              {t("section.hero.enquire")}
            </a>
          )}
      </div>
    </section>
  );
}
