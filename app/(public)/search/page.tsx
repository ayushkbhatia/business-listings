import type { Metadata } from "next";
import Link from "next/link";
import { PublicShell } from "@/components/structure";
import { ListingCard, ProductCard } from "@/components/domain";
import { t } from "@/lib/i18n";
import { MEDIA_BUCKET, publicUrl } from "@/lib/storage";
import { formatCount, formatDuration, formatKm } from "@/lib/format";
import { parseSearchQuery, toSearchParams } from "@/lib/search/query";
import {
  searchBusinesses,
  searchProducts,
  countResults,
  getMapPins,
  getFreeZoneMarks,
} from "@/lib/db/queries";
import { primarySize } from "@/lib/spec";
import { appliedFacetLabels } from "@/lib/search/applied";
import { crossLinkFor } from "@/lib/seo/cross-link";
import { nearestKm } from "@/lib/geo/distance";
import { DirectoryFooter, DirectoryNav } from "@/app/(public)/_chrome";
import { MapResults } from "@/app/(public)/_results/MapResults";
import { SearchFilterBar, SortStrip } from "@/app/(public)/_results/SearchFilterBar";
import { ZeroResult } from "@/app/(public)/_results/ZeroResult";

/**
 * Board 1c — search results and the map.
 *
 * The primary action of the whole site: a buyer types what they need and gets
 * suppliers who can actually supply it. A directory that cannot find a DN100
 * valve is a phone book.
 *
 * ## Why this page is not `Results`
 *
 * `/c/:category` and `/search` shared one composition through handoff 1, on the
 * reasonable ground that a category page is a search with the category fixed.
 * That is still true of the *query*, and both still call `businessWhere`, so
 * there is exactly one predicate. It stopped being true of the *layout* at this
 * board: a 664px column beside a full-height map is not a rail beside a list
 * with a rail's breakpoints, and forcing one component to be both would mean a
 * dozen conditionals whose only job is to undo each other.
 *
 * ## noindex, follow
 *
 * Criterion 10. This is a tool, not a landing page, and every filter
 * permutation is a URL — indexing them would put tens of thousands of
 * near-identical pages into the crawl budget that the emirate and area pages
 * need. `follow` because the links out of here are the point: where a query
 * maps onto a published area page, the cross-link above the results is how
 * search traffic feeds the SEO layer instead of competing with it.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: t("search.results_title"),
  robots: { index: false, follow: true },
};

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function SearchPage({ searchParams }: Props) {
  const sp = await searchParams;
  const query = parseSearchQuery(sp);

  const [results, productTotal, products, mapData, freeZones, crossLink] = await Promise.all([
    searchBusinesses(query),
    countResults({ ...query, tab: "products" }),
    /*
       The products tab.

       Board 1c is the suppliers composition and hands the products one to board
       10c, which is not built. That is a reason to leave the *layout* alone,
       not a reason for the tab to render nothing — it has worked since handoff
       1, and a tab that shows a live count of 63 and then an empty column is
       worse than one that was never offered. So the rows render here in the
       result column, in the grid they already had, and 10c can compose them
       properly.
    */
    query.tab === "products" ? searchProducts(query) : Promise.resolve(null),
    getMapPins(query),
    getFreeZoneMarks(),
    crossLinkFor(query),
  ]);

  // Whichever tab is showing decides the count the page reasons about.
  const total = query.tab === "products" ? productTotal : results.total;

  /*
     Criterion 9: bounds empty, but the query has answers elsewhere.

     Only asked when it can matter — the buyer drew a box and it came back with
     nothing. Showing an empty map beside an empty list would leave them to work
     out for themselves that the problem is where they are looking rather than
     what they asked for, which the board explicitly forbids.
  */
  const elsewhere =
    total === 0 && query.bounds
      ? await countResults({ ...query, bounds: undefined })
      : 0;

  const applied = appliedFacetLabels(query);
  const shown = (query.page - 1) * 20 + (products?.rows.length ?? results.rows.length);
  const remaining = Math.max(0, total - shown);

  return (
    <PublicShell
      bleed
      nav={
        <DirectoryNav
          scope={{
            action: "/search",
            label: query.emirate ? t(`emirate.${query.emirate}` as never) : t("search.scope_uae"),
            placeholder: t("search.placeholder"),
          }}
        />
      }
      footer={<DirectoryFooter />}
    >
      <h1 className="sr-only">
        {query.q ? t("search.results_for", { query: query.q }) : t("search.results_title")}
      </h1>

      <SearchFilterBar
        query={query}
        basePath="/search"
        businessTotal={results.total}
        productTotal={productTotal}
        appliedLabels={applied}
      />

      {/*
         Criterion 10's other half. Where the query lands cleanly on a published
         area page, one line points at it. That page is indexable and this one is
         not, so this is the only route by which a search someone actually ran
         turns into a page Google can rank.
      */}
      {crossLink && (
        <p className="border-b border-line bg-paper-sunk px-4 py-2.5 text-body-sm text-body">
          {t("search.area_page_prompt", {
            category: crossLink.categoryName,
            area: crossLink.areaName,
          })}{" "}
          <Link
            href={crossLink.href}
            className="rounded-tag font-medium text-moss underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
          >
            {t("search.area_page_link")}
          </Link>
        </p>
      )}

      {total === 0 && elsewhere > 0 ? (
        /*
           The box is empty and the query is not. The action clears `bounds`
           and nothing else — the buyer's filters and words are still what they
           asked for, and it is only the viewport that was too tight.
        */
        <div className="mx-auto max-w-2xl px-4 py-12 text-center">
          <h2 className="font-serif text-h2-serif text-ink">{t("search.bounds_empty_title")}</h2>
          <p className="mt-2 text-body text-body">
            {t("search.bounds_empty_body", {
              count: elsewhere,
              formatted: formatCount(elsewhere),
              place: query.emirate ? t(`emirate.${query.emirate}` as never) : t("search.scope_uae"),
            })}
          </p>
          <Link
            href={`/search?${toSearchParams(query, { bounds: undefined, page: 1 })}`}
            className="mt-5 inline-flex rounded-ctl border border-line bg-card px-4 py-2.5 text-body-sm font-medium text-ink hover:bg-paper focus-visible:outline-none focus-visible:shadow-focus"
          >
            {t("search.bounds_empty_action", {
              place: query.emirate ? t(`emirate.${query.emirate}` as never) : t("search.scope_uae"),
            })}
          </Link>
        </div>
      ) : total === 0 ? (
        /*
           The board calls this the most important state on the page, and it is
           the one that turns a failed search into supply: `recordZeroResult`
           has already written the row that feeds the admin gap report and the
           recruitment call list. The map collapses out entirely rather than
           showing an empty rectangle.
        */
        <div className="mx-auto max-w-3xl px-4 py-10">
          <ZeroResult
            rfqHref="/rfq/new"
            query={query}
            basePath="/search"
            suggestion={null}
            facetLabel={(key) => applied.find((f) => f.key === key)?.facet ?? key}
          />
        </div>
      ) : (
        <MapResults
          pins={mapData.pins}
          freeZones={freeZones}
          excluded={mapData.excluded}
          excludedLabel={t("map.excluded", { count: mapData.excluded })}
          {...(mapData.capped
            ? { cappedLabel: t("map.capped", { count: mapData.pins.length }) }
            : {})}
          {...(query.bounds ? { bounds: query.bounds } : {})}
          mapLabel={t("map.results_label")}
          labels={{
            searchArea: t("map.search_area"),
            freeZones: t("map.free_zones"),
            legend: t("map.legend"),
            legendVisited: t("map.legend_visited"),
            legendVerified: t("map.legend_verified"),
            legendUnverified: t("map.legend_unverified"),
            empty: t("map.empty"),
            showList: t("search.show_list"),
            showMap: t("search.show_map"),
          }}
        >
          <SortStrip
            originLabel={results.origin?.label}
            drawHref={`/search?${toSearchParams(query, { page: 1 })}`}
          />

          {/*
             The level between the page's h1 and the cards' h3.

             Without it the outline jumps h1 to h3 and axe reports
             `heading-order`, which it did — the rows are h3 because that is
             what `ListingCard` renders in every context, and the fix belongs
             here rather than in a card that is right about its own level.
          */}
          <h2 className="sr-only">
            {query.tab === "products" ? t("results.products_tab") : t("results.businesses_tab")}
          </h2>

          {products ? (
            /*
               Board 10c's rows in board 1c's column. The grid is the one they
               already had; only the surrounding layout is new.
            */
            <div className="grid gap-4 p-4 sm:grid-cols-2">
              {products.rows.map((product) => (
                <ProductCard
                  key={product.id}
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
                    /*
                       No template loaded here, so no size label.

                       `primarySize` needs the category's spec fields to know
                       which value is the size, and /search spans every category
                       at once — there is no single template to read. Board 10c
                       composes this tab properly and can group by category
                       first; guessing a field id would print the wrong number
                       beside a part, which is the one mistake worth avoiding on
                       a page about specifications.
                    */
                    sizeLabel: primarySize([], product.specValues),
                  }}
                />
              ))}
            </div>
          ) : (
          /*
             An ordered list, because the order is the product. A screen reader
             hears "3 of 218" from the list itself, which is why the rank chip
             beside each name is aria-hidden rather than repeating it.
          */
          <ol className="flex flex-col">
            {results.rows.map((business, index) => (
              <li
                key={business.id}
                // Read by the client bridge for hover and pin selection. The
                // row itself stays server-rendered.
                data-business-id={business.id}
                className="border-b border-line last:border-b-0 data-[selected]:bg-moss-wash"
              >
                <ListingCard
                  context="map"
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
                    coverImageUrl: business.media[0]
                      ? publicUrl(MEDIA_BUCKET, business.media[0].storagePath)
                      : null,
                    ratingOverall: business.ratingOverall,
                    reviewCount: business.reviewCount,
                    responseTimeMedianMs: business.responseTimeMedianMs,
                    responseDurationLabel: business.responseTimeMedianMs
                      ? formatDuration(business.responseTimeMedianMs)
                      : undefined,
                    productCount: business._count.products,
                    rank: (query.page - 1) * 20 + index + 1,
                    /*
                       Measured here rather than returned per row, from the same
                       origin the ranking used — `searchBusinesses` hands back
                       the origin precisely so the two cannot disagree. Absent
                       when there is no origin, which is when the sort strip is
                       also not claiming a distance.
                    */
                    distanceLabel: formatKm(nearestKm(results.origin, business.locations)),
                    /*
                       One live fact. The catalogue size is the one this row can
                       state truthfully today: opening hours are stored per
                       location and would need the Ramadan-aware `hoursInEffect`
                       pipeline plus an Asia/Dubai clock to say "Open until
                       18:00" without lying on a Friday.
                    */
                    liveFact:
                      business._count.products > 0
                        ? t("listing.products", { count: business._count.products })
                        : undefined,
                    sponsored: business.id === results.sponsoredId,
                  }}
                  sponsoredLabel={t("results.sponsored")}
                  enquireHref={`/rfq/new?supplier=${business.slug}`}
                />
              </li>
            ))}
          </ol>
          )}

          {/*
             An anchor, not infinite scroll. The board's render shows a skeleton
             row as the next page streaming in; the spec is explicit that the
             real behaviour is a "Show 20 more" link, because a results list
             nobody can link into or reach the end of is one a buyer cannot send
             to a colleague.
          */}
          {remaining > 0 && (
            <div className="border-t border-line p-4">
              <Link
                href={`/search?${toSearchParams(query, { page: query.page + 1 })}`}
                className="block rounded-ctl border border-line bg-card px-4 py-2.5 text-center text-body-sm font-medium text-ink hover:bg-paper focus-visible:outline-none focus-visible:shadow-focus"
              >
                {t("search.show_more", { count: Math.min(20, remaining) })}
              </Link>
            </div>
          )}
        </MapResults>
      )}
    </PublicShell>
  );
}
