import { t } from "@/lib/i18n";
import type { SectionProps } from "@/lib/storefront/render-data";

/**
 * Section 13 — spec comparison.
 *
 * A real `<table>` with `<th scope>`, per the project rule. The design draws
 * comparison grids with divs for layout reasons and the build does not: this is
 * tabular data — attributes down the side, products across the top — and a
 * screen reader user comparing two bore sizes needs the header association.
 *
 * No price row. There is no price on `Product` to put in one.
 */
export function SpecComparison({ data }: SectionProps) {
  if (data.specRows.length === 0 || data.products.length === 0) {
    return (
      <section>
        <h2 className="text-h2 text-brand-ink">{t("section.spec.title")}</h2>
        <p className="mt-2 text-body-sm text-muted">{t("section.spec.empty")}</p>
      </section>
    );
  }

  return (
    <section>
      <h2 className="text-h2 text-brand-ink">{t("section.spec.title")}</h2>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full border-collapse text-body-sm">
          <caption className="sr-only">{t("section.spec.title")}</caption>
          <thead>
            <tr>
              <th scope="col" className="border-b border-line px-3 py-2 text-start font-mono text-eyebrow uppercase text-muted">
                {t("section.spec.attribute")}
              </th>
              {data.products.map((product) => (
                <th
                  key={product.id}
                  scope="col"
                  className="border-b border-line px-3 py-2 text-start text-body-sm text-ink"
                >
                  {product.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.specRows.map((row) => (
              <tr key={row.label}>
                <th scope="row" className="border-b border-line px-3 py-2 text-start text-caption text-muted">
                  {row.label}
                </th>
                {row.values.map((value, index) => (
                  <td
                    key={data.products[index]?.id ?? index}
                    className="border-b border-line px-3 py-2 tabular-nums text-ink"
                  >
                    {value ?? <span className="text-faint">—</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
