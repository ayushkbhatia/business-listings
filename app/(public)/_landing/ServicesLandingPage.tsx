import { headers } from "next/headers";
import { Breadcrumb, PublicShell } from "@/components/structure";
import { CoverageFirmList } from "@/components/domain/BlendedResultRows";
import { recordCategoryPositions } from "@/lib/analytics/record";
import { servicesLandingRows } from "@/lib/db/queries/services-landing";
import { BRIEF_MAX_RECIPIENTS } from "@/lib/enquiry/service-brief";
import { briefFirstReplyMedianMs, previewBrief } from "@/lib/enquiry/service-brief-server";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import { isCrawler } from "@/lib/seo/crawl-policy";
import {
  areaPagesInEmirate,
  landingFaqJsonLd,
  landingPagePath,
  landingState,
  memberScopeOf,
  nearestFirst,
  readNext,
  resolveEmirateScope,
  resolveLandingFaq,
  servicesH1,
  servicesMembers,
  servicesNoun,
  servicesStats,
  siblingLinks,
  type LandingLink,
  type LandingState,
} from "@/lib/seo/landing";
import { absoluteUrl } from "@/lib/site";
import { categoryAsks, credentialKindFor } from "@/lib/taxonomy/services-landing";
import { cn } from "@/lib/cn";
import { DirectoryFooter, DirectoryNav } from "@/app/(public)/_chrome";
import { JsonLd } from "@/app/(public)/_json-ld";
import { ResultClicks } from "@/app/(public)/_results/ResultClicks";
import { Prose } from "./Blocks";
import { ClaimPrompt, ReadNext, RelatedSearches } from "./LandingRail";
import { SiblingLinks } from "./SiblingLinks";
import {
  FanOutCard,
  RailChipsCard,
  RailLinksCard,
  ServicesStatLine,
  WhatToAsk,
  type FanOutFacts,
  type RailLink,
} from "./ServicesLanding";

/**
 * Board `6a-s` — the landing page for a trade sold by the job.
 *
 * The goods template's twin, rendered from the same scope object by the same
 * route when the trade resolves to `services` (`B2`). Not the goods page with
 * the product grid hidden: the grid, the spec chips, the map and the branch
 * counts are not rendered at all, because each of them answers *where is this
 * supplier* and this page asks *who covers this place*.
 *
 * ## What the board draws, and what this adds
 *
 * The header band (breadcrumb *trade / emirate / area*, the H1 in the trade's
 * own noun, the stat line), the editorial paragraph, the ranked firms, *What
 * to ask*, and a rail of the fan-out, *Nearby* and *Related work*. The
 * paragraph is the scope's own intro — the goods gate's third condition, and
 * the words a person wrote about this trade in this place.
 *
 * Added, each for a rule the board did not draw against:
 *
 *  - **the per-scope FAQ** below the firms. `B11` keeps the goods gate for
 *    services, and the gate asks for four questions, two of them about the
 *    place. Questions that gate a page and then do not render would be content
 *    a crawler is told about and a buyer cannot read.
 *  - **the same trade in other emirates**, a slim link block under everything.
 *    Without it the emirate class is reachable only from a breadcrumb, and `B7`
 *    wants every live page anchored somewhere in the class.
 *  - **pagination**, ten at a time, as the goods page does. Flag 3 notes the
 *    board has none for 37 firms; a page listing three of 37 would be a page
 *    that hides 34.
 *
 * Left out: the amber note in the rail (*"The goods version of this page leads
 * with a product grid…"*). It is the board explaining itself to the design
 * review — "this page family roughly doubles the page matrix on 6f" is a
 * sentence for the people building the page, not for a buyer reading it.
 */

/** Ten, as on the goods page — §SEO's anchor budget is written against it. */
export const SERVICES_RESULTS_PER_PAGE = 10;

export interface ServicesLandingPageProps {
  state: LandingState;
  searchParams: Record<string, string | string[] | undefined>;
  pageCount: number;
}

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * The intro as the board lays it out: the first paragraph above the firms, the
 * rest after them. Split on the blank line `Prose` splits on, so the two halves
 * are the paragraphs a person wrote and never a cut mid-sentence.
 */
export function splitIntro(text: string | null): { lead: string | null; rest: string | null } {
  if (!text) return { lead: null, rest: null };
  const paragraphs = text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  return {
    lead: paragraphs[0] ?? null,
    rest: paragraphs.length > 1 ? paragraphs.slice(1).join("\n\n") : null,
  };
}

/** A live page's link, worded the way that page's own H1 reads. */
function relatedLabel(link: LandingLink, placeName: string): string {
  if (link.trade === "services") {
    return t("landing_services.related_services", {
      noun: link.pluralHuman ?? t("landing_services.noun_fallback", { category: link.categoryName ?? link.label }),
      place: placeName,
    });
  }
  return t("landing_services.related_goods", { category: link.categoryName ?? link.label, place: placeName });
}

export async function ServicesLandingPage({ state, searchParams, pageCount }: ServicesLandingPageProps) {
  const { scope } = state;
  const now = new Date();
  const emirateName = t(`emirate.${scope.emirate}` as never);
  const placeName = scope.area?.name ?? emirateName;
  const noun = servicesNoun(scope.category);
  const h1 = servicesH1(scope);
  const page = Math.max(1, Number(one(searchParams["page"]) ?? 1) || 1);
  const memberScope = memberScopeOf(scope);

  const [members, credential, asks, faq, next, siblings, areasHere, preview, briefMedian, emirateLive] =
    await Promise.all([
      servicesMembers(memberScope, now),
      credentialKindFor(scope.category.id),
      categoryAsks(scope.category.id),
      resolveLandingFaq(scope, state.faq, now),
      readNext(scope),
      siblingLinks(scope),
      areaPagesInEmirate(scope),
      previewBrief(
        {
          categoryId: scope.category.id,
          site: { emirate: scope.emirate, areaId: scope.area?.id ?? null },
          scope: scope.area ? "area" : "emirate",
          engagement: null,
        },
        now,
      ),
      briefFirstReplyMedianMs(now),
      /*
         The breadcrumb's emirate is a link only where the emirate page is live
         — §2 of board 6a: every other segment is a real anchor to a page that
         exists. On the emirate class it is the page itself.
      */
      scope.area
        ? resolveEmirateScope({ emirate: scope.emirate, category: scope.category.slug }).then(
            async (parent) => (parent ? (await landingState(parent, now)).live : false),
          )
        : Promise.resolve(false),
    ]);

  const [stats, ranked] = await Promise.all([
    servicesStats(memberScope, credential.kind, now),
    servicesLandingRows({ scope, members, page, pageSize: SERVICES_RESULTS_PER_PAGE, now }),
  ]);

  /*
     Board `3l`/`11e` — who appeared, and on which scope. The same counter the
     category pages feed, behind the same crawler gate and for the same reason:
     a bot walking pages is not a buyer, and the placement price is derived from
     this number. Not awaited and never allowed to throw.
  */
  if (ranked.rankedIds.length > 0 && !isCrawler((await headers()).get("user-agent"))) {
    void recordCategoryPositions(
      ranked.rankedIds,
      scope.category.id,
      scope.emirate,
      now,
      (page - 1) * SERVICES_RESULTS_PER_PAGE,
    );
  }

  const tradeHref = scope.category.parentSlug
    ? `/c/${scope.category.parentSlug}/${scope.category.slug}`
    : `/c/${scope.category.slug}`;
  const emirateHref = `/${scope.emirate}/${scope.category.slug}`;
  const crumbs: { label: string; href?: string }[] = [
    { label: scope.category.name, href: tradeHref },
    scope.area && emirateLive ? { label: emirateName, href: emirateHref } : { label: emirateName },
    ...(scope.area ? [{ label: scope.area.name }] : []),
  ];

  const rfqParams = new URLSearchParams({ category: scope.category.slug, kind: "services" });
  if (scope.area) rfqParams.set("area", scope.area.slug);
  else rfqParams.set("emirate", scope.emirate);
  const fanOut: FanOutFacts | null =
    preview.count > 0
      ? {
          state: "match",
          count: preview.count,
          cap: BRIEF_MAX_RECIPIENTS,
          place: placeName,
          href: `/rfq/new?${rfqParams}`,
          measuredMs: briefMedian,
        }
      : preview.emirateCount
        ? {
            state: "widen",
            count: preview.emirateCount,
            place: placeName,
            emirate: emirateName,
            href: `/rfq/new?${new URLSearchParams({
              category: scope.category.slug,
              kind: "services",
              emirate: scope.emirate,
            })}`,
          }
        : null;

  const nearby: RailLink[] = scope.area
    ? nearestFirst(siblings.otherAreas).map((link) => ({ href: link.href, label: link.label, count: link.listings }))
    : areasHere.map((link) => ({ href: link.href, label: link.label, count: link.listings }));
  const related: RailLink[] = [
    ...siblings.otherTrades.filter((link) => link.trade === "services"),
    ...siblings.otherTrades.filter((link) => link.trade !== "services"),
  ].map((link) => ({ href: link.href, label: relatedLabel(link, placeName), count: link.listings }));

  const offset = (page - 1) * SERVICES_RESULTS_PER_PAGE;
  const intro = splitIntro(state.intro);
  const hrefFor = (target: number) => landingPagePath(scope.path, target);

  return (
    <PublicShell bleed nav={<DirectoryNav />} footer={<DirectoryFooter />}>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          // Built from the array the breadcrumb renders, so the two cannot drift.
          itemListElement: crumbs.map((crumb, i) => ({
            "@type": "ListItem",
            position: i + 1,
            name: crumb.label,
            ...(crumb.href ? { item: absoluteUrl(crumb.href) } : {}),
          })),
        }}
      />
      {ranked.rows.length > 0 && (
        <JsonLd
          data={{
            "@context": "https://schema.org",
            "@type": "ItemList",
            name: h1,
            numberOfItems: ranked.rows.length,
            /*
               Scoped to what is verified, and nothing a seller typed about
               money — `1g-s` B3 leaves the fee basis and the indicative fee out
               of structured data, and so does this. The name, the storefront
               and the office where there is one: the address is the one place
               a firm is, rather than the places it says it covers.
            */
            itemListElement: ranked.rows.map((row, i) => ({
              "@type": "ListItem",
              position: offset + i + 1,
              item: {
                "@type": "ProfessionalService",
                name: row.businessName,
                url: absoluteUrl(`/b/${row.businessSlug}`),
              },
            })),
          }}
        />
      )}
      {faq.length > 0 && <JsonLd data={landingFaqJsonLd(faq)} />}
      {page > 1 && <link rel="prev" href={absoluteUrl(landingPagePath(scope.path, page - 1))} />}
      {page < pageCount && <link rel="next" href={absoluteUrl(landingPagePath(scope.path, page + 1))} />}

      {/* ── The header band ────────────────────────────────────────────── */}
      <section className="border-b border-line bg-card px-[var(--gutter)] pb-6 pt-6">
        <div className="mx-auto max-w-7xl">
          <Breadcrumb label={t("gallery.breadcrumb_label")} items={crumbs} />
          <h1 className="mt-3 max-w-[40rem] font-serif text-display text-ink">{h1}</h1>
          <ServicesStatLine
            firms={stats.firms}
            place={placeName}
            verified={stats.verified}
            credential={stats.credential}
            replyMedianMs={stats.replyMedianMs}
            updatedAt={state.contentUpdatedAt}
          />
        </div>
      </section>

      {/* ── The body: the firms, and the rail ───────────────────────────── */}
      <ResultClicks categoryId={scope.category.id} emirate={scope.emirate}>
        <section className="bg-paper px-[var(--gutter)] py-7">
          <div className="mx-auto flex max-w-7xl flex-col gap-8 lg:flex-row lg:items-start lg:gap-8">
            <div className="flex min-w-0 flex-1 flex-col gap-5">
              {/*
                 The board's editorial paragraph is the intro's first — the
                 premise, *they cover it*. The rest of the 250 words the gate
                 asks for follows the firms rather than preceding them: every
                 word renders, and a buyer reaches the firms before the essay.
              */}
              {intro.lead && <Prose text={intro.lead} />}

              {/*
                 Board 6a §Responsive, carried over: below `lg` the fan-out sits
                 above the firms, where on a phone it converts better than any
                 single row. One copy is displayed at a time — `hidden` takes the
                 other out of the accessibility tree, so a screen reader meets it
                 once.
              */}
              {fanOut && (
                <div className="lg:hidden">
                  <FanOutCard facts={fanOut} id="fanout-inline" />
                </div>
              )}

              <section aria-labelledby="landing-firms">
                <h2 id="landing-firms" className="sr-only">
                  {t("landing_services.results_heading", { noun, place: placeName })}
                </h2>
                <CoverageFirmList rows={ranked.rows} placeName={placeName} offset={offset} />
                {pageCount > 1 && (
                  <nav
                    aria-label={t("landing_services.pagination_label")}
                    className="mt-5 flex items-center justify-center gap-3"
                  >
                    {page > 1 && (
                      <a
                        href={hrefFor(page - 1)}
                        className={cn(
                          "rounded-ctl border border-line-strong bg-card px-4 py-2 text-body-sm text-ink",
                          "hover:border-ink focus-visible:outline-none focus-visible:shadow-focus",
                        )}
                      >
                        {t("landing.previous")}
                      </a>
                    )}
                    {page < pageCount && (
                      <a
                        href={hrefFor(page + 1)}
                        className={cn(
                          "rounded-ctl border border-line-strong bg-card px-5 py-2 text-body-sm font-medium text-ink",
                          "hover:border-ink focus-visible:outline-none focus-visible:shadow-focus",
                        )}
                      >
                        {page === 1
                          ? t("landing_services.show_all", { count: stats.firms, display: formatCount(stats.firms) })
                          : t("landing.next")}
                      </a>
                    )}
                  </nav>
                )}
              </section>

              {intro.rest && (
                <section aria-labelledby="landing-about">
                  <h2 id="landing-about" className="text-h3 text-ink">
                    {t("landing_services.about_heading", { noun, place: placeName })}
                  </h2>
                  <Prose text={intro.rest} />
                </section>
              )}

              <WhatToAsk heading={t("landing_services.asks_heading", { noun, place: placeName })} asks={asks} />
            </div>

            <div className="flex w-full shrink-0 flex-col gap-4 lg:w-[20.5rem]">
              {fanOut && (
                <div className="hidden lg:block">
                  <FanOutCard facts={fanOut} />
                </div>
              )}
              <RailChipsCard
                id="rail-nearby"
                heading={
                  scope.area
                    ? t("landing_services.nearby")
                    : t("landing_services.areas_in", { emirate: emirateName })
                }
                links={nearby}
              />
              <RailLinksCard id="rail-related-work" heading={t("landing_services.related_work")} links={related} />
            </div>
          </div>
        </section>
      </ResultClicks>

      {/* ── The per-scope FAQ and the editorial rail ────────────────────── */}
      {(faq.length > 0 || state.relatedSearches.length > 0 || next.length > 0 || stats.unclaimed > 0) && (
        <section className="border-t border-line bg-card px-[var(--gutter)] py-8">
          <div className="mx-auto flex max-w-7xl flex-col gap-8 lg:flex-row lg:gap-11">
            {faq.length > 0 && (
              <section aria-labelledby="faq-heading" className="min-w-0 flex-1">
                <h2 id="faq-heading" className="font-serif text-h1-serif text-ink">
                  {t("landing_services.faq_heading", { noun, place: placeName })}
                </h2>
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
            <div className="flex w-full shrink-0 flex-col gap-3.5 lg:w-[20rem]">
              <RelatedSearches rows={state.relatedSearches} />
              <ReadNext items={next} />
              <ClaimPrompt
                unclaimed={stats.unclaimed}
                listings={stats.firms}
                subject={t("landing_services.claim_subject", {
                  category: scope.category.name,
                  place: placeName,
                })}
              />
            </div>
          </div>
        </section>
      )}

      {/* ── The same trade in the other emirates ────────────────────────── */}
      <SiblingLinks
        columns={[
          {
            key: "emirates",
            heading: t("landing_services.other_emirates", { noun }),
            links: siblings.otherEmirates.map((link) => ({
              ...link,
              label: t(`emirate.${link.label}` as never),
            })),
          },
        ]}
      />
    </PublicShell>
  );
}
