import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { redirectIfMoved, absorbedInto } from "@/lib/listing/redirect";
import { Breadcrumb, PublicShell } from "@/components/structure";

import { getBusinessBySlug, getBusinessProducts, getSpecTemplate } from "@/lib/db/queries";
import { formatCount, formatDuration } from "@/lib/format";
import { t } from "@/lib/i18n";
import { primarySize } from "@/lib/spec";
import { DirectoryFooter, DirectoryNav } from "@/app/(public)/_chrome";
import { StorefrontHeader, storefrontCrumbs } from "../_storefront";
import { ProductTray } from "./ProductTray";
import { EMIRATES } from "@/lib/uae";
import { getActor } from "@/lib/auth/session";

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
  if (!business) {
    /*
     * Before the 404, the two ways a listing legitimately moves: a rename wrote
     * a redirect, or a merge absorbed it. Both wrote rows nothing read until
     * handoff 4 step 2.
     */
    await redirectIfMoved(`/b/${slug}`);
    notFound();
  }

  const movedTo = await absorbedInto(slug);
  if (movedTo) permanentRedirect(`/b/${movedTo}`);

  // An unclaimed listing has no subpages. It is a licence record, not a
  // storefront, and there is nothing here for it to show.
  if (business.claimStatus === "unclaimed") notFound();

  const [products, template, actor] = await Promise.all([
    getBusinessProducts(business.id),
    getSpecTemplate(business.primaryCategoryId),
    getActor(),
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
            <ProductTray
              businessId={business.id}
              businessSlug={business.slug}
              displayName={business.displayName}
              categoryId={business.primaryCategoryId}
              emirates={EMIRATES}
              signedIn={Boolean(actor)}
              recipient={{
                businessId: business.id,
                displayName: business.displayName,
                areaName: business.locations[0]?.area?.name ?? null,
                verificationTier: business.verificationTier,
                responseLabel:
                  business.responseTimeMedianMs === null
                    ? t("response.unmeasured")
                    : t("response.median", { duration: formatDuration(business.responseTimeMedianMs) }),
                pinned: true,
              }}
              products={products.map((product) => ({
                id: product.id,
                slug: product.slug,
                businessSlug: business.slug,
                name: product.name,
                sku: product.sku,
                availability: product.availability,
                stockQty: product.stockQty,
                leadTimeDays: product.leadTimeDays,
                minOrderQty: product.minOrderQty,
                sizeLabel: primarySize(fields, product.specValues),
                size: primarySize(fields, product.specValues) ?? null,
              }))}
            />
          )}
        </div>
      </div>
    </PublicShell>
  );
}
