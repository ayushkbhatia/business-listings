import { CoverageTable } from "@/components/domain/ServicesStorefront";
import { coverageRowView } from "@/components/domain/service-views";
import { formatList } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { SectionProps } from "@/lib/storefront/render-data";
import { readSettings } from "@/lib/storefront/section-settings";

/**
 * Board `5c-s` — coverage, as rows.
 *
 * **Never a map and never a pin** (B7). `2d-s` took both off the seller's side
 * and `1f-s` B2 took them off the public page; a builder section that drew one
 * would put them back through a side door, which is why the render's *Coverage
 * map* is not this section's name.
 *
 * Two configurations and no content: one row per published service through
 * `effectiveCoverage` — `1f-s`'s table, the same component — or the union the
 * overview prints, as a sentence.
 */
export function Coverage({ section, data, preview }: SectionProps) {
  const { rows } = readSettings("coverage", section.settings);
  const work = data.work;
  const name = data.business.displayName;

  if (rows === "per_service") {
    const services = work?.services ?? [];
    if (services.length === 0 && !preview) return null;
    return (
      <section>
        <h2 className="text-h2 text-brand-ink">{t("storefront_services.coverage_title")}</h2>
        {services.length === 0 ? (
          <p className="mt-3 max-w-[var(--measure-prose)] text-body-sm text-muted">
            {t("section.coverage.empty_rows_preview")}
          </p>
        ) : (
          <div className="mt-4">
            <CoverageTable
              businessSlug={data.business.slug}
              caption={t("storefront_services.coverage_caption", { name })}
              rows={services.map((service) =>
                coverageRowView(service, service.places, work?.freeZones ?? []),
              )}
            />
          </div>
        )}
      </section>
    );
  }

  const places = work?.coverage ?? [];
  const modes = work?.deliveryModes ?? [];
  if (places.length === 0 && !preview) return null;

  return (
    <section>
      <h2 className="text-h2 text-brand-ink">{t("storefront_services.coverage_title")}</h2>
      <p className="mt-3 max-w-[var(--measure-prose)] text-body-sm text-body">
        {places.length > 0
          ? t("storefront_services.coverage_places", { places: formatList(places.map((place) => place.label)) })
          : t("storefront_services.coverage_none")}
      </p>
      {modes.length > 0 && (
        <p className="mt-1.5 text-body-sm text-body">
          {t("storefront_services.coverage_modes", {
            modes: formatList(
              modes.map((mode) => t(`storefront_services.mode.${mode}` as "storefront_services.mode.remote")),
            ),
          })}
        </p>
      )}
    </section>
  );
}
