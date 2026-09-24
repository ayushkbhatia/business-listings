import { pairedCopies } from "@/lib/strings/store";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { Breadcrumb, PublicShell } from "@/components/structure";
import { buttonClassName } from "@/components/primitives";
import { serviceFieldValue } from "@/components/domain/service-views";
import {
  ServiceCatalogueCard,
  type ServiceCatalogueView,
} from "@/components/domain/ServicesStorefront";
import { getBusinessBySlug } from "@/lib/db/queries";
import { absorbedInto, redirectIfClosed, redirectIfMoved } from "@/lib/listing/redirect";
import { getActor } from "@/lib/auth/session";
import { publicServicesFor, type PublicService } from "@/lib/services/service";
import { serviceEnquiryVolume } from "@/lib/storefront/services";
import {
  applyServicesFilters,
  isServicesFiltered,
  mostEnquired,
  paginate,
  parseServicesQuery,
  servicesFacets,
  servicesQueryString,
  showsFilterGroups,
  sortByVolume,
  sortedByVolume,
} from "@/lib/storefront/services-catalogue";
import { sellsWork } from "@/lib/storefront/tabs";
import { formatCount, formatDuration } from "@/lib/format";
import { t } from "@/lib/i18n";
import { absoluteUrl } from "@/lib/site";
import { crawlRel } from "@/lib/seo/crawl-policy";
import { DirectoryFooter, DirectoryNav } from "@/app/(public)/_chrome";
import { JsonLd } from "@/app/(public)/_json-ld";
import { StorefrontHeader, storefrontCrumbs } from "../_storefront";
import { composerOptions } from "../_services";
import { ServiceEnquireDrawer } from "../ServiceEnquireDrawer";
import { OwnListingNote, isOwnListing } from "../_own";
import { CatalogueFilters } from "../products/CatalogueFilters";
import { ServicesFilterPanel } from "./_rail";

/**
 * Board `1e-s` — the services list: rows, not a photo grid.
 *
 * The goods `1e` tiles photographs with a stock figure across hundreds of rows.
 * A service has no photograph, so this inverts: a handful of long cards, each
 * carrying the same four-field block, the firm's own paragraph, and — the field
 * with no goods equivalent — what the buyer has to provide.
 *
 * **Sorted by what the firm takes on most** (B5): enquiry volume over ninety
 * days, from `EnquiryLine.serviceId`, with the seller's `3f-s` drag order as
 * the tiebreak — and as the whole order wherever there is no volume yet (Q3).
 * The sort line says which of the two it is, so the page never claims a ranking
 * it did not compute.
 *
 * **What it never carries:** a fee amount (B4), a completeness figure (B2), or
 * anything about availability (B7 — D11 closed as no).
 *
 * Every *Enquire* opens the service composer in a drawer, on that service; the
 * page's own *enquire about anything* and the footer's *enquire anyway* (B9)
 * open it on *something not listed*. A buyer choosing from a list keeps the
 * list.
 */
export const revalidate = 300;

interface Params {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params, searchParams }: Params): Promise<Metadata> {
  const { slug } = await params;
  const business = await getBusinessBySlug(slug);
  if (!business) return {};
  const query = parseServicesQuery(await searchParams);
  const live = business._count.services;

  return {
    title: t("services_index.title", { name: business.displayName }),
    description: t("storefront_services.list_meta", {
      name: business.displayName,
      count: live,
      formatted: formatCount(live),
    }),
    /*
       A filtered view is not a page worth ranking, and an empty list is thin
       by definition — both stay followable so the catch-all and the tabs are
       reached, and neither asks to be indexed. Every view canonicalises to the
       one list, from `business.slug` rather than the route parameter.
    */
    ...(isServicesFiltered(query) || live === 0 ? { robots: { index: false, follow: true } } : {}),
    alternates: { canonical: `/b/${business.slug}/services` },
  };
}

export default async function StorefrontServicesPage({ params, searchParams }: Params) {
  const { slug } = await params;
  const business = await getBusinessBySlug(slug);
  if (!business) {
    await redirectIfMoved(`/b/${slug}/services`);
    // Board 11i: a closed business's subpages go to its notice.
    await redirectIfClosed(slug);
    notFound();
  }
  const movedTo = await absorbedInto(slug);
  if (movedTo) permanentRedirect(`/b/${movedTo}/services`);
  if (business.claimStatus === "unclaimed") notFound();

  /*
     B10, and the empty state. A firm that sells work has this page even with
     nothing live — AC9's catch-all renders on its own, with a line saying so.
     A goods seller with no services has no services page at all, which is what
     the header's missing tab already says.
  */
  if (!sellsWork(business.sellsKind) && business._count.services === 0) notFound();

  const query = parseServicesQuery(await searchParams);
  const basePath = `/b/${business.slug}/services`;

  const [services, actor, copies] = await Promise.all([
    publicServicesFor(business.id),
    getActor(),
    pairedCopies(),
  ]);
  const volume = await serviceEnquiryVolume(
    business.id,
    services.map((service) => service.id),
  );

  const rows = services.map((service) => ({
    ...service,
    feeBasisLabel: service.rows.find((row) => row.key === "fee_basis")?.value ?? null,
  }));
  const ordered = sortByVolume(rows, volume);
  const leader = mostEnquired(rows, volume);
  const filtered = applyServicesFilters(ordered, query);
  const paged = paginate(filtered, query.page);
  const facets = servicesFacets(rows, query);

  const options = composerOptions(services);
  const responseLine =
    business.responseTimeMedianMs === null
      ? t("storefront_services.composer.reply_unmeasured")
      : t("storefront_services.composer.reply_measured", {
          duration: formatDuration(business.responseTimeMedianMs),
        });
  const askForContact = !actor;
  // Board `12g-s`: the drawer's heading is the services half of a paired string.
  const composerTitle = copies.services["section.enquiry.title"];
  // A seat on the firm's own team is offered no composer. See `../_own.tsx`.
  const own = isOwnListing(actor, business.id);

  const catchAll = (label: string, className: string) =>
    own ? null : (
      <ServiceEnquireDrawer
        businessId={business.id}
        businessName={business.displayName}
        services={options}
        service={null}
        serviceName={null}
        askForContact={askForContact}
        responseLine={responseLine}
        triggerLabel={label}
        triggerClassName={className}
        title={composerTitle}
      />
    );

  const pageHref = (page: number) => {
    const qs = servicesQueryString(query, { page });
    return qs ? `${basePath}?${qs}` : basePath;
  };

  return (
    <PublicShell
      bleed
      nav={<DirectoryNav />}
      breadcrumb={
        <Breadcrumb
          label={t("gallery.breadcrumb_label")}
          items={storefrontCrumbs(business, t("storefront.services"))}
        />
      }
      footer={<DirectoryFooter />}
    >
      {/*
         The services as an item list of offers — and no price. B4 names the
         structured data as a surface the fee must not reach; nothing on
         `PublicService` carries one, and an offer with no price is what *fee on
         enquiry* means to a machine.
      */}
      {services.length > 0 && (
        <JsonLd
          data={{
            "@context": "https://schema.org",
            "@type": "ItemList",
            name: t("services_index.title", { name: business.displayName }),
            numberOfItems: services.length,
            itemListElement: ordered.map((service, index) => ({
              "@type": "ListItem",
              position: index + 1,
              item: {
                "@type": "Service",
                name: service.name,
                url: absoluteUrl(`/b/${business.slug}/s/${service.slug}`),
                category: service.categoryName,
                provider: { "@type": "LocalBusiness", name: business.displayName },
              },
            })),
          }}
        />
      )}

      <div data-theme="default">
        <StorefrontHeader
          business={business}
          active="services"
          subline={t("storefront_services.list_subline", {
            count: services.length,
            formatted: formatCount(services.length),
          })}
        />

        <div className="mx-auto grid w-full max-w-7xl gap-[var(--gutter)] px-5 py-8 lg:grid-cols-[15rem_minmax(0,1fr)]">
          {services.length > 0 && (
            <div className="min-w-0">
              {showsFilterGroups(services.length) ? (
                <CatalogueFilters
                  appliedCount={query.engagement.length + query.fee.length}
                  rail={
                    <ServicesFilterPanel
                      basePath={basePath}
                      query={query}
                      total={services.length}
                      facets={facets}
                    />
                  }
                />
              ) : (
                <ServicesFilterPanel
                  basePath={basePath}
                  query={query}
                  total={services.length}
                  facets={facets}
                />
              )}
            </div>
          )}

          <div className={services.length > 0 ? "min-w-0" : "min-w-0 lg:col-span-2"}>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-h2 text-brand-ink">
                  {t("storefront_services.list_heading", {
                    count: filtered.length,
                    formatted: formatCount(filtered.length),
                  })}
                </h2>
                {services.length > 1 && (
                  <p className="mt-1 text-body-sm text-muted">
                    {sortedByVolume(rows, volume)
                      ? t("storefront_services.sorted_by_volume")
                      : t("storefront_services.sorted_by_firm")}
                  </p>
                )}
              </div>
              {catchAll(
                t("storefront_services.enquire_anything"),
                buttonClassName({ variant: "secondary" }),
              )}
            </div>

            {services.length === 0 ? (
              <p className="mt-6 max-w-[var(--measure-prose)] text-body-sm text-muted">
                {t("storefront_services.services_none", { name: business.displayName })}
              </p>
            ) : filtered.length === 0 ? (
              <p className="mt-6 text-body-sm text-muted">
                {t("storefront_services.filters_none")}{" "}
                <a href={basePath} className="rounded-tag text-moss underline-offset-4 hover:underline focus-visible:shadow-focus focus-visible:outline-none">
                  {t("storefront_services.filters_clear")}
                </a>
              </p>
            ) : (
              <ul className="mt-5 flex list-none flex-col gap-4 p-0">
                {paged.rows.map((service) => (
                  <li key={service.id}>
                    <ServiceCatalogueCard
                      service={catalogueView(service)}
                      businessSlug={business.slug}
                      enquiries={leader?.id === service.id ? leader.enquiries : null}
                      enquire={
                        own ? null : (
                          <ServiceEnquireDrawer
                            businessId={business.id}
                            businessName={business.displayName}
                            services={options}
                            service={service.slug}
                            serviceName={service.name}
                            askForContact={askForContact}
                            responseLine={responseLine}
                            title={composerTitle}
                            triggerClassName={buttonClassName({ block: true })}
                          />
                        )
                      }
                    />
                  </li>
                ))}
              </ul>
            )}

            {paged.pages > 1 && (
              <nav
                aria-label={t("storefront_services.pages_label")}
                className="mt-5 flex items-center justify-between gap-3 text-body-sm"
              >
                {paged.page > 1 ? (
                  <Link href={pageHref(paged.page - 1)} rel={crawlRel(pageHref(paged.page - 1))} className={buttonClassName({ variant: "secondary" })}>
                    {t("storefront_services.page_previous")}
                  </Link>
                ) : (
                  <span />
                )}
                <span className="tabular-nums text-muted">
                  {t("storefront_services.page_of", {
                    page: formatCount(paged.page),
                    pages: formatCount(paged.pages),
                  })}
                </span>
                {paged.page < paged.pages ? (
                  <Link href={pageHref(paged.page + 1)} rel={crawlRel(pageHref(paged.page + 1))} className={buttonClassName({ variant: "secondary" })}>
                    {t("storefront_services.page_next")}
                  </Link>
                ) : (
                  <span />
                )}
              </nav>
            )}

            {/*
               B9 — not optional, and in every state including the empty one. A
               catalogue can be exhaustive; a list of services cannot, and this
               is the page's release valve.
            */}
            {own ? (
              <div className="mt-5">
                <OwnListingNote />
              </div>
            ) : (
              <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-card px-5 py-4">
                <p className="text-body-sm text-body">{t("storefront_services.not_listed")}</p>
                {catchAll(
                  t("storefront_services.enquire_anyway"),
                  "rounded-tag text-body-sm font-medium text-brand-ink underline-offset-4 hover:underline focus-visible:shadow-focus focus-visible:outline-none",
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </PublicShell>
  );
}

/**
 * The loader's record, as the card shows it — the four fields in B1's order,
 * worded here where `t()` lives, and `null` wherever the firm has not said.
 */
function catalogueView(service: PublicService): ServiceCatalogueView {
  const row = (key: string) => service.rows.find((entry) => entry.key === key)?.value ?? null;
  const source = {
    engagementType: row("engagement_type"),
    turnaround: row("turnaround"),
    feeBasis: row("fee_basis"),
    deliveredWhere: row("delivered_where"),
  };
  return {
    slug: service.slug,
    name: service.name,
    summary: service.scope,
    fields: [
      { key: "engagement", value: serviceFieldValue("engagement", source) },
      { key: "turnaround", value: serviceFieldValue("turnaround", source) },
      { key: "fee_basis", value: serviceFieldValue("fee_basis", source) },
      { key: "delivered", value: serviceFieldValue("delivered", source) },
    ],
    provides: row("requires_from_client"),
  };
}
