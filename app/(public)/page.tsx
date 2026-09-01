import Link from "next/link";
import type { Metadata } from "next";
import { ChipLink, CategoryMark } from "@/components/display";
import { DirectorySearchBar, ListingCard, ProductCard, RfqPanel, TrustPanel } from "@/components/domain";
import { PublicShell } from "@/components/structure";
import { getActor } from "@/lib/auth/session";
import { isSellerRole } from "@/lib/auth/roles";
import {
  getEmirateChips,
  getHomePlans,
  getHomeSectors,
  getHomeStats,
  getNewCatalogueProducts,
  getOpenRfqTeasers,
  getPopularQueries,
  getRecentlyVerified,
} from "@/lib/db/queries";
import { formatCount, formatDuration, formatRelative } from "@/lib/format";
import { MEDIA_BUCKET, publicUrl } from "@/lib/storage";
import { t } from "@/lib/i18n";
import { DirectoryFooter, DirectoryNav } from "./_chrome";
import { JsonLd } from "./_json-ld";

/**
 * Board 1a — the directory home.
 *
 * One job: get a buyer into a category, a search, or an RFQ within one
 * interaction. It is not a marketing page and it does not explain the product.
 * A returning buyer should be able to ignore everything below the fold forever,
 * which is why the search bar and the open-requests panel are the only things
 * above it.
 *
 * Server-rendered, with no client-side data fetching on first paint. Every
 * number is a query rather than a constant — "a stale count is worse than no
 * count, because the whole proposition is that we know what is actually out
 * there" — and three sections are specified to disappear rather than pad
 * themselves. Their selection rules live in `lib/db/queries/home.ts` beside the
 * queries that enforce them.
 *
 * ## What is deliberately absent
 *
 * No hero image. The LCP target is two seconds on a 4G phone and the hero is
 * text, so the largest paint is an `h1` that is already in the HTML.
 *
 * No price, anywhere near a product. `Product` has no price column and no
 * public surface renders one; the plan tiles in §7 are the platform's own
 * subscription and read from the `Plan` table, which is a different thing and
 * the only money on the page.
 */

/*
 * Dynamic route, cached data.
 *
 * This page reads the session, because criterion 9 says a signed-in seller must
 * never be shown a claim CTA and there is no way to know that without a cookie.
 * A cookie read opts the whole route out of static rendering, which makes a
 * page-level `revalidate` inert — so declaring one here would have looked like
 * a caching strategy while being nothing, and every visit to the most-linked
 * page on the site would have been eight queries against Postgres.
 *
 * The caching moved to the reads instead, which is where the spec's own data
 * table puts it: an hour for the counts, five minutes for the two recency
 * sections, a minute for the RFQ panel. See `HOME_CACHE_TAG` in
 * lib/db/queries/home.ts. A cache hit serves without touching the database and
 * only the session lookup is per-request, so the personalisation costs one
 * indexed read rather than the whole page.
 */

export async function generateMetadata(): Promise<Metadata> {
  const stats = await getHomeStats();
  return {
    title: t("seo.home_title", { listings: formatCount(stats.verified) }),
    description: t("seo.home_description", {
      listings: formatCount(stats.listings),
      categories: stats.sectors,
    }),
    alternates: { canonical: "/" },
  };
}

export default async function HomePage() {
  const [stats, popular, rfqs, sectors, emirates, verified, products, plans, actor] =
    await Promise.all([
      getHomeStats(),
      getPopularQueries(),
      getOpenRfqTeasers(),
      getHomeSectors(),
      getEmirateChips(),
      getRecentlyVerified(),
      getNewCatalogueProducts(),
      getHomePlans(),
      getActor(),
    ]);

  const isSeller = Boolean(actor?.roles.some(isSellerRole));
  const signedIn = Boolean(actor);

  /*
     The five seeded terms, for a directory with no search history yet. The
     spec names them and calls them a fallback: the live five are the top real
     queries of the last thirty days that returned something, and a fresh
     install has none of those rather than having five bad ones.
  */
  const FALLBACK_QUERIES = [
    "HVAC maintenance AMC",
    "Steel fabrication",
    "Pallet racking",
    "Trade licence renewal",
    "Corporate catering",
  ];
  const chips = popular.length > 0 ? popular : FALLBACK_QUERIES;

  return (
    <PublicShell bleed nav={<DirectoryNav />} footer={<DirectoryFooter />}>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "WebSite",
          name: "Business Listings",
          url: "/",
          potentialAction: {
            "@type": "SearchAction",
            target: { "@type": "EntryPoint", urlTemplate: "/search?q={search_term_string}" },
            "query-input": "required name=search_term_string",
          },
        }}
      />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: t("chrome.directory"), item: "/" },
          ],
        }}
      />

      {/* ── 2 · Hero ──────────────────────────────────────────────────── */}
      <section className="border-b border-line bg-paper">
        <div className="mx-auto flex max-w-7xl flex-col gap-10 px-5 pt-11 pb-11 lg:flex-row lg:items-start lg:gap-12">
          <div className="min-w-0 flex-1">
            <h1 className="max-w-[560px] font-serif text-[2.375rem] leading-[1.08] tracking-[-0.02em] text-ink sm:text-[2.875rem]">
              {t("home.hero_title")}
            </h1>
            <p className="mt-3.5 mb-6 max-w-[500px] text-prose leading-[1.6] text-body">
              {/*
                 Three live numbers in one sentence. "If a count would round to
                 a marketing figure, show the real one" — formatCount groups
                 thousands and does nothing else.
              */}
              {t("home.hero_body", {
                listings: formatCount(stats.listings),
                sectors: stats.sectors,
              })}
            </p>

            <DirectorySearchBar
              formLabel={t("home.search_landmark")}
              whatLabel={t("home.search_what")}
              whereLabel={t("home.search_where")}
              whatPlaceholder={t("home.search_what_placeholder")}
              anywhereLabel={t("home.search_where_all")}
              submitLabel={t("home.search_cta")}
            />

            <div className="mt-4.5 flex flex-wrap items-center gap-2">
              <span className="me-0.5 text-caption text-muted">{t("home.popular")}</span>
              {chips.map((query) => (
                <ChipLink key={query} size="sm" href={`/search?q=${encodeURIComponent(query)}`}>
                  {query}
                </ChipLink>
              ))}
            </div>
          </div>

          {/*
             Real open requests, or the verification ladder. Never an empty
             state: an empty "no open requests" card on the hero of a
             marketplace says the marketplace is empty.
          */}
          {rfqs.length > 0 ? (
            <RfqPanel
              signedIn={signedIn}
              rows={rfqs.map((rfq) => ({
                id: rfq.id,
                requirement: rfq.requirement,
                categoryName: rfq.categoryName,
                place: rfq.emirate ? t(`emirate.${rfq.emirate}` as never) : t("home.rfq_uae"),
                quoteCount: rfq.quoteCount,
                // Formatted here, in a server component, so the string reaches
                // the client as data rather than being recomputed against a
                // different clock. See RfqPanelRow.age.
                age: formatRelative(rfq.createdAt),
              }))}
            />
          ) : (
            <TrustPanel />
          )}
        </div>
      </section>

      {/* ── 3 · Browse by category ────────────────────────────────────── */}
      <section className="border-b border-line bg-card">
        <div className="mx-auto max-w-7xl px-5 py-10">
          <div className="mb-5 flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="font-serif text-[1.625rem] tracking-[-0.01em] text-ink">
              {t("home.browse_title")}
            </h2>
            <Link
              href="/categories"
              className="rounded-tag text-body-sm font-medium text-moss underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
            >
              {t("home.browse_all", {
                sectors: stats.sectors,
                subcategories: formatCount(stats.subcategories),
              })}
            </Link>
          </div>

          {/*
             A list, because it is one — criterion 11 asks axe for exactly this
             and a screen reader gets "12 items" instead of twelve unrelated
             links.
          */}
          <ul className="grid grid-cols-2 gap-3.5 md:grid-cols-3 xl:grid-cols-4">
            {sectors.map((sector) => (
              <li key={sector.id}>
                <a
                  href={`/c/${sector.slug}`}
                  className={
                    // The whole card is the target, not just the name.
                    "flex h-full flex-col gap-2.5 rounded-card-lg border border-line bg-paper p-4 " +
                    "transition-colors duration-120 ease-out hover:border-line-strong " +
                    "focus-visible:outline-none focus-visible:shadow-focus"
                  }
                >
                  <div className="flex items-center justify-between">
                    <CategoryMark code={sector.code} size="lg" />
                    <span className="font-mono text-eyebrow tabular-nums text-muted">
                      {formatCount(sector.listings)}
                    </span>
                  </div>
                  <span className="text-h3 font-medium text-ink">{sector.name}</span>
                  {/*
                     The four largest subcategories, not the first four
                     alphabetically. Dropped entirely below 768, where the card
                     is a name and a count.
                  */}
                  {sector.topSubcategories.length > 0 && (
                    <span className="hidden text-caption leading-[1.45] text-muted sm:block">
                      {sector.topSubcategories.join(" · ")}
                    </span>
                  )}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── 4 · By emirate ────────────────────────────────────────────── */}
      <section className="border-b border-line bg-paper-sunk">
        <div className="mx-auto max-w-7xl px-5 py-5">
          <div className="flex items-center gap-2.5 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:flex-wrap md:overflow-visible">
            <h2 className="me-1 shrink-0 font-mono text-eyebrow uppercase tracking-[.12em] text-muted">
              {t("home.emirate_eyebrow")}
            </h2>
            {emirates.chips.map((chip) => (
              <ChipLink
                key={chip.emirate}
                href={`/search?emirate=${chip.emirate}`}
                count={formatCount(chip.count)}
              >
                {t(`emirate.${chip.emirate}` as never)}
              </ChipLink>
            ))}
            <span aria-hidden="true" className="mx-1 hidden h-5.5 w-px shrink-0 bg-line md:block" />
            {/*
               A cross-cutting filter, not an eighth emirate. A JAFZA company
               is in Dubai *and* in a free zone.
            */}
            <ChipLink dashed href="/search?freeZone=1" count={formatCount(emirates.freeZone)}>
              {t("home.free_zones")}
            </ChipLink>
          </div>
        </div>
      </section>

      {/* ── 5 · Verified this week ────────────────────────────────────── */}
      {/*
         Dropped entirely when fewer than four businesses had their tier raised
         in the window. A card here must be genuinely newly verified or the
         section is a lie, and there is no version of it filled from general
         listings.
      */}
      {verified.length > 0 && (
        <section className="border-b border-line bg-paper">
          <div className="mx-auto max-w-7xl px-5 py-10">
            <div className="mb-5 flex flex-wrap items-baseline justify-between gap-3">
              <div>
                <h2 className="font-serif text-[1.625rem] tracking-[-0.01em] text-ink">
                  {t("home.verified_title")}
                </h2>
                <p className="mt-1.5 max-w-[var(--measure-prose)] text-body-sm text-muted">
                  {t("home.verified_body")}
                </p>
              </div>
              <Link
                href="/search?verified=1"
                className="rounded-tag text-body-sm font-medium text-moss underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
              >
                {t("home.verified_all")}
              </Link>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {verified.map((business) => (
                <ListingCard
                  key={business.id}
                  context="grid"
                  business={{
                    slug: business.slug,
                    displayName: business.displayName,
                    categoryName: business.primaryCategory.name,
                    categoryCode: business.primaryCategory.code,
                    areaName: business.locations[0]?.area.name ?? "",
                    emirateName: business.locations[0]
                      ? t(`emirate.${business.locations[0].emirate}` as never)
                      : "",
                    verificationTier: business.verificationTier,
                    verifiedAt: business.verifiedAt,
                    visitedAt: business.visitedAt,
                    productCount: business._count.products,
                    reviewCount: business.reviewCount,
                    ratingOverall: business.ratingOverall,
                    establishedYear: business.establishedYear,
                    responseTimeMedianMs: business.responseTimeMedianMs,
                    responseDurationLabel: business.responseTimeMedianMs
                      ? formatDuration(business.responseTimeMedianMs)
                      : undefined,
                  }}
                />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── 6 · New in supplier catalogues ────────────────────────────── */}
      {products.length > 0 && (
        <section className="border-b border-line bg-card">
          <div className="mx-auto max-w-7xl px-5 py-10">
            <div className="mb-5 flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="font-serif text-[1.625rem] tracking-[-0.01em] text-ink">
                {t("home.catalogue_title")}
              </h2>
              <Link
                href="/search?tab=products"
                className="rounded-tag text-body-sm font-medium text-moss underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
              >
                {t("home.catalogue_all")}
              </Link>
            </div>

            {/*
               A 1.5-card horizontal scroll below 768, so the row reads as
               something to swipe rather than as five stacked cards.
            */}
            <div className="-mx-5 flex snap-x gap-3.5 overflow-x-auto px-5 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 lg:grid-cols-4 xl:grid-cols-5 [&::-webkit-scrollbar]:hidden">
              {products.map((product) => (
                <div key={product.id} className="w-[66%] shrink-0 snap-start sm:w-auto">
                  <ProductCard
                    /*
                       Live, not disabled. The board's note that "the enquiry
                       action is disabled in handoff 1 and live from handoff 2"
                       was written before handoff 2 shipped — /rfq/new has been
                       real since h2s3, and every other product surface on the
                       site passes this. Leaving it off here would have put five
                       dead buttons on the home page.
                    */
                    enquireHref={`/rfq/new?to=${product.business.slug}`}
                    product={{
                      slug: product.slug,
                      businessSlug: product.business.slug,
                      name: product.name,
                      sku: product.sku,
                      availability: product.availability,
                      stockQty: product.stockQty,
                      leadTimeDays: product.leadTimeDays,
                      minOrderQty: product.minOrderQty,
                      // Media rows carry a storage path, not a URL. The
                      // bucket is public, so this is a string build rather
                      // than a signed-link round trip per card.
                      imageUrl: product.media[0]
                        ? publicUrl(MEDIA_BUCKET, product.media[0].storagePath)
                        : null,
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── 7 · Supplier CTA ──────────────────────────────────────────── */}
      {/*
         Never shown to somebody who has already claimed a listing. A claim CTA
         in front of a seller who claimed last month is the platform admitting
         it does not know who is reading.
      */}
      {isSeller ? (
        <section className="bg-ink-surface">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-5 py-7">
            <p className="text-body text-on-ink-muted">{t("home.seller_signed_in")}</p>
            <Link
              href="/dashboard"
              className="rounded-tag text-body-sm font-medium text-moss-on-ink underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus-on-ink"
            >
              {t("home.seller_dashboard")}
            </Link>
          </div>
        </section>
      ) : (
        <section className="bg-ink-surface">
          {/*
             The whole band is the link and the tiles are not individually
             clickable — three targets inside a fourth is three ways to miss.
             It points at the claim flow rather than at /pricing, which
             docs/routes.md still marks as board 1l and unbuilt; the band's own
             copy is "claim your listing free", so this is where it was going.
          */}
          <Link
            href="/onboarding/claim"
            className="mx-auto flex max-w-7xl flex-col justify-between gap-8 px-5 py-11 focus-visible:outline-none focus-visible:shadow-focus-on-ink lg:flex-row lg:items-center lg:gap-12"
          >
            <div className="max-w-[560px]">
              <h2 className="font-serif text-[2rem] leading-[1.15] tracking-[-0.015em] text-on-ink">
                {t("home.seller_title")}
              </h2>
              <p className="mt-3 text-body leading-[1.6] text-on-ink-muted">
                {t("home.seller_body")}
              </p>
            </div>

            <div className="grid shrink-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {plans.map((plan, index) => {
                // The last tile is the one the design marks out, and it is
                // marked with the moss that is permitted on ink — never with a
                // status colour, which would let a paid tier borrow the trust
                // palette.
                const featured = index === plans.length - 1;
                return (
                  <div
                    key={plan.id}
                    className={
                      "w-full rounded-card-lg border p-4 lg:w-[186px] " +
                      (featured
                        ? "border-moss-on-ink bg-ink-moss"
                        : "border-ink-line bg-ink-raised")
                    }
                  >
                    <p
                      className={
                        "font-mono text-eyebrow uppercase tracking-[.1em] " +
                        (featured ? "text-moss-on-ink" : "text-on-ink-muted")
                      }
                    >
                      {plan.name}
                    </p>
                    {/*
                       AED 0 / AED 349 / AED 899, from the `Plan` row. This band
                       must not drift from /pricing, and the only way that holds
                       is if neither carries a number of its own.
                    */}
                    <p className="mt-2 text-h1 font-medium text-on-ink">
                      AED {formatCount(plan.monthlyPriceAed)}
                      {plan.monthlyPriceAed > 0 && (
                        <span
                          className={
                            "text-caption font-normal " +
                            (featured ? "text-moss-on-ink" : "text-on-ink-muted")
                          }
                        >
                          {t("home.plan_month")}
                        </span>
                      )}
                    </p>
                    <p className="mt-1.5 text-caption leading-[1.45] text-on-ink-muted">
                      {planSummary(plan)}
                    </p>
                  </div>
                );
              })}
            </div>
          </Link>
        </section>
      )}
    </PublicShell>
  );
}

/**
 * One line of what a plan includes, from its own entitlement columns.
 *
 * Written from the row rather than from a table of copy, so raising a limit in
 * `/admin/plans` changes this band without a deploy — which is the whole reason
 * the entitlements are columns and not a constant.
 */
function planSummary(plan: {
  locationLimit: number | null;
  productLimit: number | null;
  photoLimit: number | null;
  enquiriesPerMonth: number | null;
  customDomain: boolean;
}): string {
  const parts: string[] = [];
  parts.push(
    plan.locationLimit === null
      ? t("plan.locations_unlimited")
      : plan.locationLimit === 1
        ? t("plan.location_one")
        : t("plan.locations", { n: plan.locationLimit }),
  );
  parts.push(
    plan.productLimit === null
      ? t("plan.products_unlimited")
      : t("plan.products", { n: plan.productLimit }),
  );
  parts.push(
    plan.enquiriesPerMonth === null
      ? t("plan.enquiries_unlimited")
      : t("plan.enquiries", { n: plan.enquiriesPerMonth }),
  );
  return parts.join(" · ");
}
