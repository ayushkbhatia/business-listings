import Link from "next/link";
import { StatusBadge } from "@/components/display";
import { cn } from "@/lib/cn";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import { toSearchParams, type SearchQuery, type SearchSort, type SearchView } from "@/lib/search/query";
import { crawlRel } from "@/lib/seo/crawl-policy";

/**
 * The bar above the results: how they are ordered, how many there are, and
 * which shape they are in.
 *
 * Every control is an anchor. Sort and view are query parameters like every
 * other filter, so the back button works, a pasted URL reproduces the view, and
 * none of it needs JavaScript — criteria 3 and 11. A button that mutated client
 * state would fail all three quietly.
 */

const SORTS: readonly { key: SearchSort; label: () => string }[] = [
  { key: "best", label: () => t("browse.sort_best") },
  { key: "rating", label: () => t("browse.sort_rating") },
  { key: "reply", label: () => t("browse.sort_reply") },
  { key: "newest", label: () => t("browse.sort_newest") },
];

export interface BrowseToolbarProps {
  query: SearchQuery;
  basePath: string;
  total: number;
  pageSize: number;
  /**
   * Sorting five results is noise, so the chips go. The spec calls this the
   * thin-category state and asks for exactly this.
   */
  showSort: boolean;
  /** Shown only when a sponsored card is actually in the list. */
  sponsored: boolean;
}

function href(basePath: string, query: SearchQuery, overrides: Partial<SearchQuery>): string {
  // Any change of order or shape returns to page one. Page 3 of one ordering
  // is not page 3 of another, and landing there would look like results
  // vanishing.
  const params = toSearchParams(query, { ...overrides, page: 1 });
  return params ? `${basePath}?${params}` : basePath;
}

export function BrowseToolbar({
  query,
  basePath,
  total,
  pageSize,
  showSort,
  sponsored,
}: BrowseToolbarProps) {
  const from = total === 0 ? 0 : (query.page - 1) * pageSize + 1;
  const to = Math.min(total, query.page * pageSize);

  return (
    <div className="border-b border-line pb-3.5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        {showSort && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="sr-only" id="sort-label">
              {t("browse.sort")}
            </span>
            <div className="flex flex-wrap gap-1.5" role="group" aria-labelledby="sort-label">
              {SORTS.map((sort) => {
                const active = query.sort === sort.key;
                const to = href(basePath, query, { sort: sort.key });
                return (
                  <Link
                    key={sort.key}
                    href={to}
                    // A sort order is a view of this shelf, never a page of its
                    // own: it is noindex, it canonicalises back here, and it
                    // multiplies against every facet already applied. Out of the
                    // crawl graph — see lib/seo/crawl-policy.ts.
                    rel={crawlRel(to)}
                    aria-current={active ? "true" : undefined}
                    className={cn(
                      "inline-flex h-8 items-center rounded-ctl border px-3 text-body-sm",
                      "transition-colors duration-120 ease-out",
                      "focus-visible:outline-none focus-visible:shadow-focus",
                      active
                        ? "border-ink-surface bg-ink-surface font-medium text-on-ink"
                        : "border-line bg-card text-body hover:border-line-strong hover:text-ink",
                    )}
                  >
                    {sort.label()}
                  </Link>
                );
              })}
            </div>
          </div>
        )}

        <p className="ms-auto font-mono text-eyebrow tabular-nums text-muted">
          {t("browse.range", {
            from: formatCount(from),
            to: formatCount(to),
            total: formatCount(total),
          })}
        </p>

        <div className="flex gap-1.5" role="group" aria-label={t("browse.view_list")}>
          {(["list", "grid"] as const).map((view) => {
            const active = query.view === view;
            const to = href(basePath, query, { view: view as SearchView });
            return (
              <Link
                key={view}
                href={to}
                // List or grid is the same results in a different shape. Same
                // reasoning as sort, and the two multiply against each other.
                rel={crawlRel(to)}
                aria-current={active ? "true" : undefined}
                className={cn(
                  "inline-flex h-8 items-center rounded-ctl border px-3 text-caption",
                  "transition-colors duration-120 ease-out",
                  "focus-visible:outline-none focus-visible:shadow-focus",
                  active
                    ? "border-line-strong bg-fill font-medium text-ink"
                    : "border-line bg-card text-muted hover:text-ink",
                )}
              >
                {view === "list" ? t("browse.view_list") : t("browse.view_grid")}
              </Link>
            );
          })}
        </div>
      </div>

      {/*
         Shown only where a sponsored card is actually in the list. An
         explainer for something nobody can see is noise, and it would tell a
         buyer the results are paid for on a page where none of them are.
      */}
      {sponsored && (
        <div className="mt-3.5 flex flex-wrap items-center gap-3 rounded-card border border-dashed border-line-strong px-3.5 py-3">
          <StatusBadge tone="warn" size="sm">
            {t("results.sponsored")}
          </StatusBadge>
          <span className="text-body-sm text-body">{t("browse.sponsored_note")}</span>
          <Link
            href="/dashboard/promote"
            className="ms-auto rounded-tag text-body-sm font-medium text-moss underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
          >
            {t("browse.sponsored_rates")}
          </Link>
        </div>
      )}
    </div>
  );
}
