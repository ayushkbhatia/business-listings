import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { redirectIfMoved, absorbedInto } from "@/lib/listing/redirect";
import { Button } from "@/components/primitives";
import { Breadcrumb, Card, KeyValuePanel, Panel, PublicShell } from "@/components/structure";
import { ListingCard, tierSpec } from "@/components/domain";
import { getBusinessBySlug, getSimilarClaimedBusinesses } from "@/lib/db/queries";
import { formatDate, formatDuration } from "@/lib/format";
import { MEDIA_BUCKET, publicUrl } from "@/lib/storage";
import { t } from "@/lib/i18n";
import { absoluteUrl } from "@/lib/site";
import { DirectoryFooter, DirectoryNav } from "@/app/(public)/_chrome";
import { JsonLd } from "@/app/(public)/_json-ld";
import { StorefrontHeader, storefrontCrumbs } from "./_storefront";
import { renderSection } from "@/components/storefront";
import { storefrontPlan } from "@/lib/storefront/loader";
import { openingHoursSchema } from "@/lib/trade/open-now";
import { ContactCard } from "./ContactCard";
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
import { navPages } from "@/lib/storefront/pages";
import { PageEvent } from "@/components/telemetry";
import { ShortlistButton, shortlistLabels, toggleShortlistAction } from "@/app/(public)/_shortlist";
import { isShortlisted } from "@/lib/shortlist/service";

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
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const business = await getBusinessBySlug(slug);
  if (!business) return {};

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
    alternates: { canonical: `/b/${slug}` },
    openGraph: {
      title: business.displayName,
      description,
      type: "website",
      url: `/b/${slug}`,
    },
    // An unclaimed page is thin by nature and honest about it. It stays
    // indexable — 30,000 of them are how a supplier first finds us — but it
    // never claims a rating it does not have.
    robots: unclaimed ? { index: true, follow: true } : undefined,
  };
}

export default async function StorefrontPage({ params }: Params) {
  const { slug } = await params;
  const business = await getBusinessBySlug(slug);
  if (!business) {
    /*
     * Before the 404, the two ways a listing legitimately moves: a rename wrote
     * a redirect, or a merge absorbed it. Both have been writing rows nothing
     * read since handoff 0.
     */
    await redirectIfMoved(`/b/${slug}`);
    notFound();
  }

  const movedTo = await absorbedInto(slug);
  if (movedTo) permanentRedirect(`/b/${movedTo}`);

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
        <ClaimedStorefront business={business} />
      )}
    </>
  );
}

type Business = NonNullable<Awaited<ReturnType<typeof getBusinessBySlug>>>;

// ─────────────────────────────────────────────────────────────────────────────
// Board 1d — the claimed composition
// ─────────────────────────────────────────────────────────────────────────────

async function ClaimedStorefront({ business }: { business: Business }) {
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

  const plan = await storefrontPlan({
    id: business.id,
    slug: business.slug,
    sectorId: business.sectorId,
    themePreset: business.themePreset,
  });
  /*
   * Still needed here for the structured data, which describes the business
   * rather than the page. Schema.org wants a postal address whether or not a
   * template happens to enable the branches section.
   */
  const head = business.locations[0];
  const crumbs = storefrontCrumbs(business);

  // Template pages marked for the nav. Empty where the trade has no template.

  const pages = business.sectorId ? await navPages(business.sectorId) : [];


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
     44px each and the slot is row-only — see `ContactCard`. Adding a fourth
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
     The same actions twice, at opposite breakpoints, hidden with `display`.

     Exactly one is in the accessibility tree at any width — `visibility` or
     opacity would leave two sets of identically-labelled buttons for a screen
     reader, which is the trap board 1b's filter rail already had to avoid.
  */
  const mobileActionBar = (
    <ContactCard
      layout="bar"
      businessId={business.id}
      businessSlug={business.slug}
      phone={head?.phone ?? null}
      whatsapp={head?.whatsapp ?? null}
      enquire={enquireTrigger}
    />
  );

  const identityActions = (
    <ContactCard
      layout="row"
      businessId={business.id}
      businessSlug={business.slug}
      phone={head?.phone ?? null}
      whatsapp={head?.whatsapp ?? null}
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

  /*
     Free plan, and what it does not get.

     Board 1d: no plan chip, no featured products, three photos maximum, no
     certificates. The composer stays — "that is the free tier's whole value",
     and a directory that took the enquiry form away from its free listings
     would be a directory with nothing to sell an upgrade against.

     A listing with no plan row is treated as Free rather than as Pro. Most of
     them are unclaimed imports; defaulting the other way would hand the best
     storefront to every listing nobody has claimed.
  */
  const freePlan = (business.plan?.id ?? "free") === "free";

  const FREE_PHOTO_LIMIT = 3;
  const allPhotos = business.media.filter((item) => item.kind === "gallery");
  const photos = freePlan ? allPhotos.slice(0, FREE_PHOTO_LIMIT) : allPhotos;

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
             The real number, not the masked one.

             The mask exists so that asking for a supplier's number is an event
             we can count, and that reasoning does not apply to a crawler: it
             will not send an enquiry, and a search result showing "04 88• ••••"
             helps nobody. Board 1d says it in as many words — schema is for
             machines.
          */
          telephone: head?.phone ?? undefined,
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
        Rendered from the sector's storefront template, not from this file.
        Until now these sections were a fixed sequence of JSX here, which made
        criterion 2 — "reordering, enabling or disabling a section changes every
        live storefront on that template and nothing else" — a statement about a
        function no route called.

        The seller theme scopes here and nowhere above it. It recolours the
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
      {plan.data.products.slice(0, 4).map((product) => (
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

      <div data-theme={plan.theme}>
        <StorefrontHeader
          business={business}
          active="overview"
          pages={pages}
          actions={identityActions}
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

               Gallery media existed and the overview rendered none of it — it
               was reachable only through a template page's gallery block, which
               most storefronts do not have. So "View all 28 photos" had a count
               and nowhere to go, and the honest options were to drop the button
               or give it a destination. This is the destination.

               Removed entirely at zero, like every other section on this page.
            */}
            {photos.length > 0 && (
              <section id="photos" className="scroll-mt-6">
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

            <BusinessDetails business={business} lastUpdated={formatDate(business.updatedAt)} />

            {plan.sections
              /*
                Two sections are chrome and are drawn elsewhere.

                `header` was already filtered: `StorefrontHeader` draws it, and
                rendering both would put the trade name on the page twice.
                `enquiry_form` joins it now that board 1d puts a real composer
                in the rail — a page offering the same form twice makes a buyer
                choose between two identical doors, and the rail's copy is the
                one carrying the measured reply time and the privacy line.

                The section stays in the template and stays editable; it is this
                composition that has somewhere better to put it.
              */
              .filter((section) => section.type !== "header" && section.type !== "enquiry_form")
              /*
                 Featured products and certificates are what a paid storefront
                 buys. Gated here rather than in the template so the rule holds
                 whatever a seller's sections say — a Free listing whose
                 template still lists them would render them.
              */
              .filter(
                (section) =>
                  !freePlan ||
                  (section.type !== "featured_products" && section.type !== "certifications"),
              )
              .map((section) => (
                <div key={section.id}>
                  {renderSection({
                    section,
                    data: plan.data,
                    content: plan.content[section.id] ?? {},
                    /*
                       Criterion 3: a storefront contains no link to the
                       fan-out. It is a single-seller surface — the buyer has
                       chosen, and a picker would undo the choice. The section
                       composes in place instead, through the same island the
                       identity block uses.

                       `enquireHref` stays pointed at this storefront's own
                       catalogue for the sections that link rather than compose.
                    */
                    enquireHref: `/b/${business.slug}/products`,
                    enquireSlot: enquireTrigger,
                  })}
                </div>
              ))}
          </div>

          {/*
            The aside is chrome, not a section, and that is not a shortcut.

            It carries the licence number, the authority, the masked TRN and the
            verification ladder — platform-owned facts. Non-negotiable 2 says
            trust signals render identically on every storefront, which is an
            argument that a template must not be able to reorder them, restyle
            them or switch them off. A sector whose template dropped the licence
            panel would be a sector where we quietly stopped showing what we
            checked.

            The contact card sits here for the same reason: the reveal is the
            event that proves the platform delivered the enquiry, and it is not
            a seller's to compose away.
          */}

          {/*
            Board 1d's rail: the composer, the hours, where they are, and what
            we checked. Chrome rather than template sections, and the reason is
            unchanged from when the ladder sat here — non-negotiable 2 says
            trust signals render identically on every storefront, which is an
            argument that a seller's template must not be able to reorder them,
            restyle them or switch them off. A sector whose template dropped the
            licence panel would be a sector where we quietly stopped showing
            what we checked.

            The composer is here for the neighbouring reason: the enquiry is the
            conversion event and it is not a seller's to compose away.
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
      </div>
    </PublicShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Board 10g — the unclaimed composition. Same route, no second page component.
// ─────────────────────────────────────────────────────────────────────────────

async function UnclaimedStorefront({ business }: { business: Business }) {
  const head = business.locations[0];
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
            <div className="mt-3 flex flex-wrap gap-2">
              <Button disabled title={t("enquiry.disabled")}>
                {t("listing.claim_cta")}
              </Button>
              <Button variant="link" disabled title={t("enquiry.disabled")}>
                {t("listing.report")}
              </Button>
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
                      visitedAt: other.visitedAt,
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
