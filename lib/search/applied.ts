import { t } from "@/lib/i18n";
import { VERIFIED_TIER } from "@/lib/verification";
import type { SearchQuery } from "./query";

/**
 * The filters a buyer has set, named in their own words.
 *
 * Derived from the query alone — no database read. `AppliedChips` on the
 * category page derives the same list from the fetched facet groups, which is
 * right there because that page has already paid for them to draw its rail.
 * Board 1c's filter bar has no rail behind it, and fetching every facet count
 * to discover that somebody ticked "Dubai" would be a round trip for a fact the
 * URL already states.
 *
 * Spec facets are deliberately absent. Their labels live on `SpecField` and
 * cannot be known without reading the template; on this page they sit behind
 * "More filters" rather than as chips, which is also how the board draws it.
 */
export interface AppliedFacetLabel {
  /** Query-string key, for `withoutFacet`. */
  key: string;
  /** The facet's name — "Emirate". */
  facet: string;
  /** The value as the buyer would say it — "Dubai". */
  value: string;
}

export function appliedFacetLabels(query: SearchQuery): AppliedFacetLabel[] {
  const out: AppliedFacetLabel[] = [];

  if (query.emirate) {
    out.push({
      key: "emirate",
      facet: t("facet.emirate"),
      value: t(`emirate.${query.emirate}` as never),
    });
  }

  if (query.area) {
    /*
       The slug, tidied, rather than the area's real name.

       Reading `Area.name` would be a database call for one chip, and the slug
       is derived from that name — `al-quoz-industrial-1` is recognisably Al
       Quoz Industrial 1. The one thing it loses is capitalisation the buyer did
       not type anyway.
    */
    out.push({
      key: "area",
      facet: t("facet.area"),
      value: query.area.replace(/-/g, " "),
    });
  }

  if (query.tier) {
    out.push({
      key: "tier",
      facet: t("facet.tier"),
      value:
        query.tier >= VERIFIED_TIER
          ? t("facet.tier_option", { tier: query.tier })
          : t("facet.tier_option", { tier: query.tier }),
    });
  }

  if (query.freeZone) {
    out.push({
      key: "freeZone",
      facet: t("facet.free_zone"),
      value: t("facet.free_zone_option"),
    });
  }

  for (const value of query.availability ?? []) {
    out.push({
      key: "availability",
      facet: t("facet.availability"),
      value: t(`availability.${value}` as never),
    });
  }

  if (query.replyWithinHours) {
    out.push({
      key: "replyWithinHours",
      facet: t("facet.reply"),
      value: t("facet.reply_option", { hours: query.replyWithinHours }),
    });
  }

  if (query.yearsTrading) {
    out.push({
      key: "yearsTrading",
      facet: t("facet.years"),
      value: t("facet.years_option", { years: query.yearsTrading }),
    });
  }

  /*
     The map viewport counts as a filter, because it is one — it narrows the
     result set and a buyer who cannot see why they have eleven results has no
     way to undo it. Removing it clears `bounds` and the whole country is back.
  */
  if (query.bounds) {
    out.push({
      key: "bounds",
      facet: t("facet.map_area"),
      value: t("facet.map_area_option"),
    });
  }

  return out;
}
