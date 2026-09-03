import Link from "next/link";
import { FilterRail } from "@/components/structure";
import { ChipLink } from "@/components/display";
import { cn } from "@/lib/cn";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import {
  toCatalogueParams,
  type CatalogueQuery,
  type CatalogueView,
  type CatalogueSort,
} from "@/lib/db/queries";

/**
 * Board 1e's filter rail and toolbar.
 *
 * Every control is an anchor. Filtering a catalogue is a navigation — the URL
 * is the state, a buyer can send it to a colleague, and the page works before
 * any JavaScript arrives. That also makes the selection mechanic possible: a
 * filter change is a page load, and criterion 12 wants the selection to survive
 * it, which is why selection lives in `sessionStorage` rather than in React
 * state that a navigation would discard.
 */

export function CatalogueRail({
  view,
  query,
  basePath,
}: {
  view: CatalogueView;
  query: CatalogueQuery;
  basePath: string;
}) {
  const href = (over: Partial<CatalogueQuery>) => {
    const params = toCatalogueParams(query, { ...over, page: 1 });
    return params ? `${basePath}?${params}` : basePath;
  };

  const applied =
    (query.subcategory ? 1 : 0) +
    query.availability.length +
    Object.values(query.spec).reduce((total, values) => total + values.length, 0);

  const sections = [
    {
      key: "catalogue",
      label: t("catalogue.block_catalogue"),
      activeCount: query.subcategory ? 1 : 0,
      defaultOpen: true,
      children: (
        <ul className="flex flex-col gap-1">
          <li>
            <ChipLink
              href={href({ subcategory: undefined })}
              size="sm"
              selected={!query.subcategory}
            >
              {t("catalogue.all_products")}
            </ChipLink>
          </li>
          {view.subcategories.map((subcategory) => (
            <li key={subcategory.id}>
              <ChipLink
                href={href({ subcategory: subcategory.slug })}
                size="sm"
                selected={query.subcategory === subcategory.slug}
                count={formatCount(subcategory.count)}
              >
                {subcategory.name}
              </ChipLink>
            </li>
          ))}
        </ul>
      ),
    },
    {
      key: "availability",
      label: t("catalogue.block_availability"),
      activeCount: query.availability.length,
      defaultOpen: true,
      children: (
        <ul className="flex flex-col gap-1">
          {view.availability.map((facet) => {
            const next = facet.selected
              ? query.availability.filter((value) => value !== facet.value)
              : [...query.availability, facet.value];
            return (
              <li key={facet.value}>
                <ChipLink
                  href={href({ availability: next })}
                  size="sm"
                  selected={facet.selected}
                  count={formatCount(facet.count)}
                >
                  {t(`availability.${facet.value}` as never)}
                </ChipLink>
              </li>
            );
          })}
        </ul>
      ),
    },
    /*
       Spec blocks, generated from the platform template.

       Absent entirely on a small catalogue — `getCatalogueView` returns none
       below the threshold, because spec filters over eight products are noise.
    */
    ...view.specFilters.map((filter) => ({
      key: filter.fieldId,
      label: filter.unit ? `${filter.label} (${filter.unit})` : filter.label,
      activeCount: filter.options.filter((option) => option.selected).length,
      defaultOpen: filter.options.some((option) => option.selected),
      children: (
        <ul className="flex flex-col gap-1">
          {filter.options.map((option) => {
            const current = query.spec[filter.fieldId] ?? [];
            const next = option.selected
              ? current.filter((value) => value !== option.value)
              : [...current, option.value];
            return (
              <li key={option.value}>
                <ChipLink
                  href={href({ spec: { ...query.spec, [filter.fieldId]: next } })}
                  size="sm"
                  selected={option.selected}
                  count={formatCount(option.count)}
                >
                  {option.value}
                </ChipLink>
              </li>
            );
          })}
        </ul>
      ),
    })),
  ];

  return (
    <>
      <FilterRail
        label={t("catalogue.rail_label")}
        appliedCount={applied}
        appliedLabel={t("results.applied", { count: applied })}
        clearAllLabel={t("results.clear_all")}
        clearAllHref={basePath}
        sections={sections}
      />
      {view.specFilters.length === 0 && view.catalogueTotal > 0 && (
        <p className="mt-2 px-1 text-caption text-faint">{t("catalogue.specs_from")}</p>
      )}
    </>
  );
}

const SORTS: readonly CatalogueSort[] = ["availability", "recent", "name", "enquired"];

/**
 * Count on the left, sort on the right.
 *
 * The sort is four anchors rather than a `select`, for the same reason the rail
 * is: a `select` needs JavaScript to navigate, and these are the whole
 * vocabulary. There is no price sort to add — `Product` has no price column and
 * `QuoteLine` is where a price lives.
 */
export function CatalogueToolbar({
  view,
  query,
  basePath,
}: {
  view: CatalogueView;
  query: CatalogueQuery;
  basePath: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3.5">
      <p className="text-body-sm tabular-nums text-body">
        {t("catalogue.showing", { count: view.total, formatted: formatCount(view.total) })}
      </p>

      <nav aria-label={t("catalogue.sort_label")} className="flex flex-wrap items-center gap-1">
        {SORTS.map((sort) => {
          const params = toCatalogueParams(query, { sort, page: 1 });
          const active = query.sort === sort;
          return (
            <Link
              key={sort}
              href={params ? `${basePath}?${params}` : basePath}
              {...(active ? { "aria-current": "true" as const } : {})}
              className={cn(
                "rounded-ctl px-2.5 py-1.5 text-caption font-medium",
                "focus-visible:outline-none focus-visible:shadow-focus",
                active ? "bg-ink text-on-ink" : "text-body hover:text-ink",
              )}
            >
              {t(`catalogue.sort.${sort}` as never)}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
