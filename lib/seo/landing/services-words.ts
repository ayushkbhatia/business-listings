import { t } from "@/lib/i18n";
import type { LandingScope } from "./scope";

/**
 * Board `6a-s` correction 3 — what a services landing page calls the people in
 * the trade, and the H1 it builds from that.
 *
 * *VAT consultants in Business Bay, Dubai.* The noun is the category record's
 * plural human form — `Category.pluralHuman` — because the goods rule
 * (`{Category} companies in …`) names a thing sold, and a buyer of work
 * searches for the person who does it. Where nobody has written one, the
 * trade's own name and *firms*: plain, and claiming nothing.
 *
 * The emirate stays in the H1 on the area class. An area name is not unique
 * across the seven emirates, and the board's *VAT consultants in Business Bay*
 * dropped it — correction 3 puts it back.
 *
 * Here rather than in the page so the title, the description, the page and
 * the rail's *Related work* labels all word a page the one way.
 */

export function servicesNoun(category: { name: string; pluralHuman: string | null }): string {
  return category.pluralHuman ?? t("landing_services.noun_fallback", { category: category.name });
}

export function servicesH1(scope: Pick<LandingScope, "emirate" | "area" | "category">): string {
  const noun = servicesNoun(scope.category);
  const emirate = t(`emirate.${scope.emirate}` as never);
  return scope.area
    ? t("landing_services.h1_area", { noun, area: scope.area.name, emirate })
    : t("landing_services.h1_emirate", { noun, emirate });
}
