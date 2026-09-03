import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { redirectIfMoved, absorbedInto } from "@/lib/listing/redirect";
import { Breadcrumb, PublicShell } from "@/components/structure";

import {
  getBusinessBySlug,
  getCatalogueView,
  getSpecTemplate,
  isFiltered,
  parseCatalogueQuery,
  toCatalogueParams,
  CATALOGUE_PAGE_SIZE,
} from "@/lib/db/queries";
import { formatCount, formatDuration } from "@/lib/format";
import { t } from "@/lib/i18n";
import { primarySize } from "@/lib/spec";
import { DirectoryFooter, DirectoryNav } from "@/app/(public)/_chrome";
import { StorefrontHeader, storefrontCrumbs } from "../_storefront";
import { ProductTray } from "./ProductTray";
import { CatalogueRail, CatalogueToolbar } from "./_rail";
import { NotifyButton } from "./NotifyButton";
import { watchProductAction } from "./actions";
import { CatalogueFilters } from "./CatalogueFilters";
import { JsonLd } from "@/app/(public)/_json-ld";
import { MEDIA_BUCKET, publicUrl } from "@/lib/storage";
import { absoluteUrl } from "@/lib/site";
import { SpecTable } from "@/components/domain";
import Link from "next/link";
import { EMIRATES } from "@/lib/uae";
import { getActor } from "@/lib/auth/session";
import { navPages } from "@/lib/storefront/pages";

export const revalidate = 300;

interface Params {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** Board 1e's availability vocabulary, in schema.org's. */
const SCHEMA_AVAILABILITY: Record<string, string> = {
  in_stock: "https://schema.org/InStock",
  made_to_order: "https://schema.org/PreOrder",
  indent: "https://schema.org/PreOrder",
  out_of_stock: "https://schema.org/OutOfStock",
};

export async function generateMetadata({ params, searchParams }: Params): Promise<Metadata> {
  const { slug } = await params;
  const business = await getBusinessBySlug(slug);
  if (!business) return {};

  const query = parseCatalogueQuery(await searchParams);
  const filtered = isFiltered(query);

  return {
    title: t("seo.catalogue_title", {
      name: business.displayName,
      count: formatCount(business._count.products),
    }),
    description: t("seo.catalogue_description", {
      name: business.displayName,
      count: formatCount(business._count.products),
      category: business.primaryCategory.name,
    }),
    /*
       Criterion 11. The catalogue index is indexable; a filter combination is
       not. Four hundred permutations per seller is the doorway-page problem the
       publish threshold exists to prevent elsewhere, and `follow` because the
       products themselves are worth reaching.
    */
    ...(filtered ? { robots: { index: false, follow: true } } : {}),
    // And every filtered view points at the one page worth ranking.
    alternates: { canonical: `/b/${slug}/products` },
  };
}

export default async function CataloguePage({ params, searchParams }: Params) {
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

  const query = parseCatalogueQuery(await searchParams);

  const [view, template, actor] = await Promise.all([
    getCatalogueView(business.id, query),
    getSpecTemplate(business.primaryCategoryId),
    getActor(),
  ]);
  const fields = template?.fields ?? [];

  /*
     Criterion 9: a seller with no catalogue has no Products tab at all, and
     `StorefrontHeader` already hides it. Reaching this route directly is then a
     404 rather than an empty page — a tab that does not exist should not have a
     URL that renders.
  */
  if (view.catalogueTotal === 0) notFound();

  const basePath = `/b/${business.slug}/products`;
  const shown = (query.page - 1) * CATALOGUE_PAGE_SIZE + view.products.length;
  const remaining = Math.max(0, view.total - shown);
  /** The seller's template fields that this product actually filled in. */
  const specRowsFor = (product: { specValues: Record<string, unknown> }) =>
    fields
      .map((field) => ({ key: field.id, label: field.label, raw: product.specValues[field.id] }))
      .filter((row) => row.raw !== undefined && row.raw !== null && String(row.raw).trim() !== "")
      .map((row) => ({ key: row.key, label: row.label, value: String(row.raw) }));

  const allOutOfStock =
    view.products.length > 0 &&
    view.products.every((product) => product.availability === "out_of_stock");

  // Template pages marked for the nav. Empty where the trade has no template.

  const pages = business.sectorId ? await navPages(business.sectorId) : [];


  return (
    <PublicShell
      bleed
      nav={
        /*
           Board 1e section 1: the header search is scoped to this store.

           A buyer standing in a supplier's catalogue who types "DN100" means
           "DN100 from them", and sending that to a site-wide search would be
           answering a question they did not ask. The nav's own Products link is
           the site-wide escape, which is why one exists.
        */
        <DirectoryNav
          scope={{
            action: basePath,
            label: t("catalogue.search_scope"),
            placeholder: t("catalogue.search_placeholder", {
              formatted: formatCount(view.catalogueTotal),
              seller: business.displayName,
            }),
          }}
        />
      }
      breadcrumb={
        <Breadcrumb
          label={t("gallery.breadcrumb_label")}
          items={storefrontCrumbs(business, t("storefront.products"))}
        />
      }
      footer={<DirectoryFooter />}
    >
      <div data-theme={business.themePreset ?? "default"}>
        <StorefrontHeader business={business} active="products" pages={pages} />

        <div className="mx-auto mt-5 max-w-7xl px-5 pb-[var(--section-pad)]">
          {/*
             `ItemList` of the page a buyer is actually looking at, each product
             carrying availability and **no price at all** — omitted entirely,
             which is the difference between "we do not publish prices" and
             "this costs nothing". `Product` has no price column; there is
             nothing here to omit from, and that is the point.
          */}
          <JsonLd
            data={{
              "@context": "https://schema.org",
              "@type": "ItemList",
              name: t("catalogue.title"),
              numberOfItems: view.products.length,
              itemListElement: view.products.map((product, index) => ({
                "@type": "ListItem",
                position: index + 1,
                item: {
                  "@type": "Product",
                  name: product.name,
                  sku: product.sku ?? undefined,
                  url: absoluteUrl(`/b/${business.slug}/p/${product.slug}`),
                  brand: { "@type": "Brand", name: business.displayName },
                  offers: {
                    "@type": "Offer",
                    availability: SCHEMA_AVAILABILITY[product.availability],
                    seller: { "@type": "Organization", name: business.displayName },
                    url: absoluteUrl(`/b/${business.slug}/p/${product.slug}`),
                  },
                },
              })),
            }}
          />

          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              {/* h1 is the business name in the header; the grid needs its own
                  h2 or the product headings jump a level. */}
              <h2 className="text-h2 text-brand-ink">{t("catalogue.title")}</h2>
              <p className="mt-0.5 text-body-sm text-muted">
                {t("catalogue.sub", { formatted: formatCount(view.catalogueTotal) })}
              </p>
            </div>

            {/*
               A price list is a legitimate thing to ask for and is not a price
               surface: it sends an enquiry asking the seller to send theirs
               directly. Never "Download price list" — nothing is downloaded and
               no price exists here to download.
            */}
            <Link
              href={`/rfq/new?to=${business.slug}&about=price-list`}
              className="rounded-ctl bg-moss px-3.5 py-2 text-body-sm font-medium text-on-ink hover:bg-moss-hover focus-visible:outline-none focus-visible:shadow-focus"
            >
              {t("catalogue.price_list")}
            </Link>
          </div>

          <div className="mt-5 grid gap-[var(--gutter)] lg:grid-cols-[13.5rem_minmax(0,1fr)]">
            <CatalogueFilters
              appliedCount={
                (query.subcategory ? 1 : 0) +
                query.availability.length +
                Object.values(query.spec).reduce((total, values) => total + values.length, 0)
              }
              rail={<CatalogueRail view={view} query={query} basePath={basePath} />}
            />

            <div className="min-w-0">
              <CatalogueToolbar view={view} query={query} basePath={basePath} />

              {allOutOfStock && (
                <div className="mt-3 rounded-card border border-line bg-warn-wash px-4 py-3">
                  <p className="text-body-sm font-medium text-ink">
                    {t("catalogue.all_out_title")}
                  </p>
                  <p className="mt-0.5 text-caption text-body">{t("catalogue.all_out_body")}</p>
                </div>
              )}

              {view.total === 0 ? (
                /*
                   Criterion 10. A dead end is the one outcome worth designing
                   away here: the seller may well have the thing even where
                   their catalogue does not say so, and an enquiry describing it
                   is a better result for everybody than a buyer leaving.
                */
                <div className="mt-6 max-w-[var(--measure-prose)]">
                  <h3 className="text-h3 text-ink">{t("catalogue.zero_title")}</h3>
                  <p className="mt-2 text-body-sm text-body">
                    {t("catalogue.zero_describe")}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Link
                      href={basePath}
                      className="rounded-ctl border border-line bg-card px-3 py-2 text-body-sm font-medium text-ink hover:bg-paper focus-visible:outline-none focus-visible:shadow-focus"
                    >
                      {t("results.clear_all")}
                    </Link>
                    <Link
                      href={`/rfq/new?to=${business.slug}`}
                      className="rounded-ctl bg-moss px-3 py-2 text-body-sm font-medium text-on-ink hover:bg-moss-hover focus-visible:outline-none focus-visible:shadow-focus"
                    >
                      {t("product.enquire")}
                    </Link>
                  </div>
                </div>
              ) : (
                <>
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
                          : t("response.median", {
                              duration: formatDuration(business.responseTimeMedianMs),
                            }),
                      pinned: true,
                    }}
                    products={view.products.map((product) => ({
                      id: product.id,
                      slug: product.slug,
                      businessSlug: business.slug,
                      name: product.name,
                      sku: product.sku,
                      availability: product.availability as never,
                      stockQty: product.stockQty,
                      leadTimeDays: product.leadTimeDays,
                      minOrderQty: product.minOrderQty,
                      imageUrl: product.imagePath
                        ? publicUrl(MEDIA_BUCKET, product.imagePath)
                        : null,
                      sizeLabel: primarySize(fields, product.specValues) ?? undefined,
                      size: primarySize(fields, product.specValues) ?? null,
                      specValues: product.specValues,
                      /*
                         Rendered here, on the server, and handed over as
                         elements. The tray is a client component and a function
                         cannot cross that boundary — passing one rendered the
                         whole grid as nothing at all.
                      */
                      ...(product.availability === "out_of_stock"
                        ? {
                            notify: (
                              <NotifyButton
                                productId={product.id}
                                productName={product.name}
                                signedIn={Boolean(actor)}
                                watch={watchProductAction}
                              />
                            ),
                          }
                        : {}),
                      ...(specRowsFor(product).length > 0
                        ? {
                            specs: (
                              <SpecTable
                                caption={t("catalogue.specs_caption", { product: product.name })}
                                rows={specRowsFor(product)}
                                notProvidedLabel={t("table.not_provided")}
                              />
                            ),
                          }
                        : {}),
                    }))}
                  />

                  {/*
                     An anchor, never infinite scroll. A buyer who has selected
                     three products and scrolled away has to be able to get back
                     to them, and an endless list has no back.
                  */}
                  {remaining > 0 && (
                    <div className="mt-5">
                      <Link
                        href={`${basePath}?${toCatalogueParams(query, { page: query.page + 1 })}`}
                        className="block rounded-ctl border border-line bg-card px-4 py-2.5 text-center text-body-sm font-medium text-ink hover:bg-paper focus-visible:outline-none focus-visible:shadow-focus"
                      >
                        {t("catalogue.show_more", {
                          count: Math.min(CATALOGUE_PAGE_SIZE, remaining),
                        })}
                      </Link>
                    </div>
                  )}

                  <div className="mt-5 rounded-card border border-dashed border-line px-4 py-3">
                    <p className="text-body-sm text-body">{t("catalogue.compare_prompt")}</p>
                    <Link
                      href="/compare"
                      className="mt-1 inline-block rounded-tag text-body-sm font-medium text-moss underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
                    >
                      {t("catalogue.compare_cta")}
                    </Link>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </PublicShell>
  );
}
