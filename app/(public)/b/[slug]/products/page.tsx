import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Breadcrumb, PublicShell } from "@/components/structure";
import { ProductCard } from "@/components/domain";
import { getBusinessBySlug, getBusinessProducts, getSpecTemplate } from "@/lib/db/queries";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import { primarySize } from "@/lib/spec";
import { DirectoryFooter, DirectoryNav } from "@/app/(public)/_chrome";
import { StorefrontHeader, storefrontCrumbs } from "../_storefront";

export const revalidate = 300;

interface Params {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const business = await getBusinessBySlug(slug);
  if (!business) return {};
  const title = `${t("storefront.catalogue")} — ${business.displayName}`;
  return {
    title,
    description: t("seo.catalogue_description", {
      name: business.displayName,
      count: formatCount(business._count.products),
      category: business.primaryCategory.name,
    }),
    alternates: { canonical: `/b/${slug}/products` },
  };
}

export default async function CataloguePage({ params }: Params) {
  const { slug } = await params;
  const business = await getBusinessBySlug(slug);
  // An unclaimed listing has no catalogue, so the tab does not exist for it.
  if (!business || business.claimStatus === "unclaimed") notFound();

  const [products, template] = await Promise.all([
    getBusinessProducts(business.id),
    getSpecTemplate(business.primaryCategoryId),
  ]);
  const fields = template?.fields ?? [];

  return (
    <PublicShell
      nav={<DirectoryNav />}
      breadcrumb={
        <Breadcrumb
          label={t("gallery.breadcrumb_label")}
          items={storefrontCrumbs(business, t("storefront.products"))}
        />
      }
      footer={<DirectoryFooter />}
    >
      <div data-theme={business.themePreset ?? "default"}>
        <StorefrontHeader business={business} active="products" />

        <div className="mt-5">
          {/* h1 is the business name in the header; the grid needs its own h2
              or the product headings jump a level. */}
          <h2 className="text-h2 text-brand-ink">{t("storefront.catalogue")}</h2>
          <p className="mt-0.5 font-mono text-eyebrow tabular-nums text-muted">
            {t("listing.products", { count: products.length })}
          </p>

          {products.length === 0 ? (
            <p className="mt-3 text-body-sm text-muted">{t("storefront.catalogue_empty")}</p>
          ) : (
            <div className="mt-3 grid gap-[var(--gutter)] sm:grid-cols-2 lg:grid-cols-3">
              {products.map((product) => (
                <ProductCard
                  key={product.id}
                  product={{
                    slug: product.slug,
                    businessSlug: business.slug,
                    name: product.name,
                    sku: product.sku,
                    availability: product.availability,
                    stockQty: product.stockQty,
                    leadTimeDays: product.leadTimeDays,
                    minOrderQty: product.minOrderQty,
                    sizeLabel: primarySize(fields, product.specValues),
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </PublicShell>
  );
}
