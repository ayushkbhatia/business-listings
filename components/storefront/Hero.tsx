import { ImagePlaceholder } from "@/components/display";
import { buttonClassName } from "@/components/primitives";
import { line, type SectionProps } from "@/lib/storefront/render-data";
import { t } from "@/lib/i18n";

/**
 * Section 2 — the hero banner.
 *
 * Four seller-fillable fields and not one of them is a number. A hero is where
 * "from AED 40 a metre" goes on every other trade directory, and non-negotiable
 * 1 is that a public surface shows availability and an enquiry action where a
 * price would sit. `section-types.ts` declares the fields and a test asserts
 * none of them is price-shaped.
 *
 * The headline falls back to the seller's own trade name rather than to a
 * slogan we wrote. A storefront that says "Quality you can trust" above a name
 * nobody recognises is worse than one that just says the name.
 */
export function Hero({ data, content, enquireHref }: SectionProps) {
  const eyebrow = line(content, "eyebrow");
  const headline = line(content, "headline", data.business.displayName);
  const buttonLabel = line(content, "buttonLabel", t("section.hero.enquire"));
  const image = line(content, "image") || data.heroImageUrl;

  return (
    <section className="relative overflow-hidden rounded-card border border-brand-line bg-brand-wash">
      {image ? (
        /*
         * A plain img, as everywhere else images come from a seller's bucket.
         * `alt` is empty on purpose: the image is decorative, the headline
         * carries the meaning, and repeating it makes a screen reader say the
         * same words twice.
         */
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt="" className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <ImagePlaceholder kind="empty" rounded="none" className="absolute inset-0 h-full w-full" />
      )}

      {/*
        A scrim, not a darken filter on the image. The text sits on a known
        surface so the contrast is computable rather than dependent on whatever
        the seller uploaded.
      */}
      <div className="relative bg-ink/55 px-6 py-12 sm:px-10 sm:py-16">
        {eyebrow && (
          <p className="font-mono text-eyebrow uppercase text-on-ink/80">{eyebrow}</p>
        )}
        <h2 className="mt-2 max-w-[20ch] text-h1-serif font-serif text-on-ink">{headline}</h2>
        {data.business.description && (
          <p className="mt-3 max-w-[var(--measure-prose)] text-body-sm text-on-ink/85">
            {data.business.description}
          </p>
        )}
        <div className="mt-5">
          <a className={buttonClassName({ variant: "primary" })} href={enquireHref}>
            {buttonLabel}
          </a>
        </div>
      </div>
    </section>
  );
}
