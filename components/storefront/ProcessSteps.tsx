import { t } from "@/lib/i18n";

/**
 * Board `5c-s` — process steps, held.
 *
 * Rendered as a disabled card with the decision named, which is the shape the
 * services placeholder had before this board replaced it. `resolveSections`
 * never lets a held type reach a storefront, so this only ever appears in the
 * library and on the specimens page.
 *
 * B3: *do not ship it as an unbounded free-text block beside the scope grid.*
 * It is either authored content with a store, a limit and moderation, or a
 * scope-sheet field every firm answers the same way (Q1). Until that is
 * decided there is nothing for this component to render but the question.
 */
export function ProcessSteps() {
  return (
    /*
      No `aria-disabled`. A `section` is a region and the attribute is not
      supported on one; the dashed border and the sentence say what it is.
    */
    <section className="rounded-card border border-dashed border-line bg-paper-sunk px-5 py-6">
      <h2 className="text-h3 text-muted">{t("section.process_steps")}</h2>
      <p className="mt-2 max-w-prose text-body-sm text-muted">{t("section.held.process_steps")}</p>
    </section>
  );
}
