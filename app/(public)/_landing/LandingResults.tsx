import { ListingCard } from "@/components/domain";
import { Button } from "@/components/primitives";
import { crawlRel } from "@/lib/seo/crawl-policy";
import { formatCount, formatDuration } from "@/lib/format";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import type { BusinessResult } from "@/lib/db/queries";

/**
 * Board 6a §4 — the results block.
 *
 * Ten rows, an RFQ prompt and one pagination control. Deliberately **not**
 * `_results/Results.tsx`: that surface is board 1b's, with a filter rail, two
 * tabs, a sort toolbar and a compare tray, and it is right for a buyer who is
 * already on the site narrowing something down. A buyer who arrived here from
 * Google has already narrowed — the scope *is* the filter — and the page's job
 * is to convert rather than to let them keep filtering. §SEO budgets this page
 * at about fifty anchors for the same reason.
 *
 * `Show all {n} companies` paginates in place. It must **not** link to a
 * filtered `1b` view: `1b`'s canonical rule already points emirate-filtered
 * views back at this page, so that link would be a canonical round trip —
 * criterion 10.
 */

export interface LandingResultsProps {
  heading: string;
  /** Right-aligned, naming the ranking basis. Never a two-key sort we do not run. */
  caption: string;
  rows: readonly BusinessResult[];
  total: number;
  page: number;
  pageCount: number;
  /** The unfiltered address, plus whatever subcategory filter is applied. */
  hrefFor: (page: number) => string;
  rfqHref: string;
  rfqLabel: string;
  /** The sponsored slot, when one was placed. Always labelled. */
  sponsoredId: string | null;
}

export function LandingResults({
  heading,
  caption,
  rows,
  total,
  page,
  pageCount,
  hrefFor,
  rfqHref,
  rfqLabel,
  sponsoredId,
}: LandingResultsProps) {
  const from = (page - 1) * rows.length;

  return (
    <section className="border-b border-line bg-card px-[var(--gutter)] py-8">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1.5">
          <h2 className="font-serif text-h1-serif text-ink">{heading}</h2>
          <p className="text-caption text-muted">{caption}</p>
        </div>

        {/*
           An `ol`, because the position is the information. The rank disc in
           each row is `aria-hidden` so a screen reader hears "3" once, from the
           list, rather than twice.
        */}
        <ol className="mt-4 flex flex-col gap-3">
          {rows.map((business, index) => (
            <li key={business.id}>
              <ListingCard
                context="ranked"
                selected={page === 1 && index === 0}
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
                  /*
                     The 52px mark on the board. `Business` has no logo column
                     — a logo is a `Media` row of kind `logo` — and the search
                     include takes one `gallery` image for the wide row's photo,
                     not a logo. So the tile falls back to the category mark,
                     which `LogoTile` already draws and which is the honest
                     placeholder: a two-letter trade code rather than a blank
                     square or an invented initial.
                  */
                  description: business.description,
                  rank: from + index + 1,
                  ratingOverall: business.ratingOverall,
                  reviewCount: business.reviewCount,
                  responseTimeMedianMs: business.responseTimeMedianMs,
                  responseDurationLabel:
                    business.responseTimeMedianMs === null
                      ? undefined
                      : formatDuration(business.responseTimeMedianMs),
                  establishedYear: business.establishedYear,
                  productCount: business._count.products,
                  sponsored: business.id === sponsoredId,
                }}
                sponsoredLabel={t("results.sponsored")}
                enquireHref={`/rfq/new?to=${business.slug}`}
              />
            </li>
          ))}
        </ol>

        {/*
           The dashed border is §Interaction's "empty, add or drop something
           here" — this is the one thing on the page a buyer has not filled in.
           On a thin page it does more work than any individual row, which is
           why it sits above the pagination rather than below it.
        */}
        <div className="mt-5 flex flex-wrap items-center gap-4 rounded-card border border-dashed border-line-strong bg-paper px-4 py-3.5">
          <p className="text-body-sm text-body">{t("landing.rfq_prompt")}</p>
          <a
            href={rfqHref}
            // The composer is `noindex` and force-dynamic; one uncached URL per
            // scope is not a page a crawler should be spending budget reaching.
            rel={crawlRel(rfqHref)}
            className="ms-auto"
          >
            <Button size="md" tabIndex={-1}>
              {rfqLabel}
            </Button>
          </a>
        </div>

        {pageCount > 1 && (
          <nav
            aria-label={t("landing.pagination_label")}
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
                {/*
                   "Show all 218 companies" on page 1, because that is what a
                   reader on page 1 is asking for. On page 4 it is "Next", which
                   is what the control actually does from there — a button that
                   says "show all" four pages in has been lying for three pages.
                */}
                {page === 1
                  ? t("landing.show_all", { count: formatCount(total) })
                  : t("landing.next")}
              </a>
            )}
          </nav>
        )}
      </div>
    </section>
  );
}
