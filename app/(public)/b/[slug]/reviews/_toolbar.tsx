import Link from "next/link";
import { ChipLink } from "@/components/display";
import { formatCount } from "@/lib/format";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import {
  REVIEW_FILTERS,
  REVIEW_SORTS,
  toReviewParams,
  type ReviewCounts,
  type ReviewQuery,
} from "@/lib/db/queries";

/**
 * Board 1m section 4 — the filter row.
 *
 * `ChipLink`, not `FilterChip`. They are not the same object: a `FilterChip`
 * says "this filter is applied, here is how to remove it" and carries a remove
 * control; these are four alternatives, one of which is always on, and the way
 * out of one is another rather than an ×.
 *
 * **Critical is always here, including at zero.** A reviews page with no way to
 * find the complaints reads as curated, and a buyer who cannot find the bad
 * ones assumes the worst about the good ones. A visible `0` is more credible
 * than a missing control, so the chip never disappears and is never disabled.
 *
 * Every chip and every sort is an anchor. A filter row that needs JavaScript to
 * move is a filter row that does not work on the first paint a crawler sees,
 * and this page is meant to be indexed for exactly this long-tail text.
 */
export function ReviewToolbar({
  counts,
  query,
  basePath,
}: {
  counts: ReviewCounts;
  query: ReviewQuery;
  basePath: string;
}) {
  const href = (params: string) => (params ? `${basePath}?${params}` : basePath);

  return (
    <div className="flex flex-col gap-3 border-b border-line pb-3.5 lg:flex-row lg:items-center lg:justify-between">
      {/*
         Horizontally scrollable below 768 rather than wrapped to two rows. The
         negative margin lets the first chip sit on the page gutter and the last
         one scroll clear of it.
      */}
      <nav
        aria-label={t("reviewpage.filter_label")}
        className="-mx-5 overflow-x-auto px-5 lg:mx-0 lg:overflow-visible lg:px-0"
      >
        <ul className="flex w-max items-center gap-2 lg:w-auto lg:flex-wrap">
          {REVIEW_FILTERS.map((filter) => (
            <li key={filter}>
              <ChipLink
                href={href(toReviewParams(query, { filter, page: 1 }))}
                count={formatCount(counts[filter])}
                selected={query.filter === filter}
                size="sm"
              >
                {t(`reviewpage.filter.${filter}` as "reviewpage.filter.all")}
              </ChipLink>
            </li>
          ))}
        </ul>
      </nav>

      {/*
         Four anchors rather than a `select`, matching the catalogue toolbar one
         tab along. Two sorts built two ways on two tabs of one storefront is the
         shared-component failure in its cheapest form.
      */}
      <nav
        aria-label={t("reviewpage.sort_label")}
        className="-mx-5 overflow-x-auto px-5 lg:mx-0 lg:overflow-visible lg:px-0"
      >
        <ul className="flex w-max items-center gap-1 lg:w-auto">
          {REVIEW_SORTS.map((sort) => {
            const active = query.sort === sort;
            return (
              <li key={sort}>
                <Link
                  href={href(toReviewParams(query, { sort, page: 1 }))}
                  {...(active ? { "aria-current": "true" as const } : {})}
                  className={cn(
                    "block rounded-ctl px-2.5 py-1.5 text-caption font-medium whitespace-nowrap",
                    "focus-visible:outline-none focus-visible:shadow-focus",
                    active ? "bg-ink text-on-ink" : "text-body hover:text-ink",
                  )}
                >
                  {t(`reviewpage.sort.${sort}` as "reviewpage.sort.recent")}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
