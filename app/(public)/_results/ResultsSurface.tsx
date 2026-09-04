import { Tabs } from "@/components/structure";
import { FilterChip, StatusBadge } from "@/components/display";
import { ListingCard, ProductCard } from "@/components/domain";
import { formatCount, formatDuration } from "@/lib/format";
import { t } from "@/lib/i18n";
import { MEDIA_BUCKET, publicUrl } from "@/lib/storage";
import { RevealWhatsApp } from "./RevealWhatsApp";
import { primarySize } from "@/lib/spec";
import {
  PAGE_SIZE,
  type BusinessResult,
  type FacetGroup,
  type ProductResult,
} from "@/lib/db/queries";
import { toSearchParams, withoutFacet, type SearchQuery, pathWithQuery } from "@/lib/search/query";
import { crawlRel } from "@/lib/seo/crawl-policy";

/**
 * The results list, shared by the category pages and search.
 *
 * Two tabs over one query. The tab is a link, not state — a buyer can send
 * someone the products tab of a search, and the back button does what they
 * expect.
 */
export interface ResultsSurfaceProps {
  query: SearchQuery;
  basePath: string;
  businesses?: { rows: BusinessResult[]; total: number; sponsoredId: string | null };
  products?: { rows: ProductResult[]; total: number };
  /** Filterable spec fields for the category, used to render sizes on cards. */
  specFields?: { id: string; key: string; label: string; unit: string | null; type: string; isFilterable: boolean }[];
  facets: FacetGroup[];
  productTotal: number;
  businessTotal: number;
}

export function AppliedChips({
  query,
  basePath,
  facets,
}: {
  query: SearchQuery;
  basePath: string;
  facets: FacetGroup[];
}) {
  const chips: { key: string; facet: string; value: string; href: string }[] = [];

  for (const group of facets) {
    for (const option of group.options) {
      if (!option.selected) continue;
      chips.push({
        key: `${group.key}:${option.value}`,
        facet: group.label,
        value: option.label,
        href: `${basePath}?${toSearchParams(withoutFacet(query, group.key))}`,
      });
    }
  }

  if (chips.length === 0) return null;

  const clearAllHref = `${basePath}?${toSearchParams({ ...query, tab: query.tab, q: query.q, spec: {}, availability: [], page: 1, emirate: undefined, area: undefined, tier: undefined, freeZone: false, replyWithinHours: undefined, yearsTrading: undefined })}`;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map((chip) => (
        <FilterChip
          key={chip.key}
          facet={chip.facet}
          removeHref={chip.href}
          removeLabel={t("results.remove_filter", { facet: chip.facet })}
        >
          {chip.value}
        </FilterChip>
      ))}
      <a
        href={clearAllHref}
        // Usually clean, and then it needs no rel. Not always: a search keeps
        // its `q` and the products tab keeps its `tab`, and either leaves a
        // query string behind after every facet is dropped.
        rel={crawlRel(clearAllHref)}
        className="rounded-tag px-1 text-caption text-moss underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
      >
        {t("results.clear_all")}
      </a>
    </div>
  );
}

export function ResultsTabs({
  query,
  basePath,
  businessTotal,
  productTotal,
}: {
  query: SearchQuery;
  basePath: string;
  businessTotal: number;
  productTotal: number;
}) {
  const businessesHref = pathWithQuery(basePath, query, { tab: "businesses", page: 1 });
  const productsHref = pathWithQuery(basePath, query, { tab: "products", page: 1 });

  return (
    <Tabs
      as="a"
      variant="enclosed"
      label={t("gallery.tabs_label")}
      active={query.tab}
      items={[
        {
          key: "businesses",
          label: t("results.businesses_tab"),
          badge: businessTotal,
          href: businessesHref,
        },
        {
          key: "products",
          label: t("results.products_tab"),
          badge: productTotal,
          // The products tab is not the only path to a product: every one has
          // its own `/b/:seller/p/:product` page and the sitemap lists it. So
          // taking the tab out of the graph costs no reachability, and leaving
          // it in would double the whole facet space against itself.
          href: productsHref,
        },
      ]}
    />
  );
}

/** Slugs already in the comparison tray, carried in the URL. */
export const COMPARE_MAX = 4;

export function CompareTray({
  tray,
  basePath,
  search,
}: {
  tray: string[];
  basePath: string;
  search: string;
}) {
  if (tray.length === 0) return null;
  const params = new URLSearchParams(search);
  params.delete("compare");
  const cleared = params.toString();

  return (
    <div
      aria-live="polite"
      className="flex flex-wrap items-center gap-3 rounded-card border-[1.5px] border-moss bg-moss-wash px-3 py-2"
    >
      <span className="font-mono text-caption tabular-nums text-moss-deep">
        {t("compare.tray", { count: tray.length })}
      </span>
      <a
        href={`/compare?p=${tray.join(",")}`}
        // /compare is disallowed in robots.txt and noindex besides — a tray of
        // whichever suppliers one buyer happened to pick means nothing to
        // anyone else. This is the anchor that told a crawler it existed.
        rel="nofollow"
        className="rounded-ctl border border-moss bg-moss px-3 py-1 text-caption font-medium text-on-ink transition-colors duration-120 ease-out hover:bg-moss-hover focus-visible:outline-none focus-visible:shadow-focus"
      >
        {t("compare.open")}
      </a>
      <a
        href={cleared ? `${basePath}?${cleared}` : basePath}
        rel={crawlRel(cleared ? `${basePath}?${cleared}` : basePath)}
        className="rounded-tag text-caption text-moss-deep underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
      >
        {t("compare.clear")}
      </a>
    </div>
  );
}

export function ResultsList({
  query,
  basePath,
  businesses,
  products,
  specFields = [],
  tray = [],
  search = "",
}: Pick<ResultsSurfaceProps, "query" | "basePath" | "businesses" | "products" | "specFields"> & {
  tray?: string[];
  search?: string;
}) {
  /** Toggle this supplier in the tray without leaving the results page. */
  function compareHref(slug: string): string {
    const params = new URLSearchParams(search);
    const next = tray.includes(slug)
      ? tray.filter((s) => s !== slug)
      : [...tray, slug].slice(0, COMPARE_MAX);
    if (next.length > 0) params.set("compare", next.join(","));
    else params.delete("compare");
    const qs = params.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  }

  if (query.tab === "products" && products) {
    return (
      <>
        {/* The page h1 names the category or the query; the cards are h3. This
            is the level between them, and it is the tab that is showing. */}
        <h2 className="sr-only">{t("results.products_tab")}</h2>
        <div className="grid gap-[var(--gutter)] sm:grid-cols-2 xl:grid-cols-3">
          {products.rows.map((product) => (
            <ProductCard
              enquireHref={`/rfq/new?to=${product.business.slug}`}
              key={product.id}
              product={{
                slug: product.slug,
                businessSlug: product.business.slug,
                name: product.name,
                sku: product.sku,
                availability: product.availability,
                stockQty: product.stockQty,
                leadTimeDays: product.leadTimeDays,
                minOrderQty: product.minOrderQty,
                sizeLabel: primarySize(specFields, product.specValues),
              }}
            />
          ))}
        </div>
        <ResultsPagination query={query} basePath={basePath} total={products.total} />
      </>
    );
  }

  if (!businesses) return null;

  return (
    <>
      <h2 className="sr-only">{t("results.businesses_tab")}</h2>
      {/*
         List or grid, the buyer's choice, carried in the URL.

         The grid reuses `ListingCard`'s own `grid` context rather than a second
         layout: that composition already exists for the home page and the
         category cards, and inventing a third arrangement of the same facts is
         how two surfaces drift apart. What the grid trades away is the
         description and the decision column — it is the denser scan, for
         somebody who knows the trade and is looking for a name they recognise.
      */}
      <div
        className={
          query.view === "grid"
            ? "grid gap-[var(--gutter)] sm:grid-cols-2 xl:grid-cols-3"
            : "flex flex-col gap-[var(--gutter)]"
        }
      >
        {businesses.rows.map((business) => {
          const sponsored = business.id === businesses.sponsoredId;
          return (
            <div key={business.id}>
              {sponsored && (
                <div className="mb-1 flex items-center gap-2">
                  <StatusBadge tone="neutral" size="sm">
                    {t("results.sponsored")}
                  </StatusBadge>
                  <span className="text-caption text-muted">{t("results.sponsored_note")}</span>
                </div>
              )}
              <ListingCard
                enquireHref={`/rfq/new?to=${business.slug}`}
                context={
                  business.claimStatus === "unclaimed"
                    ? "unclaimed"
                    : query.view === "grid"
                      ? "grid"
                      : "search"
                }
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
                  responseTimeMedianMs: business.responseTimeMedianMs,
                  responseDurationLabel: business.responseTimeMedianMs
                    ? formatDuration(business.responseTimeMedianMs)
                    : undefined,
                  establishedYear: business.establishedYear,
                  ratingOverall: business.ratingOverall,
                  branchCount: business._count.locations,
                  // A TRN on the record, said as a fact. The number itself is
                  // masked on every surface but the seller's own.
                  trnOnFile: Boolean(business.trn),
                  description: business.description,
                  coverImageUrl: business.media[0]
                    ? publicUrl(MEDIA_BUCKET, business.media[0].storagePath)
                    : null,
                  // The trades they actually carry, not the one they were
                  // filed under. Four is what fits before the line wraps.
                  tradeLine:
                    business.categories.length > 0
                      ? business.categories
                          .slice(0, 4)
                          .map((row) => row.category.name)
                          .join(" · ")
                      : business.primaryCategory.name,
                  sponsored,
                }}
                sponsoredLabel={t("results.sponsored")}
                contactAction={
                  <RevealWhatsApp
                    businessId={business.id}
                    /*
                       Only a verified number reaches a buyer. `Location`
                       carries the rule in a comment — "an unverified number is
                       hidden from buyers" — and the branches page already
                       honours it; a results row is a wider surface than that
                       one, not a narrower one.
                    */
                    whatsapp={
                      business.locations[0]?.phoneVerified
                        ? (business.locations[0]?.whatsapp ?? null)
                        : null
                    }
                    surface={basePath}
                  />
                }
                compareHref={compareHref(business.slug)}
                inCompare={tray.includes(business.slug)}
                compareLabel={tray.includes(business.slug) ? t("action.in_compare") : undefined}
              />
            </div>
          );
        })}
      </div>
      <ResultsPagination query={query} basePath={basePath} total={businesses.total} />
    </>
  );
}

function ResultsPagination({
  query,
  basePath,
  total,
}: {
  query: SearchQuery;
  basePath: string;
  total: number;
}) {
  if (total <= PAGE_SIZE) return null;
  const pages = Math.ceil(total / PAGE_SIZE);
  const from = (query.page - 1) * PAGE_SIZE + 1;
  const to = Math.min(total, query.page * PAGE_SIZE);
  const previousHref = `${basePath}?${toSearchParams({ ...query, page: query.page - 1 })}`;
  const nextHref = `${basePath}?${toSearchParams({ ...query, page: query.page + 1 })}`;

  // Server-rendered, so the pager is links. Pagination is a client component
  // driven by a callback, which is right for a dashboard table and wrong here.
  return (
    <nav
      aria-label={t("table.page", { page: query.page })}
      className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3"
    >
      <p className="font-mono text-eyebrow tabular-nums text-muted">
        {t("table.range", {
          from: formatCount(from),
          to: formatCount(to),
          total: formatCount(total),
        })}
      </p>
      <div className="flex items-center gap-1">
        {query.page > 1 && (
          <a
            href={previousHref}
            /*
               Pagination is the one query parameter that stays in the crawl
               graph, and it is load-bearing: PAGE_SIZE is 20, the pager is
               prev/next only, and this is the sole internal-link path to every
               supplier past the twentieth in a trade.

               It stays followable only while the URL carries nothing else.
               Paginating a FILTERED shelf is a node inside the combinatorial
               space, and `crawlRel` reads that off the href.
            */
            rel={crawlRel(previousHref)}
            className="rounded-ctl border border-line bg-card px-3 py-1 text-caption text-body hover:border-line-strong focus-visible:outline-none focus-visible:shadow-focus"
          >
            {t("table.previous")}
          </a>
        )}
        {query.page < pages && (
          <a
            href={nextHref}
            rel={crawlRel(nextHref)}
            className="rounded-ctl border border-line bg-card px-3 py-1 text-caption text-body hover:border-line-strong focus-visible:outline-none focus-visible:shadow-focus"
          >
            {t("table.next")}
          </a>
        )}
      </div>
    </nav>
  );
}
