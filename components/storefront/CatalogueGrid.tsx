import { ProductCard } from "@/components/domain";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { SectionProps } from "@/lib/storefront/render-data";

/**
 * Section 5 — the catalogue grid.
 *
 * The section that replaces what `/b/[slug]` renders by hand today. No price on
 * any card: `ProductCard` is availability-led by construction and there is no
 * price field on `Product` to show even if somebody wanted one.
 */
export function CatalogueGrid({ data, enquireHref }: SectionProps) {
  return (
    <section>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-h2 text-brand-ink">{t("section.catalogue.title")}</h2>
        {data.productCount > data.products.length && (
          <a
            href={`/b/${data.business.slug}/products`}
            className="rounded-tag text-caption text-brand underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
          >
            {t("section.catalogue.view_all", { count: formatCount(data.productCount) })}
          </a>
        )}
      </div>

      {data.products.length === 0 ? (
        <p className="mt-2 text-body-sm text-muted">{t("section.catalogue.empty")}</p>
      ) : (
        <div className="mt-3 grid gap-[var(--gutter)] sm:grid-cols-2 lg:grid-cols-3">
          {data.products.map((product) => (
            <ProductCard
              key={product.id}
              enquireHref={enquireHref}
              product={{
                slug: product.slug,
                businessSlug: data.business.slug,
                name: product.name,
                sku: product.sku,
                availability: product.availability,
                stockQty: product.stockQty,
                leadTimeDays: product.leadTimeDays,
                minOrderQty: product.minOrderQty,
                ...(product.sizeLabel ? { sizeLabel: product.sizeLabel } : {}),
              }}
            />
          ))}
        </div>
      )}
    </section>
  );
}
