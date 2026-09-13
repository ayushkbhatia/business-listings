import Link from "next/link";
import { buttonClassName } from "@/components/primitives";
import { Breadcrumb, Card, PublicShell } from "@/components/structure";
import { scopeWords } from "@/components/domain";
import { CredentialTable } from "@/components/domain/CredentialTable";
import {
  CoverageSummary,
  DeclaredSectors,
  ServiceSummaryCard,
  type ServiceSummaryView,
} from "@/components/domain/ServicesStorefront";
import type { ServiceEnquiryOption } from "@/components/domain/ServiceEnquiryComposer";
import type { PublicBusiness } from "@/lib/db/queries";
import type { PublicService } from "@/lib/services/service";
import { formatCount, formatDate, formatDuration, toE164 } from "@/lib/format";
import { t } from "@/lib/i18n";
import { absoluteUrl } from "@/lib/site";
import { MEDIA_BUCKET, publicUrl } from "@/lib/storage";
import { navPages } from "@/lib/storefront/pages";
import { storefrontPhotos } from "@/lib/storefront/photos";
import { servicesStorefrontFor, type ServicesStorefront } from "@/lib/storefront/services";
import {
  OVERVIEW_SERVICES,
  composerService,
  overviewCredentials,
} from "@/lib/storefront/services-overview";
import { openingHoursSchema } from "@/lib/trade/open-now";
import { DirectoryFooter, DirectoryNav } from "@/app/(public)/_chrome";
import { JsonLd } from "@/app/(public)/_json-ld";
import { ShortlistButton, shortlistLabels, toggleShortlistAction } from "@/app/(public)/_shortlist";
import { StorefrontHeader, storefrontCrumbs } from "./_storefront";
import { BusinessDetails, HoursPanel, LocationsPanel, VerificationPanel } from "./_rail";
import { ContactCard } from "./ContactCard";
import { ServiceEnquiryForm } from "./ServiceEnquiryForm";
import { ServiceEnquireDrawer } from "./ServiceEnquireDrawer";

/**
 * Board `1d-s` — the storefront with the catalogue taken out of it.
 *
 * The goods `1d` is the catalogue: products, stock, a price range, *view all
 * 340*. Take the catalogue out and the page has to answer a different question.
 * A buyer landing on an audit practice is not asking *what do you have in
 * stock*; they are asking *do you do work like mine, and can you prove you are
 * allowed to do it.*
 *
 * So, top to bottom: **what we take on**, **services as rows with
 * deliverables**, **credentials with who checked them** where stock would be,
 * then **sectors**. The rail leads with an enquiry that describes a situation
 * rather than a quantity.
 *
 * Nothing here knows which trade it is rendering. An audit practice, a cleaning
 * contractor and a customs broker take the same composition, and speak through
 * their own data — the owner's standing rule for this track.
 *
 * ## What the page never carries
 *
 *  - **No catalogue tab** (B1) — `lib/storefront/tabs.ts`, shared with the
 *    header, the tab routes and the sitemap.
 *  - **No fee amount** in the page, the payload, the meta or the structured data
 *    (B5). `publicServicesFor` does not select `indicativeFee`.
 *  - **No availability chip** (B9). D11 closed as no.
 *  - **No site-visit badge, and no `visitedAt` read** (B10). The columns are
 *    gone from `Business` and the ladder is three tiers.
 */

type Actor = { id: string } | null;

export async function ServicesStorefrontPage({
  business,
  actor,
  saved,
  requestedService,
}: {
  business: PublicBusiness;
  actor: Actor;
  saved: boolean;
  requestedService: string | null;
}) {
  const [data, pages] = await Promise.all([
    servicesStorefrontFor(business.id),
    business.sectorId ? navPages(business.sectorId) : Promise.resolve([]),
  ]);

  const head = business.locations[0];
  const crumbs = storefrontCrumbs(business);
  const photos = storefrontPhotos(business.plan, business.media);
  const responseLine = replyLine(business.responseTimeMedianMs);

  /*
     "Request a quote" opens an empty composer, and on this page the composer is
     already on the page — so the trigger is a link to it rather than a drawer
     with a second copy of the form inside. The vocabulary rule, and the
     duplicate-composer rule, in one anchor.
  */
  const toComposer = (label: string, block = false) => (
    <a href="#enquire" className={buttonClassName({ block, size: block ? "lg" : "md" })}>
      {label}
    </a>
  );

  const identityActions = (
    <ContactCard
      layout="row"
      businessId={business.id}
      businessSlug={business.slug}
      phone={head?.phone ?? null}
      whatsapp={head?.whatsapp ?? null}
      enquire={toComposer(t("storefront.request_quote"))}
      saveAction={
        <ShortlistButton
          businessId={business.id}
          saved={saved}
          signedIn={Boolean(actor)}
          toggle={toggleShortlistAction}
          labels={shortlistLabels(`/b/${business.slug}`)}
        />
      }
    />
  );

  return (
    <PublicShell
      bleed
      nav={<DirectoryNav />}
      breadcrumb={<Breadcrumb label={t("gallery.breadcrumb_label")} items={crumbs} />}
      footer={<DirectoryFooter />}
    >
      <ServicesJsonLd business={business} data={data} />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: crumbs.map((crumb, i) => ({
            "@type": "ListItem",
            position: i + 1,
            name: crumb.label,
            item: crumb.href,
          })),
        }}
      />

      <div data-theme={business.themePreset ?? "default"}>
        <StorefrontHeader
          business={business}
          active="overview"
          pages={pages}
          actions={identityActions}
          {...(photos.length > 0 ? { photoHref: "#photos" } : {})}
        />

        {/*
           The same grid the goods overview uses, and for the same reason: on a
           tablet the composer sits under the identity block, done with grid
           order on one DOM node rather than by rendering the form twice.
        */}
        <div className="mx-auto mt-6 grid max-w-7xl gap-[var(--gutter)] px-5 pb-[var(--section-pad)] lg:grid-cols-[minmax(0,1fr)_21.25rem] lg:grid-rows-[auto_1fr] xl:grid-cols-[minmax(0,1fr)_23.75rem]">
          <div
            id="enquire"
            /*
               `scroll-mt-20`, not the photos section's `-6`: every link to this
               composer lands on its heading, and the directory nav is sticky —
               at `-6` the heading scrolled in underneath it.
            */
            className="order-1 min-w-0 scroll-mt-20 lg:order-none lg:col-start-2 lg:row-start-1"
          >
            <Card>
              <h2 className="text-h3 text-brand-ink">{t("storefront_services.composer.title")}</h2>
              <div className="mt-2">
                <ServiceEnquiryForm
                  businessId={business.id}
                  businessName={business.displayName}
                  services={composerOptions(data.services)}
                  initialService={composerService(data.services, requestedService)}
                  askForContact={!actor}
                  responseLine={responseLine}
                />
              </div>
            </Card>
          </div>

          <div className="order-2 flex min-w-0 flex-col gap-10 lg:order-none lg:col-start-1 lg:row-span-2 lg:row-start-1">
            {business.description && (
              <section aria-labelledby="take-on">
                <h2 id="take-on" className="text-h2 text-brand-ink">
                  {t("storefront_services.take_on_title")}
                </h2>
                <p className="mt-3 max-w-[var(--measure-prose)] whitespace-pre-line text-prose text-prose">
                  {business.description}
                </p>
              </section>
            )}

            <ServicesSection business={business} data={data} mode="anchor" signedIn={Boolean(actor)} />

            <CredentialsSection business={business} data={data} />

            {data.sectors.length > 0 && (
              <section aria-labelledby="sectors">
                <h2 id="sectors" className="text-h2 text-brand-ink">
                  {t("storefront_services.sectors_title")}
                </h2>
                <div className="mt-3">
                  <DeclaredSectors sectors={data.sectors} />
                </div>
              </section>
            )}

            {photos.length > 0 && (
              <section id="photos" aria-labelledby="photos-title" className="scroll-mt-20">
                <h2 id="photos-title" className="text-h2 text-brand-ink">
                  {t("storefront.photos_heading")}
                </h2>
                <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                  {photos.map((photo) => (
                    <li
                      key={photo.id}
                      className="relative aspect-[4/3] overflow-hidden rounded-chip border border-line"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={publicUrl(MEDIA_BUCKET, photo.storagePath)}
                        alt={photo.alt ?? ""}
                        className="absolute inset-0 h-full w-full object-cover"
                        loading="lazy"
                      />
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/*
               The licence record, the authority and the masked TRN — platform
               facts, and the one place the trade name reaches a public surface,
               marked licence-locked. Kept on this composition as on the goods
               one: the render has no room drawn for it, and dropping the only
               checked facts on a listing to match a render is the wrong trade.
            */}
            <BusinessDetails business={business} lastUpdated={formatDate(business.updatedAt)} />
          </div>

          <aside className="order-3 flex min-w-0 flex-col gap-3 lg:order-none lg:col-start-2 lg:row-start-2">
            <LocationsPanel business={business} />
            <HoursPanel
              hours={(head?.hours ?? null) as never}
              ramadanHours={(head?.ramadanHours ?? null) as never}
            />
            <CoverageSummary
              places={data.coverage.map((place) => place.label)}
              modes={data.deliveryModes}
            />
            <VerificationPanel business={business} />
          </aside>
        </div>

        <div className="h-16 md:hidden" aria-hidden />
        <ContactCard
          layout="bar"
          businessId={business.id}
          businessSlug={business.slug}
          phone={head?.phone ?? null}
          whatsapp={head?.whatsapp ?? null}
          enquire={toComposer(t("listing.enquire"), true)}
        />
      </div>
    </PublicShell>
  );
}

/* ── Services ────────────────────────────────────────────────────────────── */

/**
 * The services rows — shared by this composition and the goods overview of a
 * firm that sells both, where `mode="drawer"` because that rail's composer is
 * the goods one.
 */
export function ServicesSection({
  business,
  data,
  mode,
  signedIn,
}: {
  business: PublicBusiness;
  data: ServicesStorefront;
  mode: "anchor" | "drawer";
  signedIn: boolean;
}) {
  const shown = data.services.slice(0, OVERVIEW_SERVICES);
  const options = composerOptions(data.services);

  return (
    <section aria-labelledby="services-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="services-title" className="text-h2 text-brand-ink">
          {t("storefront.services")}
        </h2>
        {data.services.length > 0 && (
          <Link
            href={`/b/${business.slug}/services`}
            className="rounded-tag text-body-sm text-ink underline-offset-4 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
          >
            {t("storefront_services.all_services", {
              count: data.services.length,
              formatted: formatCount(data.services.length),
            })}
          </Link>
        )}
      </div>

      {shown.length === 0 ? (
        /*
           The cold-start state, said. A firm that has claimed and published but
           not yet put a service live is still taking enquiries — the composer
           beside this offers *something not listed* — and the page says what is
           missing rather than rendering an empty grid.
        */
        <p className="mt-3 max-w-[var(--measure-prose)] text-body-sm text-muted">
          {t("storefront_services.services_none", { name: business.displayName })}
        </p>
      ) : (
        <ul className="mt-4 grid list-none gap-4 p-0 md:grid-cols-2">
          {shown.map((service) => (
            <li key={service.id}>
              <ServiceSummaryCard
                service={summaryOf(service)}
                businessSlug={business.slug}
                {...(mode === "drawer"
                  ? {
                      enquire: (
                        <ServiceEnquireDrawer
                          businessId={business.id}
                          businessName={business.displayName}
                          services={options}
                          service={service.slug}
                          serviceName={service.name}
                          askForContact={!signedIn}
                          responseLine={replyLine(business.responseTimeMedianMs)}
                        />
                      ),
                    }
                  : {})}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ── Credentials ─────────────────────────────────────────────────────────── */

/**
 * *What they hold, and who checked it* — where stock availability sits.
 *
 * **Omitted when there are none**, per the board's state table, and the hero
 * keeps its licence badge. The service page says the empty case in a sentence
 * instead; the rows themselves are one component on both, which is the
 * cross-board invariant.
 *
 * **Rendered on every plan.** Board 1d strips *certificates* from a Free
 * storefront — the documents section, a paid feature. A credential here is not
 * a document: it is a trust line whose file never travels, and non-negotiable 2
 * says trust signals render identically on every storefront. Gating them on a
 * plan would make *who checked it* something a firm buys.
 */
export function CredentialsSection({
  business,
  data,
}: {
  business: PublicBusiness;
  data: ServicesStorefront;
}) {
  if (data.credentials.length === 0) return null;
  const { shown, more } = overviewCredentials(data.credentials);

  return (
    <section aria-labelledby="credentials-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="credentials-title" className="text-h2 text-brand-ink">
          {t("storefront_services.credentials_tab")}
        </h2>
        <p className="text-body-sm text-muted">{t("storefront_services.credentials_hint")}</p>
      </div>
      <div className="mt-4">
        <CredentialTable
          rows={shown}
          name={business.displayName}
          caption={t("storefront_services.credentials_caption", { name: business.displayName })}
          {...(more > 0
            ? {
                footer: (
                  <div className="flex flex-wrap items-center justify-between gap-2 text-body-sm">
                    <span className="text-muted">
                      {t("storefront_services.credentials_more", { count: more, formatted: formatCount(more) })}
                    </span>
                    <Link
                      href={`/b/${business.slug}/credentials`}
                      className="rounded-tag text-ink underline-offset-4 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
                    >
                      {t("storefront_services.credentials_see_all")}
                    </Link>
                  </div>
                ),
              }
            : {})}
        />
      </div>
    </section>
  );
}

/* ── Structured data ─────────────────────────────────────────────────────── */

/**
 * `LocalBusiness`, with the services as an offer catalogue — and **no price**.
 *
 * B5 names the structured data as a surface the fee must not reach, and it
 * cannot: nothing in `ServicesStorefront` carries one. Each `Offer` is a
 * `Service` the firm performs, with `areaServed` from the same coverage union
 * the rail prints (B7), and no `price`, `priceSpecification` or `priceRange`.
 * An offer with no price is valid schema, and it is what *price on enquiry*
 * means to a machine.
 *
 * No `aggregateRating` without reviews — a rating object with a zero count is a
 * rich result built on nothing.
 */
function ServicesJsonLd({ business, data }: { business: PublicBusiness; data: ServicesStorefront }) {
  const head = business.locations[0];
  const areaServed = data.coverage.map((place) => ({
    "@type": place.areaId ? "Place" : "AdministrativeArea",
    name: place.label,
  }));

  return (
    <JsonLd
      data={{
        "@context": "https://schema.org",
        "@type": "LocalBusiness",
        name: business.displayName,
        description: business.headline ?? business.description ?? undefined,
        identifier: business.licenceNumber,
        url: absoluteUrl(`/b/${business.slug}`),
        foundingDate: business.establishedYear ? String(business.establishedYear) : undefined,
        address: head
          ? {
              "@type": "PostalAddress",
              streetAddress: head.addressLine,
              addressLocality: head.area.name,
              addressRegion: t(`emirate.${head.emirate}` as never),
              addressCountry: "AE",
            }
          : undefined,
        telephone: head?.phone ? (toE164(head.phone) ?? head.phone) : undefined,
        openingHoursSpecification: openingHoursSchema(
          (head?.hours ?? null) as never,
          (head?.ramadanHours ?? null) as never,
        ),
        areaServed: areaServed.length > 0 ? areaServed : undefined,
        knowsAbout: data.sectors.length > 0 ? data.sectors.map((sector) => sector.label) : undefined,
        hasOfferCatalog:
          data.services.length > 0
            ? {
                "@type": "OfferCatalog",
                name: t("storefront.services"),
                itemListElement: data.services.map((service) => ({
                  "@type": "Offer",
                  itemOffered: {
                    "@type": "Service",
                    name: service.name,
                    url: absoluteUrl(`/b/${business.slug}/s/${service.slug}`),
                    category: service.categoryName,
                    ...(areaServed.length > 0 ? { areaServed } : {}),
                  },
                })),
              }
            : undefined,
        aggregateRating:
          business._count.reviews > 0 && business.ratingOverall
            ? {
                "@type": "AggregateRating",
                ratingValue: business.ratingOverall,
                reviewCount: business._count.reviews,
                bestRating: 5,
                worstRating: 1,
              }
            : undefined,
      }}
    />
  );
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */

/** The loader's record, as the row shows it. Worded here, where `t()` lives. */
export function summaryOf(service: PublicService): ServiceSummaryView {
  return {
    slug: service.slug,
    name: service.name,
    chips: service.chips.map((chip) => scopeWords(chip.key, chip.value)),
    deliverable: service.rows.find((row) => row.key === "deliverable")?.value ?? null,
  };
}

/** What the composer needs to know about each service, and nothing more. */
export function composerOptions(services: readonly PublicService[]): ServiceEnquiryOption[] {
  return services.map((service) => ({
    slug: service.slug,
    name: service.name,
    familyId: service.familyId,
    requiresFromClient: service.rows.find((row) => row.key === "requires_from_client")?.value ?? null,
  }));
}

/** The measured reply line, or the honest one where nothing has been measured. */
function replyLine(medianMs: number | null): string {
  return medianMs === null
    ? t("storefront_services.composer.reply_unmeasured")
    : t("storefront_services.composer.reply_measured", { duration: formatDuration(medianMs) });
}
