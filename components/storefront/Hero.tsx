import { ImagePlaceholder } from "@/components/display";
import { buttonClassName } from "@/components/primitives";
import type { SectionProps } from "@/lib/storefront/render-data";

/**
 * The hero banner — the first section of a goods storefront's overview.
 *
 * Not one word on it is a number. A hero is where "from AED 40 a metre" goes on
 * every other trade directory, and non-negotiable 1 is that a public surface
 * shows availability and an enquiry action where a price would sit.
 *
 * The headline is the seller's own display name rather than a slogan we wrote.
 * A storefront that says "Quality you can trust" above a name nobody recognises
 * is worse than one that just says the name.
 */
export function Hero({ data, enquireHref, enquireSlot }: SectionProps) {
  const image = data.heroImageUrl;

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
        <h2 className="mt-2 max-w-[20ch] text-h1-serif font-serif text-on-ink">
          {data.business.displayName}
        </h2>
        {data.business.description && (
          <p className="mt-3 max-w-[var(--measure-prose)] text-body-sm text-on-ink/85">
            {data.business.description}
          </p>
        )}
        {/*
             Composes in place. Board 1h criterion 3: a storefront must not
             link to the fan-out — the buyer has already chosen a supplier,
             and sending them to a picker undoes that.

             None at all for the business's own team: no business enquires to
             itself, and the fallback link would be an enquiry verb over nothing.
          */}
        {enquireSlot !== null && (
          <div className="mt-5">
            {enquireSlot ?? (
              <a className={buttonClassName({ variant: "primary" })} href={enquireHref}>
                {data.copy["section.hero.enquire"]}
              </a>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
