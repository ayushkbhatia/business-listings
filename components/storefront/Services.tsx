import { t } from "@/lib/i18n";

/**
 * Section 15 — services and packages, which is not built.
 *
 * Rendered as a disabled card rather than left out. The specification is
 * explicit: *"Leave it visible and disabled so the gap is legible."* A section
 * that is silently absent is one somebody rediscovers when a seller asks for
 * it; one that says what it needs is a decision somebody can schedule.
 *
 * `resolveSections` refuses to render it on a real storefront — `comingSoon`
 * types are filtered out — so this only ever appears on the specimens page and
 * in the section library. That is deliberate: a seller must never see a
 * placeholder on their own page.
 */
export function Services() {
  return (
    /*
      No `aria-disabled`. A `section` is a region and the attribute is not
      supported on one — and it would be the wrong idea anyway: this is not a
      control somebody could otherwise press. The dashed border and the sentence
      say what it is.
    */
    <section className="rounded-card border border-dashed border-line bg-paper-sunk px-5 py-6 opacity-70">
      <h2 className="text-h3 text-muted">{t("section.services.title")}</h2>
      <p className="mt-2 max-w-prose text-body-sm text-muted">{t("section.services.coming")}</p>
    </section>
  );
}
