import { pairedCopies } from "@/lib/strings/store";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound, permanentRedirect } from "next/navigation";
import { redirectIfMoved, absorbedInto } from "@/lib/listing/redirect";
import { Button, buttonClassName } from "@/components/primitives";
import { Breadcrumb, Card, KeyValuePanel, Panel, PublicShell } from "@/components/structure";
import { ListingCard, tierSpec } from "@/components/domain";
import { getBusinessBySlug, getSimilarClaimedBusinesses } from "@/lib/db/queries";
import { formatDate, formatDuration } from "@/lib/format";
import { MEDIA_BUCKET, publicUrl } from "@/lib/storage";
import { t } from "@/lib/i18n";
import { absoluteUrl } from "@/lib/site";
import { DirectoryFooter, DirectoryNav } from "@/app/(public)/_chrome";
import { JsonLd } from "@/app/(public)/_json-ld";
import { crawlRel } from "@/lib/seo/crawl-policy";
import { StorefrontHeader, storefrontCrumbs } from "./_storefront";
import { ClosedStorefront } from "./_closed";
import { closedListing } from "@/lib/closure/public";
import { Branches, CatalogueGrid, Hero, Reviews, TrustStrip } from "@/components/storefront";
import { CompareTick } from "@/app/(public)/_compare/CompareTick";
import { storefrontData } from "@/lib/storefront/loader";
import { openingHoursSchema } from "@/lib/trade/open-now";
import { ContactActions, ContactReveal, RevealNote } from "./ContactReveal";
import { storefrontContact } from "@/lib/contact/storefront";
import {
  BusinessDetails,
  CapabilityChips,
  EnquiryComposer,
  HoursPanel,
  LocationsPanel,
  VerificationPanel,
} from "./_rail";
import { EnquireButton } from "./EnquireDrawer";
import { EMIRATES } from "@/lib/uae";
import { getActor } from "@/lib/auth/session";
import { PageEvent } from "@/components/telemetry";
import { ShortlistButton, shortlistLabels, toggleShortlistAction } from "@/app/(public)/_shortlist";
import { isShortlisted } from "@/lib/shortlist/service";
import { storefrontPhotos } from "@/lib/storefront/photos";
import { servicesStorefrontFor } from "@/lib/storefront/services";
import { CredentialsSection, ServicesSection, ServicesStorefrontPage } from "./_services";
import { ReportDialog, ReportTrigger } from "./ReportDialog";
import { fileReport, loadReportForm } from "@/app/(public)/report/actions";
import { reportFormData } from "@/lib/reports/form";
import { reportSubject } from "@/lib/reports/subject";

export const revalidate = 300;

/**
 * Our availability vocabulary, in schema.org's.
 *
 * `made_to_order` and `indent` both map to `PreOrder` rather than `InStock`:
 * they describe something a buyer cannot collect today, which is what the
 * schema term means. `BackOrder` would be the closer literal match for indent
 * and is the wrong word here — CLAUDE.md's vocabulary table names backorder as
 * a term this product does not use, because an indent order is the supplier's
 * own process rather than a failure to stock something.
 */
const SCHEMA_AVAILABILITY: Record<string, string> = {
  in_stock: "https://schema.org/InStock",
  made_to_order: "https://schema.org/PreOrder",
  indent: "https://schema.org/PreOrder",
  out_of_stock: "https://schema.org/OutOfStock",
};

interface Params {
  params: Promise<{ slug: string }>;
  /**
   * `service` — board `1d-s` B11. The service a buyer arrived asking about,
   * from `1g-s` or the services tab, which the composer opens on.
   */
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params, searchParams }: Params): Promise<Metadata> {
  const { slug } = await params;
  /*
     Board 13c `B6`. `?report=1` is the report modal, and a URL somebody can
     share is a URL a crawler can find. The storefront underneath is the same
     page, so it keeps its canonical; the modal's own address is `noindex`, and
     `robots.txt` has disallowed `/b/*?` since the facet work.
  */
  const reporting = (await searchParams)?.["report"] !== undefined;
  const business = await getBusinessBySlug(slug);
  if (!business) {
    // Board 11i Q5. The notice is readable by direct link and indexed nowhere.
    const closed = await closedListing(slug);
    return closed
      ? {
          title: t("closed.meta_title", { name: closed.displayName }),
          robots: { index: false, follow: false },
        }
      : {};
  }

  const head = business.locations[0];
  const area = head?.area.name ?? "";
  const emirate = head ? t(`emirate.${head.emirate}` as never) : "";
  const unclaimed = business.claimStatus === "unclaimed";

  const description = unclaimed
    ? t("seo.unclaimed_description", {
        name: business.displayName,
        authority: business.licenceAuthority,
        area,
        emirate,
      })
    : t("seo.business_description", {
        name: business.displayName,
        category: business.primaryCategory.name,
        area,
        emirate,
        verification: t(tierSpec(business.verificationTier).checkedKey as never) + ".",
      });

  return {
    title: `${business.displayName} — ${business.primaryCategory.name}`,
    description,
    /*
       From `business.slug`, never from the route parameter.

       A storefront answers on two paths since 9 Sep 2026: its slug, and the
       label on the seller's own web address, which `proxy.ts` rewrites to
       `/b/<label>`. Building the canonical from the parameter would have each
       address declare itself canonical, which is the whole of what a canonical
       is for. `metadataBase` is `NEXT_PUBLIC_SITE_URL`, so this resolves to the
       directory's host whichever one served the page.
    */
    alternates: { canonical: `/b/${business.slug}` },
    openGraph: {
      title: business.displayName,
      description,
      type: "website",
      url: `/b/${business.slug}`,
    },
    // An unclaimed page is thin by nature and honest about it. It stays
    // indexable — 30,000 of them are how a supplier first finds us — but it
    // never claims a rating it does not have.
    robots: reporting
      ? { index: false, follow: false }
      : unclaimed
        ? { index: true, follow: true }
        : undefined,
  };
}

export default async function StorefrontPage({ params, searchParams }: Params) {
  const { slug } = await params;
  const query = (await searchParams) ?? {};
  const requestedService = typeof query.service === "string" ? query.service : null;
  const business = await getBusinessBySlug(slug);
  if (!business) {
    /*
     * Before the 404, the two ways a listing legitimately moves: a rename wrote
     * a redirect, or a merge absorbed it. Both have been writing rows nothing
     * read since handoff 0.
     */
    await redirectIfMoved(`/b/${slug}`);
    /*
     * And the one way it legitimately leaves: board 11i. A closed business is
     * not a 404 — it existed, buyers reviewed it — and not a storefront.
     */
    const closed = await closedListing(slug);
    if (closed) return <ClosedStorefront listing={closed} searchParams={query} />;
    notFound();
  }

  const movedTo = await absorbedInto(slug);
  if (movedTo) permanentRedirect(`/b/${movedTo}`);

  /*
     Board 13c. Built on the server only when the request already asks for the
     modal — a shared `?report=1` link — so it opens on the form. Every other
     storefront render skips it, and the modal fetches it on the click instead.
  */
  const reportData =
    query.report === "1"
      ? await reportSubject(slug).then(async (subject) =>
          subject ? reportFormData(subject, (await getActor()) !== null) : null,
        )
      : null;

  return (
    <>
      {/*
         The view, counted from the browser and not from this render.

         Two reasons, and both are about what the word "view" is allowed to
         mean. This route declares `revalidate = 300`, so one render can be
         served to many readers — a render is not a visit, and counting here
         would report a busy storefront as one hit every five minutes. And this
         directory is built to be crawled: a crawler that does not run
         JavaScript is not a buyer, and a seller's "views since you went live"
         made mostly of Googlebot is a number they would be right to stop
         believing.

         `listing_viewed` is the one event with no session behind it. It
         increments `listing_view_day` and writes no `product_event` row, so an
         anonymous visitor is counted and never followed.

         Mounted above the branch rather than inside the claimed composition,
         because an unclaimed listing is looked at too, and that count is the
         history a supplier inherits on the day they claim it. `recordListingView`
         will not count a draft or a suspended listing whatever is posted at it.
      */}
      <PageEvent name="listing_viewed" businessId={business.id} />
      {business.claimStatus === "unclaimed" ? (
        <UnclaimedStorefront business={business} />
      ) : (
        <ClaimedStorefront business={business} requestedService={requestedService} />
      )}
      {/*
         Board 13c — the report modal, mounted once beside both compositions so
         the unclaimed panel's link and the verification rail's link open the
         same thing. In a `Suspense` because it reads the query string on the
         client, and a component that does must not hold up the page around it.

         After the page, not before it. A closed `<dialog>` is still in the
         document, and the `Modal` panel carries a `<header>`: mounted first,
         that header was the page's first one, ahead of the site's banner —
         which is what the viewport spec's `header.first()` found, and what a
         landmark-reading tool would find too. `showModal()` puts it in the top
         layer wherever it sits in the source.
      */}
      <Suspense fallback={null}>
        <ReportDialog
          slug={business.slug}
          businessName={business.displayName}
          initialData={reportData}
          loadReportForm={loadReportForm}
          fileReport={fileReport}
        />
      </Suspense>
    </>
  );
}

type Business = NonNullable<Awaited<ReturnType<typeof getBusinessBySlug>>>;

// ─────────────────────────────────────────────────────────────────────────────
// Board 1d — the claimed composition
// ─────────────────────────────────────────────────────────────────────────────

async function ClaimedStorefront({
  business,
  requestedService,
}: {
  business: Business;
  requestedService: string | null;
}) {
  // Decides whether the composer asks for a phone number, and now also who the
  // save control is answering for. A buyer with no account can still send an
  // enquiry — that is the point of the provisional identity — they just have to
  // say where the quotes should go.
  const actor = await getActor();

  /*
     Only asked where there is somebody to ask about. A shortlist is keyed on a
     user and there is no anonymous one — `lib/shortlist/service.ts` says why,
     and a query with no user to key it on would be a round trip that could only
     ever answer false.
  */
  const saved = actor ? await isShortlisted(actor.id, business.id) : false;

  /*
     Board `1d-s`. A firm that sells only work gets the storefront with the
     catalogue taken out of it — its own composition, not this one with
     sections hidden, because the page is answering a different question. See
     `./_services.tsx`.

     A firm that sells both keeps this composition and gains the services and
     credentials sections below, with the catalogue and the services as
     separate tabs (B2).
  */
  if (business.sellsKind === "services") {
    return (
      <ServicesStorefrontPage
        business={business}
        actor={actor}
        saved={saved}
        requestedService={requestedService}
      />
    );
  }
  const work = business.sellsKind === "both" ? await servicesStorefrontFor(business.id) : null;
  // Board `12g-s`: the services composer's heading is the services half of a paired string.
  const composerTitle = work ? (await pairedCopies()).services["section.enquiry.title"] : "";

  const data = await storefrontData({
    id: business.id,
    slug: business.slug,
    sellsKind: business.sellsKind,
  });
  /*
   * Still needed here for the structured data, which describes the business
   * rather than the page. Schema.org wants a postal address whether or not the
   * business has any published branch to draw.
   */
  const head = business.locations[0];
  const crumbs = storefrontCrumbs(business);
  const sectionEnquireHref = `/b/${business.slug}/products`;

  /*
     The action row, hoisted out of the rail and into the identity block.

     Board 1d puts the quote, the two channels and save beside the name, which
     is where a buyer looks for them. The rail keeps the composer — a form is
     not a button row, and the two are doing different jobs.
  */
  const enquireTrigger = (
    <EnquireButton
      block
      size="lg"
      businessId={business.id}
      businessSlug={business.slug}
      displayName={business.displayName}
      categoryId={business.primaryCategoryId}
      emirates={EMIRATES}
      signedIn={Boolean(actor)}
      /*
         "Enquire", not "Send enquiry".

         Board 1d sets the rule: "Request a quote" opens a composer, "Send
         enquiry" is the submit inside one, and "Enquire" is the compact control
         where there is room for neither. This bar is the compact control.
      */
      triggerLabel={t("listing.enquire")}
      recipient={{
        businessId: business.id,
        displayName: business.displayName,
        areaName: head?.area?.name ?? null,
        verificationTier: business.verificationTier,
        responseLabel:
          business.responseTimeMedianMs === null
            ? t("response.unmeasured")
            : t("response.median", {
                duration: formatDuration(business.responseTimeMedianMs),
              }),
        pinned: true,
      }}
    />
  );

  /*
     Save, beside the quote and the two channels.

     ## What the cache does to `saved`

     This file declares `revalidate = 300`, and Cache Components is off, so the
     previous caching model applies: the page is cacheable for five minutes
     unless something in the render reads a request-time API. `getActor()` reads
     the request's cookies, so today every render of this route is dynamic and
     `saved` is this buyer's own answer.

     That is a property of the current composition, not a guarantee. Anything
     that puts the page back in the cache — a `force-static` above, an
     `unstable_cache` wrapped round the actor, a CDN rule in front — would serve
     one buyer's "Saved" to the next reader, who would then press a button that
     says it is removing something they never saved.

     Which is why signed-out is decided twice and not once. The prop is the fast
     answer and the refusal is the true one: `toggleShortlistAction` resolves the
     actor server-side and refuses `signed_out`, and the button turns itself into
     the sign-in link on that refusal rather than on this prop. A cached page can
     be wrong about who is reading it; it cannot make the write succeed.

     `shortlistLabels` is handed the path to come back to and encodes it itself.
     `/b/<slug>` is a same-origin absolute path, which is the shape `isSafeNext`
     in lib/auth/flow.ts accepts and the sign-in screen will honour.

     No save control on the mobile bar. That bar is WhatsApp · Call · Enquire at
     44px each and the slot is row-only — see `ContactActions`. Adding a fourth
     control there is a layout decision, and it is in the follow-ups.
  */
  const saveAction = (
    <ShortlistButton
      businessId={business.id}
      saved={saved}
      signedIn={Boolean(actor)}
      toggle={toggleShortlistAction}
      labels={shortlistLabels(`/b/${business.slug}`)}
    />
  );

  /*
     Board `1d` amendment — the landline masked, asked for and revealed in
     place. Decided once for this render: whether this viewer already revealed
     in this session, whether the form still stands between them and the
     number, and what it opens with. See `lib/contact/storefront.ts`.
  */
  const contact = await storefrontContact(business, actor);

  /*
     The same actions twice, at opposite breakpoints, hidden with `display`.

     Exactly one is in the accessibility tree at any width — `visibility` or
     opacity would leave two sets of identically-labelled buttons for a screen
     reader, which is the trap board 1b's filter rail already had to avoid.
  */
  const mobileActionBar = (
    <ContactActions
      layout="bar"
      masked={contact.masked}
      whatsAppHref={contact.whatsAppHref}
      enquire={enquireTrigger}
    />
  );

  const identityActions = (
    <ContactActions
      layout="row"
      masked={contact.masked}
      whatsAppHref={contact.whatsAppHref}
      enquire={
        <EnquireButton
          businessId={business.id}
          businessSlug={business.slug}
          displayName={business.displayName}
          categoryId={business.primaryCategoryId}
          emirates={EMIRATES}
          signedIn={Boolean(actor)}
          triggerLabel={t("storefront.request_quote")}
          recipient={{
            businessId: business.id,
            displayName: business.displayName,
            areaName: head?.area?.name ?? null,
            verificationTier: business.verificationTier,
            responseLabel:
              business.responseTimeMedianMs === null
                ? t("response.unmeasured")
                : t("response.median", {
                    duration: formatDuration(business.responseTimeMedianMs),
                  }),
            pinned: true,
          }}
        />
      }
      saveAction={saveAction}
    />
  );

  // The photo cut is the plan row's, in one function both compositions share.
  const photos = storefrontPhotos(business.plan, business.media);

  return (
    <PublicShell
      bleed
      nav={<DirectoryNav />}
      breadcrumb={<Breadcrumb label={t("gallery.breadcrumb_label")} items={crumbs} />}
      footer={<DirectoryFooter />}
    >
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "LocalBusiness",
          name: business.displayName,
          description: business.description ?? undefined,
          identifier: business.licenceNumber,
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
          geo:
            head?.lat != null && head.lng != null
              ? { "@type": "GeoCoordinates", latitude: head.lat, longitude: head.lng }
              : undefined,
          /*
             No `telephone`, since the `1d` amendment.

             Board 1d's spec put the real number here — "schema is for
             machines" — when the number cost one click. Behind three fields it
             cannot also sit in this page's source: the amendment's `B2` is
             that a masked number is not in the payload, and JSON-LD is payload
             every visitor and every scraper receives. A knowledge panel without
             a phone number costs less than a form anybody can read past.
          */
          /*
             The week as the schema expects it, from the same source the rail
             renders — including the Ramadan override, because a machine reading
             this during Ramadan should be told the hours that are actually in
             effect rather than the ones on file.
          */
          openingHoursSpecification: openingHoursSchema(
            (head?.hours ?? null) as never,
            (head?.ramadanHours ?? null) as never,
          ),
          // aggregateRating only when reviews exist. A rating object with a zero
          // count is a rich result built on nothing.
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

      {/*
        The storefront palette scopes here and nowhere above it. It colours the
        heading, links and buttons inside; the verification badge is drawn from
        the status palette and is unaffected by design.
      */}
      {/*
         Criterion 11's other half: `Product` on the featured cards, with
         `offers.availability` and **no price at all**.

         Omitted entirely rather than left blank, which is the difference
         between "we do not publish prices" and "this product costs nothing".
         `Product` has no price column and `QuoteLine` is where a price lives,
         private to one buyer and one seller — so there is nothing here to omit
         from, and that is the point.

         Capped at the four the board draws. A page emitting a hundred Product
         objects is asking a crawler to treat a catalogue as a shop window.
      */}
      {data.products.slice(0, 4).map((product) => (
        <JsonLd
          key={product.id}
          data={{
            "@context": "https://schema.org",
            "@type": "Product",
            name: product.name,
            sku: product.sku ?? undefined,
            url: absoluteUrl(`/b/${business.slug}/p/${product.slug}`),
            image: product.imageUrl ?? undefined,
            brand: { "@type": "Brand", name: business.displayName },
            offers: {
              "@type": "Offer",
              availability: SCHEMA_AVAILABILITY[product.availability],
              seller: { "@type": "Organization", name: business.displayName },
              url: absoluteUrl(`/b/${business.slug}/p/${product.slug}`),
            },
          }}
        />
      ))}

      <div data-theme="default">
        <ContactReveal
          businessId={contact.businessId}
          supplierName={contact.supplierName}
          formRequired={contact.formRequired}
          prefill={contact.prefill}
          initial={contact.initial}
          note={contact.note}
          privacyHref={contact.privacyHref}
        >
        <StorefrontHeader
          business={business}
          active="overview"
          actions={identityActions}
          notice={<RevealNote />}
          {...(photos.length > 0 ? { photoHref: "#photos" } : {})}
        />

        {/*
           Criterion 12: on a tablet the composer sits directly below the
           identity block, not below the left column.

           Done with grid order on one DOM node rather than by rendering the
           form twice. A second composer is what this page already had and what
           the section filter removed — duplicating it here to satisfy a
           breakpoint would put two identical forms back on the page, with the
           same field ids, for a reader on a tablet.

           So the composer is its own grid child: first in source order, moved
           into the rail's first row at `lg`. Below that it simply stays where
           it is, which is exactly where the board wants it.
        */}
        <div className="mx-auto mt-6 grid max-w-7xl gap-[var(--gutter)] px-5 pb-[var(--section-pad)] lg:grid-cols-[minmax(0,1fr)_18.75rem] lg:grid-rows-[auto_1fr] xl:grid-cols-[minmax(0,1fr)_21.25rem]">
          <div className="order-1 min-w-0 lg:order-none lg:col-start-2 lg:row-start-1">
            <EnquiryComposer
              business={business}
              emirates={EMIRATES}
              signedIn={Boolean(actor)}
              responseLabel={
                business.responseTimeMedianMs === null
                  ? t("response.unmeasured")
                  : t("response.median", {
                      duration: formatDuration(business.responseTimeMedianMs),
                    })
              }
              {...(business.responseTimeMedianMs !== null
                ? { answeredWithin: formatDuration(business.responseTimeMedianMs) }
                : {})}
            />
          </div>
          <div className="order-2 flex min-w-0 flex-col gap-8 lg:order-none lg:col-start-1 lg:row-span-2 lg:row-start-1">
            {/*
               The photos the cover's button points at.

               Gallery media existed and the overview rendered none of it, so
               "View all 28 photos" had a count and nowhere to go, and the
               honest options were to drop the button or give it a destination.
               This is the destination.

               Removed entirely at zero, like every other section on this page.
            */}
            {photos.length > 0 && (
              <section id="photos" className="scroll-mt-20">
                <h2 className="text-h2 text-brand-ink">{t("storefront.photos_heading")}</h2>
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
               Board 1d's business details, in the left column where the board
               puts them. They were in the rail as "at a glance" and moved with
               the rail's rebuild — the licence, the authority and the masked
               TRN are platform-owned facts and were not going to be quietly
               dropped on the way.
            */}
            <CapabilityChips business={business} />

            {/*
               Board `1d-s` B2 — a firm that sells both. The catalogue stays
               this page's lead and its tab; the services and the credentials
               follow as their own sections, and a service row opens the
               service composer in a drawer, because this rail's composer asks
               for quantities.
            */}
            {work && (
              <ServicesSection
                business={business}
                data={work}
                mode="drawer"
                signedIn={Boolean(actor)}
                composerTitle={composerTitle}
              />
            )}
            {work && (
              <CredentialsSection business={business} data={work} />
            )}

            <BusinessDetails business={business} lastUpdated={formatDate(business.updatedAt)} />

            {/*
               The overview's sections, in a fixed order. The header is
               `StorefrontHeader` above and the composer is the rail's, so
               neither is drawn here a second time.

               Criterion 3: a storefront contains no link to the fan-out. It is
               a single-seller surface — the buyer has chosen, and a picker
               would undo the choice. A section composes in place instead,
               through the same island the identity block uses; `enquireHref`
               stays pointed at this storefront's own catalogue for the ones
               that link rather than compose.
            */}
            <div>
              <Hero data={data} enquireHref={sectionEnquireHref} enquireSlot={enquireTrigger} />
            </div>
            <div>
              <TrustStrip data={data} enquireHref={sectionEnquireHref} />
            </div>
            <div>
              <CatalogueGrid
                data={data}
                enquireHref={sectionEnquireHref}
                compare={Object.fromEntries(
                  data.products.map((product) => [
                    product.id,
                    <CompareTick
                      key={product.id}
                      productId={product.id}
                      productName={product.name}
                      tradeId={product.categoryId}
                    />,
                  ]),
                )}
              />
            </div>
            <div>
              <Reviews data={data} enquireHref={sectionEnquireHref} />
            </div>
            <div>
              <Branches data={data} enquireHref={sectionEnquireHref} />
            </div>
          </div>

          {/*
            Board 1d's rail: the composer, the hours, where they are, and what
            we checked. Chrome, not a section: it carries the licence number,
            the authority, the masked TRN and the checks — platform-owned facts
            that non-negotiable 2 says render identically on every storefront.

            The composer and the contact actions in the identity block are
            chrome for the neighbouring reason: the enquiry is the conversion
            event, and the reveal is what proves the platform delivered it.
          */}
          <aside className="order-3 flex min-w-0 flex-col gap-3 lg:order-none lg:col-start-2 lg:row-start-2">
            <HoursPanel
              hours={(head?.hours ?? null) as never}
              ramadanHours={(head?.ramadanHours ?? null) as never}
            />

            <LocationsPanel business={business} />

            <VerificationPanel business={business} />
          </aside>
        </div>

        {/*
           Padding so the last section is not sitting under the bar, and the bar
           itself. Both only exist below `md`.
        */}
        <div className="h-16 md:hidden" aria-hidden />
        {mobileActionBar}
        </ContactReveal>
      </div>
    </PublicShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Board 10g — the unclaimed composition. Same route, no second page component.
// ─────────────────────────────────────────────────────────────────────────────

async function UnclaimedStorefront({ business }: { business: Business }) {
  const head = business.locations[0];
  const claimHref = `/onboarding/claim?q=${encodeURIComponent(business.displayName)}`;
  const similar = await getSimilarClaimedBusinesses(
    { id: business.primaryCategoryId, parentId: business.primaryCategory.parentId },
    business.id,
    head?.emirate ?? null,
    2,
  );
  const crumbs = storefrontCrumbs(business);

  return (
    <PublicShell
      nav={<DirectoryNav />}
      breadcrumb={<Breadcrumb label={t("gallery.breadcrumb_label")} items={crumbs} />}
      footer={<DirectoryFooter />}
    >
      {/*
        LocalBusiness with no aggregateRating, no opening hours and no telephone.
        Only what the licence record actually holds. Marking up hours we do not
        have would be a lie in a machine-readable format, which is the worst
        kind.
      */}
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "LocalBusiness",
          name: business.displayName,
          legalName: business.tradeName, // licence-locked
          identifier: business.licenceNumber,
          address: head
            ? {
                "@type": "PostalAddress",
                addressLocality: head.area.name,
                addressRegion: t(`emirate.${head.emirate}` as never),
                addressCountry: "AE",
              }
            : undefined,
        }}
      />

      <header className="border-b border-line pb-5">
        <p className="font-mono text-eyebrow uppercase text-faint">
          {business.primaryCategory.name}
        </p>
        <h1 className="mt-0.5 font-serif text-h1-serif text-ink">{business.displayName}</h1>
        {head && (
          <p className="mt-1 text-body-sm text-muted">
            {head.area.name} · {t(`emirate.${head.emirate}` as never)}
          </p>
        )}
      </header>

      <div className="mt-5 grid gap-[var(--gutter)] lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0">
          <Panel title={t("listing.unclaimed_title")}>
            <p className="max-w-[var(--measure-prose)] text-prose text-prose">
              {t("listing.unclaimed_body")}
            </p>
            {/*
               Both of these were `disabled` with the tooltip "Enquiries open in
               the next release" — stale, and wrong twice: this page has no
               enquiry action by design, and the claim flow shipped long ago.
               `2a` names the claim prompt on an unclaimed listing as one of its
               four entry points and already reads a pre-filled `q`, so the
               destination and the intent existed and only the href was absent.

               Report opens board `13c`'s modal, as the storefront rail's
               *Report an issue* does; the footer's *Report a listing* goes to
               the `/report` hub, which has no listing to open one over.

               `crawlRel` on the claim link because this composition renders on
               roughly 30,000 pages, each producing a distinct `?q=` URL into a
               noindex funnel step. That is the shape `lib/seo/crawl-policy.ts`
               exists to stop, and it derives the answer from the href rather
               than trusting anyone to remember.
            */}
            <div className="mt-3 flex flex-wrap gap-2">
              <Link
                href={claimHref}
                rel={crawlRel(claimHref)}
                className={buttonClassName()}
              >
                {t("listing.claim_cta")}
              </Link>
              {/*
                 Boards 4h and 13c. *Report this listing* opened the
                 verification policy until 4h; it opens the report modal now,
                 over this page, and falls back to `/report/:slug` wherever a
                 script cannot run. On an unclaimed listing this is the most
                 likely thing on the page to be wrong, and the person who knows
                 is standing in front of it.
              */}
              <ReportTrigger
                slug={business.slug}
                className={buttonClassName({ variant: "link" })}
              >
                {t("listing.report")}
              </ReportTrigger>
            </div>
          </Panel>

          <section className="mt-5">
            <h2 className="text-h2 text-ink">{t("storefront.at_a_glance")}</h2>
            <div className="mt-2">
              {/*
                Only the licence record. Absent fields are marked absent rather
                than dropped — and there is no rating, no review count, no
                hours and no empty star row anywhere on this page.
              */}
              <KeyValuePanel
                notProvidedLabel={t("table.not_provided")}
                entries={[
                  { key: "trade", label: t("storefront.about"), value: business.tradeName }, // licence-locked
                  { key: "licence", label: t("storefront.licence"), value: business.licenceNumber, mono: true },
                  { key: "authority", label: t("storefront.authority"), value: business.licenceAuthority },
                  { key: "expiry", label: t("listing.licence_expiry"), value: formatDate(business.licenceExpiry) },
                  { key: "area", label: t("trade.emirate"), value: head ? `${head.area.name}, ${t(`emirate.${head.emirate}` as never)}` : undefined },
                  { key: "category", label: t("storefront.categories"), value: business.primaryCategory.name },
                  { key: "established", label: t("storefront.established") },
                  { key: "team", label: t("storefront.team") },
                  { key: "languages", label: t("storefront.languages") },
                  { key: "phone", label: t("storefront.phone") },
                ]}
              />
            </div>
          </section>
        </div>

        <aside className="min-w-0">
          {similar.businesses.length > 0 && (
            <Card padded={false}>
              <div className="border-b border-line px-4 py-3">
                <h2 className="text-h3 text-ink">{t(`listing.similar.${similar.basis}` as never)}</h2>
              </div>
              <div className="flex flex-col gap-2 p-3">
                {similar.businesses.map((other) => (
                  <ListingCard
                    /*
                       Another supplier's card, on this supplier's storefront.
                       It goes to their storefront, where a buyer can compose in
                       place — criterion 3 again, and a fan-out started from
                       somebody else's card is the wrong shape twice over.
                    */
                    enquireHref={`/b/${other.slug}`}
                    key={other.id}
                    context="map"
                    business={{
                      slug: other.slug,
                      displayName: other.displayName,
                      categoryName: other.primaryCategory.name,
                      categoryCode: other.primaryCategory.code,
                      areaName: other.locations[0]?.area.name ?? "",
                      emirateName: other.locations[0]
                        ? t(`emirate.${other.locations[0].emirate}` as never)
                        : "",
                      verificationTier: other.verificationTier,
                      verifiedAt: other.verifiedAt,
                      responseTimeMedianMs: other.responseTimeMedianMs,
                      responseDurationLabel: other.responseTimeMedianMs
                        ? formatDuration(other.responseTimeMedianMs)
                        : undefined,
                      reviewCount: other.reviewCount,
                    }}
                  />
                ))}
              </div>
            </Card>
          )}
        </aside>
      </div>
    </PublicShell>
  );
}
