import { MapCanvas } from "@/components/display";
import { formatPhone } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { SectionProps } from "@/lib/storefront/render-data";

/**
 * Section 8 — branches and map.
 *
 * Derived entirely from published locations. No seller-fillable fields: an
 * address a seller can write freehand on a storefront is an address that
 * disagrees with the one on their licence.
 */
export function Branches({ data }: SectionProps) {
  if (data.locations.length === 0) return null;

  const plottable = data.locations.filter(
    (location) => location.lat !== null && location.lng !== null,
  );
  const pins = plottable.map((location) => ({
    id: location.id,
    lat: location.lat!,
    lng: location.lng!,
    label: location.areaName ?? location.addressLine,
    /*
     * The pin treatment follows what we checked, not what the seller is. A
     * branch on a tier-2 listing is `verified` because the licence was; a
     * head office gets its own treatment because it is the one to call.
     */
    kind:
      location.type === "head_office"
        ? ("head_office" as const)
        : data.business.verificationTier >= 2
          ? ("verified" as const)
          : ("unverified" as const),
  }));

  return (
    <section>
      <h2 className="text-h2 text-brand-ink">{t("section.branches.title")}</h2>

      <div className="mt-3 grid gap-[var(--gutter)] lg:grid-cols-[minmax(0,1fr)_20rem]">
        {pins.length > 0 && (
          <MapCanvas
            pins={pins}
            label={t("section.branches.title")}
            excluded={data.locations.length - plottable.length}
            excludedLabel={t("section.branches.excluded", {
              count: String(data.locations.length - plottable.length),
            })}
          />
        )}

        <ul className="flex flex-col gap-3">
          {data.locations.map((location) => (
            <li key={location.id} className="rounded-card border border-line bg-card p-3">
              <p className="font-mono text-eyebrow uppercase text-muted">
                {location.type === "head_office"
                  ? t("section.branches.head_office")
                  : t(`emirate.${location.emirate}` as never)}
              </p>
              <p className="mt-1 text-body-sm text-ink">{location.addressLine}</p>
              {location.areaName && (
                <p className="text-caption text-muted">{location.areaName}</p>
              )}
              {location.phone && (
                <a
                  href={`tel:${location.phone}`}
                  className="mt-1 inline-block rounded-tag font-mono text-caption text-brand underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
                >
                  {formatPhone(location.phone)}
                </a>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
