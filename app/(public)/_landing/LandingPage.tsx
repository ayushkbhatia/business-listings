import { Breadcrumb, PublicShell } from "@/components/structure";
import { ChipLink } from "@/components/display";
import { searchBusinesses } from "@/lib/db/queries";
import { formatCount, formatDate } from "@/lib/format";
import { t } from "@/lib/i18n";
import { absoluteUrl } from "@/lib/site";
import { parseSearchQuery } from "@/lib/search/query";
import { VERIFIED_TIER } from "@/lib/verification";
import {
  landingFaqJsonLd,
  landingPagePath,
  landingStats,
  nearbyAreas,
  readNext,
  resolveLandingFaq,
  siblingLinks,
  subcategoryChips,
  type LandingState,
} from "@/lib/seo/landing";
import { headers } from "next/headers";
import { prisma } from "@/lib/db/client";
import { isCrawler } from "@/lib/seo/crawl-policy";
import { recordSearchImpressions } from "@/lib/analytics/record";
import { DirectoryFooter, DirectoryNav } from "@/app/(public)/_chrome";
import { JsonLd } from "@/app/(public)/_json-ld";
import { Prose } from "./Blocks";
import { AreaMapCard } from "./AreaMapCard";
import { LandingResults } from "./LandingResults";
import { ClaimPrompt, ReadNext, RelatedSearches } from "./LandingRail";
import { SiblingLinks } from "./SiblingLinks";

/**
 * Board 6a — the area landing page, and the one controller both classes share.
 *
 * §1: *"One template, one controller, one scope object — `{emirate, area?,
 * category}`. The differences are the H1, the breadcrumb, the map extent, and
 * which sibling-link block is 'other areas in this emirate' versus 'this area
 * in other emirates'. Nothing else branches."*
 *
 * So the branches in this file are exactly those four and no others. Anything
 * that reads `scope.kind` beyond them is drift.
 *
 * ## What is not on this page, and why
 *
 * No filter rail, no tabs, no sort toolbar, no compare tray, no interactive
 * map. All of those belong to boards `1b` and `1c`, where a buyer who is
 * already on the site is narrowing something down. A buyer who arrived here
 * from `hvac companies al quoz` has already narrowed — the scope is the filter
 * — and the page's whole job is to convert them or to lose them. §SEO budgets
 * about fifty anchors against `6c`'s hundred and fifty-six on the same
 * reasoning.
 *
 * ## The caller has already decided this page exists
 *
 * Both routes call `landingState` and `notFound()` before rendering this.
 * §the-publish-gate: *"An unpublished scope has no URL. It is not a thin page,
 * not a `noindex` page, not a redirect."* There is therefore no held-back state
 * in here to render, and adding one would be adding back the thing the gate
 * exists to prevent.
 */

/** §4 draws ten. §SEO's anchor budget is written against that number. */
export const RESULTS_PER_PAGE = 10;

export interface LandingPageProps {
  state: LandingState;
  searchParams: Record<string, string | string[] | undefined>;
  /** How many pages of results there are, from the route's own count. */
  pageCount: number;
}

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export async function LandingPage({ state, searchParams, pageCount }: LandingPageProps) {
  const { scope } = state;
  const emirateName = t(`emirate.${scope.emirate}` as never);
  const placeName = scope.area?.name ?? emirateName;

  const h1 =
    scope.kind === "area"
      ? t("landing.h1_area", {
          category: scope.category.name,
          area: scope.area?.name ?? "",
          emirate: emirateName,
        })
      : t("landing.h1_emirate", { category: scope.category.name, emirate: emirateName });

  /*
     Open question 5: a subcategory chip filters **in place**, canonical to the
     unfiltered page. Navigating would open a fourth page class
     (`/:emirate/:area/:category/:sub`) and a much larger sitemap for content
     this page already carries.
  */
  const chips = await subcategoryChips(scope);
  const subParam = one(searchParams["sub"]);
  const activeChip = chips.find((chip) => chip.slug === subParam) ?? null;
  const page = Math.max(1, Number(one(searchParams["page"]) ?? 1) || 1);

  const [stats, nearby, siblings, next, faq] = await Promise.all([
    landingStats(scope),
    scope.area ? nearbyAreas(scope) : Promise.resolve([]),
    siblingLinks(scope),
    readNext(scope),
    resolveLandingFaq(scope, state.faq),
  ]);

  /*
     The ranked page of ten.

     `browse: true` is §Ranking's whole answer: there is no query on this page,
     so the relevance weight is put through the named mode staff chose on board
     12c rather than left multiplying zero. Everything else carries over —
     distance from the area centroid, unclaimed last, one labelled sponsored
     slot that drops out rather than outranking a verified supplier.
  */
  const results = await searchBusinesses(
    {
      ...parseSearchQuery({}),
      page,
      ...(scope.area ? { area: scope.area.slug } : { emirate: scope.emirate }),
    },
    {
      // The chip narrows to that one subcategory; no chip is the whole scope,
      // parent and children together.
      categoryIds: activeChip ? [activeChip.id] : scope.categoryIds,
      browse: true,
      pageSize: RESULTS_PER_PAGE,
      /*
         Only read under the `category_depth` mode: a listing whose primary
         trade is exactly this page's scores full, one that matches only at
         sector level scores half. The page knows its own scope; search does
         not, which is why it is handed the answer.
      */
      categoryDepth: (_id, primaryCategoryId) =>
        primaryCategoryId === scope.category.id ? 1 : 0.5,
    },
  );
  /*
     The map plots what it can and says how many it cannot. A location with no
     coordinates is never dropped at an area centroid — a wrong pin is worse
     than no pin, and a seller who is told their branch is unpinned fixes it.
  */
  const locations = await prisma.location.findMany({
    where: {
      published: true,
      ...(scope.area ? { areaId: scope.area.id } : { emirate: scope.emirate }),
      business: {
        suspendedAt: null,
        publishedAt: { not: null },
        mergedIntoId: null,
        primaryCategoryId: { in: scope.categoryIds },
      },
    },
    select: {
      id: true,
      lat: true,
      lng: true,
      business: { select: { displayName: true, slug: true, verificationTier: true } },
    },
  });
  const pinned = locations.filter((row) => row.lat !== null && row.lng !== null);

  /*
     Board `3l` — this page lists businesses, so appearing on it is an impression.

     It was not counted. `_results/Results.tsx` writes impressions on `/search`
     and `/c/:category`, and the area and emirate landing pages — which are the
     surfaces Google sends buyers to — wrote nothing, while `lib/telemetry`
     counted a storefront view arriving from anywhere. So a seller's funnel
     understated the stage it divides by: "clicked through to your listing" was
     not a click-through rate.

     Done now because it can only be done now. Board `3l` is explicit that
     impressions cannot be backfilled, so adding a source later would put a step
     change in every seller's history with no way to explain it. The pipeline
     shipped on 8 Sep 2026 and holds no production data yet; this is the one
     moment when widening it costs nobody a comparison.

     Behind the same crawler gate, for the same reason: a bot walked 797 facet
     permutations of the results page in 75 minutes, and counted as impressions
     those would be a funnel whose first stage is mostly robots.

     No `recordCategoryPositions` beside it. A category position is a rank
     within one category listing, and this page's ordering is scoped to an area
     as well — the same business is in a different position here than on
     `/c/:category`, and writing both into one table would make the number mean
     two things.
  */
  if (!isCrawler((await headers()).get("user-agent")) && results.rows.length > 0) {
    void recordSearchImpressions(
      results.rows.map((row) => row.id),
      // The scope is the query on this surface: nobody typed anything, and the
      // phrase a seller reads back should be the page they appeared on.
      `${scope.category.name} ${scope.area?.name ?? emirateName}`,
      undefined,
      (page - 1) * RESULTS_PER_PAGE,
    );
  }

  const crumbs = [
    { label: t("chrome.directory"), href: "/" },
    { label: emirateName, href: `/${scope.emirate}/${scope.category.slug}` },
    ...(scope.area ? [{ label: scope.area.name, href: scope.path }] : []),
    { label: scope.category.name },
  ];
  /*
     §2: *"Every other segment is a real anchor to a page that exists."* The
     emirate crumb points at this trade's emirate page, which is the parent of
     an area page in every sense that matters — and on the emirate class it is
     the page itself, so it is not rendered as a link to where you already are.
  */
  const linkedCrumbs = crumbs.map((crumb, index) =>
    index === crumbs.length - 1 || ("href" in crumb && crumb.href === scope.path)
      ? { label: crumb.label }
      : crumb,
  );

  const hrefFor = (target: number) => {
    const params = new URLSearchParams();
    if (activeChip) params.set("sub", activeChip.slug);
    if (target > 1) params.set("page", String(target));
    const query = params.toString();
    return query ? `${scope.path}?${query}` : scope.path;
  };

  return (
    <PublicShell
      bleed
      nav={
        <DirectoryNav
          active="categories"
          scope={{
            /*
               §1: *"A search from here starts pre-filtered to this scope and
               lands on `1c`."* The place and the trade both travel, as hidden
               fields — a GET form discards the query string on its `action`, so
               `/search?area=…` would submit `/search?q=…` and quietly drop the
               scope the pill is promising.
            */
            action: "/search",
            label: placeName.toUpperCase(),
            placeholder: t("landing.search_placeholder", {
              category: scope.category.name,
              place: placeName,
            }),
            /*
               The place only. `/search` reads `area` and `emirate` and has no
               `category` facet — an unreserved key there is read as a **spec**
               field name, so sending the trade would filter on a specification
               called "category" and return nothing at all, which is worse than
               dropping it.

               The trade is not lost: a buyer searching from this page types what
               they want and the results are already narrowed to the place. If a
               category facet is ever added to `/search`, it belongs here.
            */
            hidden: scope.area ? { area: scope.area.slug } : { emirate: scope.emirate },
          }}
        />
      }
      footer={<DirectoryFooter />}
    >
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          /*
             §2: *"Matches the `BreadcrumbList` JSON-LD exactly — same labels,
             same order, same depth."* Built from the same array the breadcrumb
             renders, so the two cannot drift.
          */
          itemListElement: linkedCrumbs.map((crumb, i) => ({
            "@type": "ListItem",
            position: i + 1,
            name: crumb.label,
            ...("href" in crumb && crumb.href ? { item: absoluteUrl(crumb.href) } : {}),
          })),
        }}
      />
      {results.rows.length > 0 && (
        <JsonLd
          data={{
            "@context": "https://schema.org",
            "@type": "ItemList",
            name: h1,
            numberOfItems: results.rows.length,
            itemListElement: results.rows.map((business, i) => ({
              "@type": "ListItem",
              position: (page - 1) * RESULTS_PER_PAGE + i + 1,
              item: {
                "@type": "LocalBusiness",
                name: business.displayName,
                url: absoluteUrl(`/b/${business.slug}`),
                ...(business.locations[0]
                  ? {
                      address: {
                        "@type": "PostalAddress",
                        addressLocality: business.locations[0].area.name,
                        addressRegion: t(`emirate.${business.locations[0].emirate}` as never),
                        addressCountry: "AE",
                      },
                    }
                  : {}),
              },
            })),
          }}
        />
      )}
      {faq.length > 0 && <JsonLd data={landingFaqJsonLd(faq)} />}

      {/*
         Real link relations, rendered here rather than declared in
         `generateMetadata`. Next's Metadata API has no slot for one: an `other`
         entry emits `<meta name="link:next">`, which is not the tag §SEO asks
         for and which nothing reads. React hoists a `<link>` from anywhere in
         the tree into the head.
      */}
      {page > 1 && <link rel="prev" href={absoluteUrl(landingPagePath(scope.path, page - 1))} />}
      {page < pageCount && (
        <link rel="next" href={absoluteUrl(landingPagePath(scope.path, page + 1))} />
      )}

      {/* ── Hero ───────────────────────────────────────────────────────── */}
      <section className="border-b border-line bg-paper px-[var(--gutter)] pb-8 pt-5">
        <div className="mx-auto max-w-7xl">
          <Breadcrumb label={t("gallery.breadcrumb_label")} items={linkedCrumbs} />

          <div className="mt-5 flex flex-col gap-8 lg:flex-row lg:gap-11">
            <div className="min-w-0 flex-1">
              {/*
                 `text-display` is the 42px top of the type scale in §09 and the
                 nearest thing to the board's 40px. Never a one-off size: the
                 category index carries a hand-written `text-[2.125rem]` for the
                 same job, which is a token the scale does not have and a number
                 nobody can change centrally.
              */}
              <h1 className="max-w-[620px] font-serif text-display text-ink">{h1}</h1>

              {/*
                 §3's stat line. Every entry is a query result — criterion 1 —
                 and an entry that cannot be measured is absent rather than
                 nought: "41 open now" comes off the line entirely where nobody
                 in the scope has hours on file.
              */}
              <div className="mt-3.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-body-sm text-body">
                <span className="font-medium text-ink">
                  {t("landing.stat_listings", {
                    count: stats.listings,
                    display: formatCount(stats.listings),
                  })}
                </span>
                <Separator />
                <span>
                  {t("landing.stat_verified", {
                    count: stats.verified,
                    display: formatCount(stats.verified),
                  })}
                </span>
                {stats.openNow !== null && (
                  <>
                    <Separator />
                    <span>{t("landing.stat_open", { count: formatCount(stats.openNow) })}</span>
                  </>
                )}
                {state.contentUpdatedAt && (
                  <>
                    <Separator />
                    {/*
                       §Freshness. This is `content_updated_at` and never the
                       build time: if the date tracked the build, every page on
                       the domain would claim to have been updated this morning.
                    */}
                    <span className="font-mono text-eyebrow uppercase text-muted">
                      {t("landing.updated", { date: formatDate(state.contentUpdatedAt) })}
                    </span>
                  </>
                )}
              </div>

              {state.intro && <Prose text={state.intro} />}

              {chips.length > 0 && (
                <nav aria-label={t("landing.subcategories_label")} className="mt-5">
                  <ul className="flex flex-wrap gap-2">
                    <li>
                      {/*
                         The first chip is `All {n}` in reversed ink — the board
                         draws the current view as selected rather than as an
                         absent state, which is what makes the row read as a
                         switch rather than as five links to elsewhere.
                      */}
                      <ChipLink href={scope.path} selected={!activeChip}>
                        {t("landing.chip_all", { count: formatCount(stats.listings) })}
                      </ChipLink>
                    </li>
                    {chips.map((chip) => (
                      <li key={chip.slug}>
                        <ChipLink
                          href={`${scope.path}?sub=${chip.slug}`}
                          selected={activeChip?.slug === chip.slug}
                          count={formatCount(chip.listings)}
                        >
                          {chip.name}
                        </ChipLink>
                      </li>
                    ))}
                  </ul>
                </nav>
              )}
            </div>

            {/*
               `self-start` on the card so it takes its own height rather than
               the hero's. Stretched to match a 350-word intro it becomes a
               400px box holding a 180px map, which reads as a panel that failed
               to load rather than as the orientation aid it is.
            */}
            {(pinned.length > 0 || nearby.length > 0) && (
              <aside className="w-full shrink-0 self-start overflow-hidden rounded-card border border-line bg-card lg:w-[352px]">
                <AreaMapCard
                  pins={pinned.map((pin) => ({
                    id: pin.id,
                    lat: pin.lat as number,
                    lng: pin.lng as number,
                    label: pin.business.displayName,
                    // Never a colour prop and never a theme one: the pin says
                    // what we checked, and it renders the same everywhere.
                    kind:
                      pin.business.verificationTier >= VERIFIED_TIER ? "verified" : "unverified",
                  }))}
                  label={t("landing.map_label", { place: placeName })}
                  extent={scope.area?.name.toUpperCase()}
                  excluded={locations.length - pinned.length}
                  excludedLabel={t("area.map_excluded", {
                    count: locations.length - pinned.length,
                  })}
                />
                {nearby.length > 0 && (
                  <nav aria-labelledby="nearby-areas" className="p-4">
                    <h2 id="nearby-areas" className="text-caption font-medium text-ink">
                      {t("landing.nearby_areas")}
                    </h2>
                    <ul className="mt-2.5 flex flex-wrap gap-1.5">
                      {nearby.map((link) => (
                        <li key={link.href}>
                          <ChipLink
                            href={link.href}
                            size="sm"
                            count={formatCount(link.listings)}
                          >
                            {link.label}
                          </ChipLink>
                        </li>
                      ))}
                    </ul>
                  </nav>
                )}
              </aside>
            )}
          </div>
        </div>
      </section>

      {/* ── Results ────────────────────────────────────────────────────── */}
      <LandingResults
        heading={t("landing.results_heading", {
          category: scope.category.name,
          place: placeName,
        })}
        // The board's fifth correction: one weighted config shared with `1b`
        // and `1c` and edited on `12c`, never "verification, then response
        // time" — which describes a two-key sort we do not run.
        caption={t("landing.ranking_caption")}
        rows={results.rows}
        total={results.total}
        page={page}
        pageCount={pageCount}
        hrefFor={hrefFor}
        rfqHref={`/rfq/new?category=${scope.category.slug}${
          scope.area ? `&area=${scope.area.slug}` : `&emirate=${scope.emirate}`
        }`}
        rfqLabel={t("landing.rfq_action", {
          place: placeName,
          category: scope.category.name,
        })}
        sponsoredId={results.sponsoredId}
      />

      {/* ── FAQ + rail ─────────────────────────────────────────────────── */}
      {(faq.length > 0 || state.relatedSearches.length > 0 || next.length > 0) && (
        <section className="border-b border-line bg-paper px-[var(--gutter)] py-9">
          <div className="mx-auto flex max-w-7xl flex-col gap-9 lg:flex-row lg:gap-11">
            {faq.length > 0 && (
              /*
                 A real section with its heading as its accessible name. The
                 `FAQPage` markup describes this block, and a block a crawler is
                 told about should be a landmark a reader can reach too.
              */
              <section aria-labelledby="faq-heading" className="min-w-0 flex-1">
                <h2 id="faq-heading" className="font-serif text-h1-serif text-ink">
                  {t("landing.faq_heading", {
                    place: placeName,
                    category: scope.category.name,
                  })}
                </h2>
                {/*
                   `h3` questions inside the FAQ section — §SEO says so, and
                   `FAQPage` markup wants a heading it can point at. Open text
                   rather than disclosures: three sentences each, read by a
                   crawler without qualification, no JavaScript, and no state a
                   keyboard user has to unwind to read the page.
                */}
                <div className="mt-4">
                  {faq.map((item, index) => (
                    <div
                      key={item.id}
                      className={index === faq.length - 1 ? "py-4" : "border-b border-line py-4"}
                    >
                      <h3 className="text-body-sm font-medium text-ink">{item.question}</h3>
                      <p className="mt-2 max-w-[var(--measure-prose)] text-caption leading-relaxed text-prose">
                        {item.answer}
                      </p>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <div className="flex w-full shrink-0 flex-col gap-3.5 lg:w-[320px]">
              <RelatedSearches rows={state.relatedSearches} />
              <ReadNext items={next} />
              <ClaimPrompt
                unclaimed={stats.unclaimed}
                listings={stats.listings}
                subject={t("landing.claim_subject", {
                  category: scope.category.name,
                  place: placeName,
                })}
              />
            </div>
          </div>
        </section>
      )}

      {/* ── Sibling links ──────────────────────────────────────────────── */}
      <SiblingLinks
        columns={[
          {
            key: "areas",
            heading: t("landing.siblings_areas", {
              category: scope.category.name,
              emirate: emirateName,
            }),
            links: siblings.otherAreas,
          },
          {
            key: "emirates",
            heading: t("landing.siblings_emirates", { category: scope.category.name }),
            links: siblings.otherEmirates.map((link) => ({
              ...link,
              label: t(`emirate.${link.label}` as never),
            })),
          },
          {
            key: "trades",
            heading: t("landing.siblings_trades", { place: placeName }),
            links: siblings.otherTrades,
          },
        ]}
      />
    </PublicShell>
  );
}

/** The `·` between stats. Decorative — the line reads without it. */
function Separator() {
  return (
    <span aria-hidden className="text-line-strong">
      ·
    </span>
  );
}
