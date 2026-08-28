import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Tag } from "@/components/display";
import { Breadcrumb, PublicShell } from "@/components/structure";
import { prisma } from "@/lib/db/client";
import { getCategoryBySlug } from "@/lib/db/queries";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import { parseSearchQuery } from "@/lib/search/query";
import {
  areaPageState,
  otherTradesHere,
  sameTradeElsewhere,
  type AreaPageState,
} from "@/lib/seo/area";
import { landingFacts } from "@/lib/seo/facts";
import { faqJsonLd, landingFaq } from "@/lib/seo/faq";
import { absoluteUrl } from "@/lib/site";
import { VERIFIED_TIER } from "@/lib/verification";
import { DirectoryFooter, DirectoryNav } from "@/app/(public)/_chrome";
import { JsonLd } from "@/app/(public)/_json-ld";
import { Results } from "@/app/(public)/_results/Results";
import { EmirateBreakdown, Faq, Prose } from "@/app/(public)/_landing/Blocks";
import { AreaMap } from "./AreaMap";

/**
 * Board 6a — the area landing page, and the workhorse of the whole handoff.
 *
 * 84 category×emirate combinations plus area-level depth. Everything on it is
 * derived except one paragraph, so adding an emirate or a trade adds pages and
 * touches no code — criterion 2.
 *
 * Criterion 1 lives here and in `lib/seo/area.ts`. `AreaPageState.live` is
 * staff intent AND the floors holding right now, so a page whose supply has
 * dropped stops being indexable in the same request rather than waiting for a
 * job. The sweep then clears the column and writes the numbers to the audit log.
 */

export const revalidate = 300;

interface Props {
  params: Promise<{ emirate: string; area: string; category: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

interface Resolved {
  area: { id: string; slug: string; name: string; emirate: string; lat: number | null; lng: number | null };
  category: { id: string; slug: string; name: string; parentSlug: string | null };
  state: AreaPageState;
}

/**
 * The three segments, or nothing.
 *
 * The emirate has to match the area's own, or two URLs address one page and the
 * canonical is a guess — the same rule the subcategory route applies to its
 * parent.
 */
async function resolve(params: { emirate: string; area: string; category: string }): Promise<Resolved | null> {
  const [area, category] = await Promise.all([
    prisma.area.findUnique({
      where: { slug: params.area },
      select: { id: true, slug: true, name: true, emirate: true, lat: true, lng: true },
    }),
    getCategoryBySlug(params.category),
  ]);
  if (!area || !category) return null;
  if (area.emirate !== params.emirate) return null;

  const state = await areaPageState(area.id, category.id);
  if (!state) return null;

  return {
    area: { ...area, emirate: area.emirate as string },
    category: {
      id: category.id,
      slug: category.slug,
      name: category.name,
      parentSlug: category.parent?.slug ?? null,
    },
    state,
  };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const resolved = await resolve(await params);
  if (!resolved) return {};
  const { area, category, state } = resolved;

  return {
    title: t("area.title", { category: category.name, area: area.name }),
    description: t("area.meta_description", {
      listings: formatCount(state.listings),
      category: category.name.toLowerCase(),
      area: area.name,
      verified: formatCount(state.verified),
    }),
    alternates: { canonical: `/${area.emirate}/${area.slug}/${category.slug}` },
    /*
       The page is served either way. What the floors decide is whether we ask
       for it to be indexed — a buyer following a link deserves to see the
       suppliers there are, and a stranger who searched deserves not to land on
       four of them. `follow` stays on: each listing is worth indexing itself.
    */
    ...(state.live ? {} : { robots: { index: false, follow: true } }),
  };
}

export default async function AreaLandingPage({ params, searchParams }: Props) {
  const resolved = await resolve(await params);
  if (!resolved) notFound();
  const { area, category, state } = resolved;

  const sp = await searchParams;
  // The area is fixed by the route, so it is not a facet a visitor can drop.
  const query = { ...parseSearchQuery(sp), area: area.slug };
  const trayRaw = Array.isArray(sp.compare) ? (sp.compare[0] ?? "") : (sp.compare ?? "");
  const tray = trayRaw.split(",").filter(Boolean).slice(0, 4);
  const search = new URLSearchParams(
    Object.entries(sp).flatMap(([k, v]) =>
      v === undefined ? [] : [[k, Array.isArray(v) ? v.join(",") : v] as [string, string]],
    ),
  ).toString();

  const basePath = `/${area.emirate}/${area.slug}/${category.slug}`;
  const categoryIds = [category.id];

  const [facts, elsewhere, otherTrades, locations, children] = await Promise.all([
    landingFacts({ categoryIds, areaId: area.id }),
    sameTradeElsewhere(category.id, area.id),
    otherTradesHere(area.id, category.id),
    /*
       Every published location in the area for this trade, coordinates or not.
       The `ItemList` is the suppliers; the map is the subset we can plot, and
       tying the list to the map would have shrunk it to whoever happened to be
       pinned.
    */
    prisma.location.findMany({
      where: {
        areaId: area.id,
        published: true,
        business: {
          suspendedAt: null,
          publishedAt: { not: null },
          mergedIntoId: null,
          primaryCategoryId: category.id,
        },
      },
      select: {
        id: true,
        lat: true,
        lng: true,
        business: { select: { displayName: true, slug: true, verificationTier: true } },
      },
    }),
    prisma.category.findMany({
      where: { parentId: category.id },
      orderBy: { sortOrder: "asc" },
      select: { slug: true, name: true },
    }),
  ]);

  // Coordinates are recorded per location and plenty are still missing, which
  // the map says out loud rather than quietly plotting fewer.
  const pinned = locations.filter((row) => row.lat !== null && row.lng !== null);

  const faq = landingFaq(
    { subject: t("area.title", { category: category.name, area: area.name }) },
    facts,
  );

  const crumbs = [
    { label: t("chrome.directory"), href: "/" },
    { label: category.name, href: `/c/${category.parentSlug ?? category.slug}` },
    { label: t("area.in_emirate", { area: area.name, emirate: t(`emirate.${area.emirate}` as never) }) },
  ];

  return (
    <PublicShell
      nav={<DirectoryNav />}
      breadcrumb={<Breadcrumb label={t("gallery.breadcrumb_label")} items={crumbs} />}
      footer={<DirectoryFooter />}
    >
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
        `ItemList` of the suppliers, and only when the page is live. Marking up
        a page we are asking not to index would be describing something to a
        crawler and telling it to look away in the same breath.
      */}
      {state.live && locations.length > 0 && (
        <JsonLd
          data={{
            "@context": "https://schema.org",
            "@type": "ItemList",
            name: t("area.title", { category: category.name, area: area.name }),
            numberOfItems: locations.length,
            itemListElement: locations.slice(0, 30).map((pin, i) => ({
              "@type": "ListItem",
              position: i + 1,
              url: absoluteUrl(`/b/${pin.business.slug}`),
              name: pin.business.displayName,
            })),
          }}
        />
      )}
      {faq.length > 0 && <JsonLd data={faqJsonLd(faq)} />}

      <header className="border-b border-line pb-4">
        <h1 className="font-serif text-h1-serif text-ink">
          {t("area.title", { category: category.name, area: area.name })}
        </h1>
        {state.listings > 0 && (
          <p className="mt-2 font-mono text-eyebrow uppercase text-faint">
            {t("landing.verified_share", {
              verified: formatCount(state.verified),
              listings: formatCount(state.listings),
            })}
          </p>
        )}

        {!state.live && (
          /*
            Said out loud rather than hidden. Staff and recruiters read these
            pages too, and "held back, and here is the number that would change
            it" is the sentence that turns a thin page into a call list.
          */
          <div className="mt-4 max-w-[var(--measure-prose)] rounded-card border border-line bg-card px-5 py-4">
            <p className="text-body-sm text-ink">{t("area.held_back")}</p>
            <p className="mt-1.5 text-body-sm text-prose">
              {t("area.held_back_body", {
                reason: state.failing
                  .map((failure) =>
                    failure.reason === "listings"
                      ? `${formatCount(failure.have)} of ${formatCount(failure.need)} listings.`
                      : failure.reason === "verified_share"
                        ? `${Math.round(failure.have * 100)}% verified, against ${Math.round(failure.need * 100)}%.`
                        : `${formatCount(failure.have)} of ${formatCount(failure.need)} words of intro.`,
                  )
                  .join(" "),
              })}
            </p>
          </div>
        )}

        {state.intro && <Prose text={state.intro} />}

        {children.length > 0 && (
          <div className="mt-4">
            <p className="font-mono text-eyebrow uppercase text-faint">
              {t("area.subcategories", { category: category.name })}
            </p>
            <ul className="mt-1.5 flex flex-wrap gap-1.5">
              {children.map((child) => (
                <li key={child.slug}>
                  <Tag href={`/c/${category.slug}/${child.slug}`}>{child.name}</Tag>
                </li>
              ))}
            </ul>
          </div>
        )}
      </header>

      <div className="mt-5">
        <Results
          query={query}
          basePath={basePath}
          tray={tray}
          search={search}
          category={{
            id: category.id,
            slug: category.slug,
            name: category.name,
            ids: categoryIds,
            templateIds: category.parentSlug ? undefined : categoryIds,
          }}
        />
      </div>

      <AreaMap
        pins={pinned.map((pin) => ({
          id: pin.id,
          lat: pin.lat as number,
          lng: pin.lng as number,
          label: pin.business.displayName,
          // Never a colour prop, and never a theme one: the pin treatment says
          // what we checked, and it renders the same on every storefront.
          kind: pin.business.verificationTier >= VERIFIED_TIER ? "verified" : "unverified",
          href: `/b/${pin.business.slug}`,
        }))}
        title={t("area.map_title")}
        label={t("area.map_title")}
        excluded={locations.length - pinned.length}
        excludedLabel={t("area.map_excluded", { count: locations.length - pinned.length })}
      />

      <EmirateBreakdown rows={facts.emirates} basePath={basePath} />
      <Faq items={faq} />

      {elsewhere.length > 0 && (
        <section className="mt-8 border-t border-line pt-5">
          <h2 className="font-mono text-eyebrow uppercase text-faint">
            {t("area.same_trade_title", { category: category.name })}
          </h2>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {elsewhere.map((link) => (
              <li key={`${link.areaSlug}-${link.categorySlug}`}>
                <Tag href={`/${link.emirate}/${link.areaSlug}/${link.categorySlug}`}>
                  {t("area.link", { name: link.areaName, count: formatCount(link.listings) })}
                </Tag>
              </li>
            ))}
          </ul>
        </section>
      )}

      {otherTrades.length > 0 && (
        <section className="mt-8 border-t border-line pt-5">
          <h2 className="font-mono text-eyebrow uppercase text-faint">
            {t("area.other_trades_title", { area: area.name })}
          </h2>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {otherTrades.map((link) => (
              <li key={`${link.areaSlug}-${link.categorySlug}`}>
                <Tag href={`/${link.emirate}/${link.areaSlug}/${link.categorySlug}`}>
                  {t("area.link", { name: link.categoryName, count: formatCount(link.listings) })}
                </Tag>
              </li>
            ))}
          </ul>
        </section>
      )}
    </PublicShell>
  );
}
