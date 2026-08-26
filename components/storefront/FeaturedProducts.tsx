import { ProductCard } from "@/components/domain";
import { picks, type SectionProps } from "@/lib/storefront/render-data";
import { t } from "@/lib/i18n";

/**
 * Section 4 — featured products.
 *
 * Manual pick, four to eight. The spec offers "auto-pick most-enquired" as an
 * alternative and it is not built: `EnquiryLine.productId` only started being
 * recorded in step 6a, so there is nothing to rank on yet and nothing to
 * backfill from. Shipping a ranking over three weeks of data would be a made-up
 * number on a page whose job is to be the seller's best foot forward.
 *
 * Falls back to the first few products rather than rendering nothing, because a
 * seller who has not picked yet still has a storefront.
 */
export function FeaturedProducts({ data, content, enquireHref }: SectionProps) {
  const chosen = picks(content, "products");
  const products = chosen.length
    ? chosen
        .map((id) => data.products.find((product) => product.id === id))
        .filter((product): product is (typeof data.products)[number] => product !== undefined)
    : data.products.slice(0, 4);

  if (products.length === 0) {
    return (
      <section>
        <h2 className="text-h2 text-brand-ink">{t("section.featured.title")}</h2>
        <p className="mt-2 text-body-sm text-muted">{t("section.featured.empty")}</p>
      </section>
    );
  }

  return (
    <section>
      <h2 className="text-h2 text-brand-ink">{t("section.featured.title")}</h2>
      <div className="mt-3 grid gap-[var(--gutter)] sm:grid-cols-2 lg:grid-cols-4">
        {products.map((product) => (
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
    </section>
  );
}
