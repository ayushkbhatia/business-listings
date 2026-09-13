import { formatList } from "@/lib/format";
import { t } from "@/lib/i18n";
import { coversEveryEmirate, rowQualifiers, type FreeZoneView, type PlaceView } from "@/lib/storefront/coverage-page";
import type { ScopeColumn } from "@/lib/storefront/section-settings";
import type { CoverageTableRow } from "./ServicesStorefront";
import { scopeWords } from "./ScopeTable";

/**
 * How a service's fields and coverage are worded — one place, three readers.
 *
 * The services list (`1e-s`), the coverage page (`1f-s`) and the builder's
 * scope grid and coverage sections (`5c-s`) all print the same four fields and
 * the same row. Each used to word its own, which is how a column reads *Remote*
 * on one tab and *remote* on another. `5c-s`'s own rule — a template assembles
 * the blocks the default storefront uses, not a parallel set — is a rule about
 * this file.
 */

/** The four scope-sheet values a comparison reads, raw. */
export interface ServiceFieldSource {
  engagementType: string | null;
  turnaround: string | null;
  /** Already the family's word for it. */
  feeBasis: string | null;
  deliveredWhere: string | null;
}

/** One of `1e-s`'s four fields, worded, or null where the firm has not said — B6. */
export function serviceFieldValue(column: ScopeColumn, service: ServiceFieldSource): string | null {
  switch (column) {
    case "engagement":
      return service.engagementType === null ? null : scopeWords("engagement_type", service.engagementType);
    case "turnaround":
      return service.turnaround;
    case "fee_basis":
      return service.feeBasis;
    case "delivered":
      return service.deliveredWhere === null ? null : scopeWords("delivered_where", service.deliveredWhere);
  }
}

/** One service as the coverage table reads it: places worded, free zones qualified, `How` worded. */
export function coverageRowView(
  service: { slug: string; name: string; deliveredWhere: string | null },
  places: readonly PlaceView[],
  freeZones: readonly FreeZoneView[],
): CoverageTableRow {
  const zones = rowQualifiers(places, freeZones);
  return {
    slug: service.slug,
    name: service.name,
    where:
      places.length === 0
        ? t("storefront_services.not_stated")
        : coversEveryEmirate(places)
          ? t("storefront_services.coverage_all_seven")
          : formatList(places.map((place) => place.label)),
    qualifier:
      zones.length > 0 ? t("storefront_services.coverage_registered_in", { zones: formatList(zones) }) : null,
    how: service.deliveredWhere === null ? null : scopeWords("delivered_where", service.deliveredWhere),
  };
}
