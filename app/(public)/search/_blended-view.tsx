import Link from "next/link";
import { FilterChip } from "@/components/display";
import { BlendedResultList } from "@/components/domain/BlendedResultRows";
import { buttonClassName } from "@/components/primitives";
import { FilterRail, Tabs } from "@/components/structure";
import { cn } from "@/lib/cn";
import {
  BLENDED_PAGE_SIZE,
  type BlendedSearchResult,
  type RfqPromptFacts,
} from "@/lib/search/blended-views";
import { formatCount, formatList } from "@/lib/format";
import { t } from "@/lib/i18n";
import { appliedFacetLabels } from "@/lib/search/applied";
import { visibleTabs, type FacetGroupView } from "@/lib/search/blended";
import {
  emptyServiceFacets,
  pathWithQuery,
  serviceFacetsOf,
  toSearchParams,
  withoutFacet,
  type BlendedTab,
  type SearchQuery,
} from "@/lib/search/query";
import { crawlRel } from "@/lib/seo/crawl-policy";
import { FacetOptionLink } from "@/app/(public)/_results/FacetLinks";
import { FilterPanel } from "@/app/(public)/_results/FilterPanel";
import { SaveSearch } from "@/app/(public)/_results/SaveSearch";
import { ZeroResult } from "@/app/(public)/_results/ZeroResult";
import { AlertForm } from "@/app/(public)/_results/AlertForm";
import { setAlert } from "@/app/(public)/_results/alert-actions";

/**
 * Board `1c-s` — the blended page's markup, from a query and a result.
 *
 * No database import, so the gallery renders the page's own parts from fixed
 * values rather than a copy of them. `_blended.tsx` fetches and frames it.
 */

const BASE = "/search";

/**
 * The body, from a query and a result — so the gallery renders the page's own
 * markup from a fixed result rather than a copy of it.
 */
export function BlendedBody({ query, result }: { query: SearchQuery; result: BlendedSearchResult }) {
  const applied = appliedFilters(query, result.rail);
  const tabs = visibleTabs(result.counts, query.kind);
  const active: BlendedTab = query.kind ?? "all";
  const nothingAtAll = result.unfilteredTotal === 0;

  const railSections = result.rail.map((group) => ({
    key: group.key,
    label: group.label,
    activeCount: group.options.filter((option) => option.selected).length,
    defaultOpen: true,
    children: <RailGroup group={group} query={query} />,
  }));

  const clearAllHref = pathWithQuery(BASE, clearedQuery(query));

  return (
    <>
      {/*
         The tab row, full width under the nav. Tab counts stay visible at every
         width — on a phone they are the screen's orientation.
      */}
      <div className="border-b border-line bg-card">
        <div className="mx-auto max-w-7xl px-4 md:px-6">
          <Tabs
            as="a"
            variant="line"
            label={t("search_blended.tabs_label")}
            active={active}
            items={tabs.map((tab) => ({
              key: tab,
              label: t(`search_blended.tab.${tab}` as "search_blended.tab.all"),
              badge: result.counts[tab],
              href: pathWithQuery(BASE, query, { kind: tab === "all" ? undefined : tab, page: 1 }),
            }))}
          />
        </div>
      </div>

      <div
        className={cn(
          "mx-auto grid max-w-7xl gap-6 px-4 py-6 md:px-6 lg:gap-10",
          railSections.length > 0 && "lg:grid-cols-[15rem_minmax(0,1fr)]",
        )}
      >
        {railSections.length > 0 ? (
          <div className="min-w-0">
            <FilterPanel
              appliedCount={applied.length}
              rail={
                <FilterRail
                  label={t("results.filters")}
                  appliedCount={applied.length}
                  appliedLabel={t("results.applied", { count: applied.length })}
                  clearAllLabel={t("results.clear_all")}
                  clearAllHref={clearAllHref}
                  sections={railSections}
                />
              }
            />
          </div>
        ) : null}

        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
              <h1 className="text-h1 text-ink">
                {query.q
                  ? t("search_blended.heading_query", {
                      count: result.counts.all,
                      formatted: formatCount(result.counts.all),
                      query: query.q,
                    })
                  : t("search_blended.heading", {
                      count: result.counts.all,
                      formatted: formatCount(result.counts.all),
                    })}
              </h1>
              {/*
                 The filter named, not counted — *Dubai · FTA registered tax
                 agent*, never *1 filter*, which is a number a buyer has to open
                 the rail to decode.
              */}
              {applied.length > 0 && (
                <p className="text-body-sm text-muted">{applied.map((filter) => filter.value).join(" · ")}</p>
              )}
            </div>
            {/*
               B10 — one documented sort, stated, and not a control that offers
               orders nobody has decided. The sentence says how the order is made
               so the drawn sequence of rows is not read as the algorithm.
            */}
            <p className="text-body-sm text-body" title={t("search_blended.sort_note")}>
              {t("search_blended.sort_label")}{" "}
              <span className="font-medium text-ink">{t("search_blended.sort_relevant")}</span>
              <span className="sr-only"> — {t("search_blended.sort_note")}</span>
            </p>
          </div>

          {applied.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              {applied.map((filter) => (
                <FilterChip
                  key={`${filter.key}:${filter.value}`}
                  facet={filter.facet}
                  removeHref={filter.removeHref}
                  removeLabel={t("results.remove_filter", { facet: filter.facet })}
                >
                  {filter.value}
                </FilterChip>
              ))}
            </div>
          )}

          <div className="mt-3 flex justify-end">
            <SaveSearch
              search={toSearchParams(query, { kind: query.kind ?? "all", page: 1 })}
              heading={[query.q.trim(), ...applied.map((filter) => filter.value)].filter(Boolean).join(" · ")}
            />
          </div>

          {result.overflow.length > 0 && (
            <p className="mt-3 rounded-card border border-line bg-paper-sunk px-4 py-2.5 text-body-sm text-body">
              {t("search_blended.overflow", {
                cap: formatCount(1000),
                kinds: formatList(
                  result.overflow.map((kind) =>
                    t(`search_blended.overflow_kind.${kind}` as "search_blended.overflow_kind.service"),
                  ),
                ),
              })}
            </p>
          )}

          {/* B9 — the RFQ prompt sits above the results. For a service the fan-out is often the better answer. */}
          {result.rfq && <RfqPrompt rfq={result.rfq} />}

          {nothingAtAll ? (
            <div className="mt-6">
              <ZeroResult
                query={query}
                basePath={BASE}
                suggestion={null}
                facetLabel={(key) => key}
                rfqHref={result.rfq?.href ?? "/rfq/new"}
                alert={
                  query.q.trim() ? (
                    <AlertForm query={query.q} {...(query.emirate ? { emirate: query.emirate } : {})} create={setAlert} />
                  ) : null
                }
              />
            </div>
          ) : result.counts.all === 0 ? (
            <ZeroAfterFiltering query={query} result={result} clearAllHref={clearAllHref} />
          ) : (
            <section aria-labelledby="blended-results" className="mt-5">
              <h2 id="blended-results" className="sr-only">
                {t("search_blended.list_label")}
              </h2>
              {result.rows.length === 0 ? (
                <p className="rounded-card border border-line bg-card px-4 py-6 text-body-sm text-body">
                  {t("search_blended.zero_tab")}
                </p>
              ) : (
                <BlendedResultList rows={result.rows} />
              )}

              {/*
                 B4 — a product result stays in the blend, and says so. Only on
                 All, and only where there are services beside it: on a goods page
                 a product needs no explanation.
              */}
              {active === "all" && result.counts.products > 0 && result.counts.services > 0 && query.q && (
                <p className="mt-3 text-caption text-muted">
                  {t("search_blended.products_in_blend", {
                    count: result.counts.products,
                    formatted: formatCount(result.counts.products),
                    query: query.q,
                  })}
                </p>
              )}

              <ShowMore query={query} result={result} />
            </section>
          )}
        </div>
      </div>
    </>
  );
}

/* ── The rail ────────────────────────────────────────────────────────────── */

export function RailGroup({ group, query }: { group: FacetGroupView; query: SearchQuery }) {
  const facets = serviceFacetsOf(query);
  return (
    <div className="pb-2">
      {group.options.map((option) => {
        const current = facets[group.key];
        const next = option.selected ? current.filter((value) => value !== option.value) : [...current, option.value];
        return (
          <FacetOptionLink
            key={option.value}
            href={pathWithQuery(BASE, { ...query, services: { ...facets, [group.key]: next }, page: 1 })}
            label={option.label}
            count={option.count}
            selected={option.selected}
            selectedLabel={t("results.facet_selected")}
          />
        );
      })}
      {group.hidden > 0 && (
        <p className="pt-1 text-caption text-muted">{t("search_blended.facet_hidden", { count: group.hidden })}</p>
      )}
    </div>
  );
}

/* ── Applied filters ─────────────────────────────────────────────────────── */

interface AppliedFilter {
  key: string;
  facet: string;
  value: string;
  removeHref: string;
}

/**
 * Every filter on the query, named and removable — the rail's and the ones it
 * does not draw.
 *
 * A tier or reply-time filter can arrive from a goods page's link. The blended
 * rail has no control for either, and a filter that narrows the list with no
 * way to see or remove it is the board's own defect in a quieter form, so each
 * one is a chip.
 */
function appliedFilters(query: SearchQuery, rail: readonly FacetGroupView[]): AppliedFilter[] {
  const out: AppliedFilter[] = appliedFacetLabels(query)
    .filter((label) => label.key !== "availability")
    .map((label) => ({
      ...label,
      removeHref: pathWithQuery(BASE, withoutFacet(query, label.key)),
    }));

  const facets = serviceFacetsOf(query);
  for (const group of rail) {
    for (const option of group.options) {
      if (!option.selected) continue;
      out.push({
        key: group.key,
        facet: group.label,
        value: option.label,
        removeHref: pathWithQuery(BASE, {
          ...query,
          services: { ...facets, [group.key]: facets[group.key].filter((value) => value !== option.value) },
          page: 1,
        }),
      });
    }
  }
  return out;
}

/** Every filter off, the place included, as goods search clears it; the words and the tab kept. */
function clearedQuery(query: SearchQuery): SearchQuery {
  return {
    ...query,
    services: emptyServiceFacets(),
    emirate: undefined,
    area: undefined,
    tier: undefined,
    freeZone: false,
    replyWithinHours: undefined,
    yearsTrading: undefined,
    page: 1,
  };
}

/* ── States ──────────────────────────────────────────────────────────────── */

export function RfqPrompt({ rfq }: { rfq: RfqPromptFacts }) {
  return (
    <div className="mt-4 flex flex-col gap-3 rounded-card border border-line bg-card px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
      <div className="min-w-0">
        <p className="text-body text-ink">{t("search_blended.rfq_body", { count: rfq.cap })}</p>
        {rfq.measured > 0 && (
          <p className="mt-0.5 text-body-sm text-muted">
            {t("search_blended.rfq_measured", {
              count: rfq.measured,
              formatted: formatCount(rfq.measured),
              within: formatCount(rfq.withinDay),
            })}
          </p>
        )}
      </div>
      <Link href={rfq.href} className={buttonClassName()}>
        {t("search_blended.rfq_cta")}
      </Link>
    </div>
  );
}

/**
 * *Zero results after filtering* — the rail stays, each option shows its count,
 * and the empty state names which filter to drop.
 */
export function ZeroAfterFiltering({
  query,
  result,
  clearAllHref,
}: {
  query: SearchQuery;
  result: BlendedSearchResult;
  clearAllHref: string;
}) {
  const suggestion = result.suggestion;
  const group = suggestion ? result.rail.find((candidate) => candidate.key === suggestion.key) : undefined;
  const dropHref = suggestion ? pathWithQuery(BASE, withoutFacet(query, suggestion.key)) : null;

  return (
    <div className="mt-6 rounded-card border border-line bg-card px-4 py-6 sm:px-6">
      <h2 className="text-h2 text-ink">{t("search_blended.zero_title")}</h2>
      <p className="mt-2 text-body text-body">
        {query.q
          ? t("search_blended.zero_body", {
              count: result.unfilteredTotal,
              formatted: formatCount(result.unfilteredTotal),
              query: query.q,
            })
          : t("search_blended.zero_body_no_query", {
              count: result.unfilteredTotal,
              formatted: formatCount(result.unfilteredTotal),
            })}
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        {suggestion && dropHref && (
          <a href={dropHref} rel={crawlRel(dropHref)} className={buttonClassName()}>
            {t("search_blended.zero_drop", {
              facet: group?.label ?? suggestion.key,
              count: suggestion.yields,
              formatted: formatCount(suggestion.yields),
            })}
          </a>
        )}
        <a
          href={clearAllHref}
          rel={crawlRel(clearAllHref)}
          className={buttonClassName({ variant: suggestion ? "secondary" : "primary" })}
        >
          {t("search_blended.zero_clear_all")}
        </a>
      </div>
      <p className="mt-4 text-caption text-muted">{t("zero.recorded")}</p>
    </div>
  );
}

function ShowMore({ query, result }: { query: SearchQuery; result: BlendedSearchResult }) {
  const shown = (query.page - 1) * BLENDED_PAGE_SIZE + result.rows.length;
  const remaining = Math.max(0, result.narrowedTotal - shown);
  if (remaining === 0) return null;
  const href = pathWithQuery(BASE, query, { page: query.page + 1 });
  return (
    <div className="mt-4">
      <Link href={href} className={buttonClassName({ variant: "secondary", block: true })}>
        {t("search_blended.show_more", { count: Math.min(BLENDED_PAGE_SIZE, remaining) })}
      </Link>
    </div>
  );
}
