import { DeclaredSectors } from "@/components/domain/ServicesStorefront";
import { t } from "@/lib/i18n";
import type { SectionProps } from "@/lib/storefront/render-data";

/**
 * Board `5c-s` — sectors served. Display only.
 *
 * `Business.sectorsServed` and the firm's own declared counts, through the
 * component `1d-s` renders them with — the disclaimer under a number included,
 * because a declared count is a claim and the page says so beside it.
 */
export function SectorsServed({ data, preview }: SectionProps) {
  const sectors = data.work?.sectors ?? [];
  if (sectors.length === 0 && !preview) return null;

  return (
    <section>
      <h2 className="text-h2 text-brand-ink">{t("storefront_services.sectors_title")}</h2>
      <div className="mt-3">
        {sectors.length === 0 ? (
          <p className="max-w-[var(--measure-prose)] text-body-sm text-muted">
            {t("section.sectors_served.empty_preview")}
          </p>
        ) : (
          <DeclaredSectors sectors={sectors} />
        )}
      </div>
    </section>
  );
}
