import { LogoTile } from "@/components/display";
import { picks, type SectionProps } from "@/lib/storefront/render-data";
import { t } from "@/lib/i18n";

/**
 * Section 6 — brands we stock.
 *
 * Logo picks from the seller's own media library. Not a free-text list: a
 * stockist typing "Grundfos" is a claim, and a logo they uploaded is at least
 * a file somebody chose.
 */
export function Brands({ data, content }: SectionProps) {
  const chosen = picks(content, "logos");
  const brands = chosen.length
    ? chosen
        .map((id) => data.brands.find((brand) => brand.id === id))
        .filter((brand): brand is (typeof data.brands)[number] => brand !== undefined)
    : data.brands;

  if (brands.length === 0) return null;

  return (
    <section>
      <h2 className="text-h2 text-brand-ink">{t("section.brands.title")}</h2>
      <ul className="mt-3 flex flex-wrap gap-3">
        {brands.map((brand) => (
          <li key={brand.id}>
            <LogoTile name={brand.name} {...(brand.logoUrl ? { src: brand.logoUrl } : {})} />
          </li>
        ))}
      </ul>
    </section>
  );
}
