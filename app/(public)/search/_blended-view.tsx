import Link from "next/link";
import { FilterChip } from "@/components/display";
import { BlendedResultList, compareKey, type CompareTicks } from "@/components/domain/BlendedResultRows";
import { buttonClassName } from "@/components/primitives";
import { FilterRail, Tabs, type FilterSection } from "@/components/structure";
import { cn } from "@/lib/cn";
import type { PairedCopies } from "@/lib/i18n/paired";
import type { BlendedSearchResult } from "@/lib/search/blended-views";
import { formatCount, formatList } from "@/lib/format";
import { t } from "@/lib/i18n";
import { appliedFacetLabels } from "@/lib/search/applied";
import { tabForScope, visibleTabs, type FacetGroupView, type FacetScope } from "@/lib/search/blended";
import {
  currentFacetValues,
  emptyServiceFacets,
  pathWithQuery,
  setFacet,
  sortsForTab,
  sortInScope,
  toggleFacet,
  toSearchParams,
  trayParams,
  withoutFacet,
  type BlendedTab,
  type SearchQuery,
  type SearchSort,
} from "@/lib/search/query";
import { crawlRel } from "@/lib/seo/crawl-policy";
import { FacetOptionLink } from "@/app/(public)/_results/FacetLinks";
import { FilterPanel } from "@/app/(public)/_results/FilterPanel";
import { SaveSearch } from "@/app/(public)/_results/SaveSearch";
import { ZeroInKind, ZeroNothing } from "@/app/(public)/_results/BlendedZero";
import { AlertForm } from "@/app/(public)/_results/AlertForm";
import { setAlert } from "@/app/(public)/_results/alert-actions";

/**
 * Boards `10c` + `10c-s` — the one search results screen, from a query and a
 * result.
 *
 * No database import, so the gallery renders the page's own parts from fixed
 * values rather than a copy of them. `_blended.tsx` fetches and frames it.
 *
 * **D1: the tab row filters one list; it does not partition the index.** Every
 * number on the screen — the header, the four tabs, the rail's counts, the rows
 * — comes from one predicate over one set, and a tab narrows what is already
 * there. The header says so in a sentence rather than leaving a buyer to work
 * it out from the arithmetic.
 */

const BASE = "/search";

export interface BlendedBodyProps {
  query: SearchQuery;
  result: BlendedSearchResult;
  copy: PairedCopies;
  /** `B8` — supplier slugs in the comparison tray, carried in `?compare=`. */
  tray?: readonly string[];
}

/** How many suppliers `/compare` will set side by side. */
const COMPARE_MAX = 4;

export function BlendedBody({ query, result, copy, tray = [] }: BlendedBodyProps) {
  const active = result.active;
  const tabs = visibleTabs(result.counts, active);
  const applied = appliedFilters(query, result);
  const clearAllHref = pathWithQuery(BASE, clearedQuery(query));

  const railSections: FilterSection[] = [];
  for (const scope of result.rail) {
    scope.groups.forEach((group, index) => {
      railSections.push({
        key: `${scope.scope}:${group.key}`,
        label: group.label,
        activeCount: group.options.filter((option) => option.selected).length,
        defaultOpen: true,
        children: <RailGroup group={group} query={query} active={active} />,
        ...(index === 0
          ? {
              eyebrow: {
                label: t(`search_blended.scope.${scope.scope}` as "search_blended.scope.shared"),
                count: scope.narrowsTo ?? undefined,
                note:
                  scope.scope === "shared"
                    ? undefined
                    : t(`search_blended.scope_note.${scope.scope}` as "search_blended.scope_note.products"),
              },
            }
          : {}),
      });
    });
  }

  /*
     `B8`/`Q1` — compare accepts a supplier, and a service row renders no tick.
     `/compare` sets ten fixed business attributes side by side (D3); a service
     has no comparable sheet, and what a buyer compares for a service is the
     proposals that come back on `1n-s`. So the tray is absent entirely while
     Services is the active scope, rather than present and inert.
  */
  const comparable = active !== "services";
  const ticks: CompareTicks = {};
  if (comparable) {
    for (const row of result.rows) {
      if (row.kind === "service") continue;
      const selected = tray.includes(row.businessSlug);
      if (!selected && tray.length >= COMPARE_MAX) continue;
      const next = selected
        ? tray.filter((slug) => slug !== row.businessSlug)
        : [...tray, row.businessSlug];
      ticks[compareKey(row)] = {
        href: `${BASE}?${trayParams(query, next)}`,
        selected,
      };
    }
  }

  return (
    <>
      {/*
         The header and the tab row, full width under the nav. Tab counts stay
         visible at every width — on a phone they are the screen's orientation.
      */}
      <div className="border-b border-line bg-card">
        <div className="mx-auto max-w-7xl px-4 pt-4 md:px-6">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
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
            <Breakdown result={result} />
          </div>

          <div className="mt-3 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
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
            {/*
               D1, stated. A tab row that looks like a page switcher is read as
               one, and the whole argument of this screen is that it is not.
            */}
            <p className="pb-2 text-body-sm text-muted">{t("search_blended.tabs_note")}</p>
          </div>
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
            <div className="min-w-0">
              {/*
                 `10c` contribution 1 — the line that makes this a search rather
                 than a phone book, said where a buyer can act on it.
              */}
              {result.specMatched && (
                <p className="max-w-[var(--measure-prose)] text-body-sm text-body">
                  {t("search_blended.spec_matched")}
                </p>
              )}
              {/*
                 The filter named, not counted — *Dubai · FTA registered tax
                 agent*, never *1 filter*, which is a number a buyer has to open
                 the rail to decode.
              */}
              {applied.length > 0 && (
                <p className="mt-1 text-body-sm text-muted">
                  {applied.map((filter) => filter.value).join(" · ")}
                </p>
              )}
            </div>
            <SortControl query={query} active={active} />
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

          <div className="mt-3 flex flex-wrap items-center justify-end gap-3">
            {comparable && tray.length > 0 && <CompareTray query={query} tray={tray} />}
            <SaveSearch
              search={toSearchParams(query, { kind: active, page: 1 })}
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

          {/* `1c-s` B9 — the RFQ prompt sits above the results. For a service the fan-out is often the better answer. */}
          {result.zero === "none" && result.rfq && <RfqPrompt result={result} />}

          {result.zero === "nothing" ? (
            <ZeroNothing
              query={query}
              result={result}
              clearAllHref={clearAllHref}
              alert={
                /*
                   `Q4` — and the honest half of the answer. This alert writes a
                   `ProductAlert`, which fires the day a matching **product** is
                   listed, so the copy says product. A buyer with an account gets
                   the kind-agnostic version by saving the search: a saved search
                   that found nothing is a standing *when listed* watch, and it
                   counts services and suppliers through the same predicate this
                   page does.
                */
                query.q.trim().length > 0 ? (
                  <AlertForm
                    query={query.q}
                    {...(query.emirate ? { emirate: query.emirate } : {})}
                    create={setAlert}
                  />
                ) : null
              }
            />
          ) : result.zero === "kind" ? (
            <ZeroInKind query={query} result={result} />
          ) : (
            <section aria-labelledby="blended-results" className="mt-5">
              <h2 id="blended-results" className="sr-only">
                {t("search_blended.list_label")}
              </h2>
              <BlendedResultList rows={result.rows} copy={copy} compare={comparable ? ticks : undefined} />

              {/*
                 `1c-s` B4 — a product result stays in the blend, and says so.
                 Only on Everything, and only where there are services beside it:
                 on a goods-only query a product needs no explanation.
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

              <Pager query={query} result={result} />
            </section>
          )}
        </div>
      </div>
    </>
  );
}

/* ── The header's second line ────────────────────────────────────────────── */

/**
 * `B2`, said out loud — *148 products from 44 suppliers · 164 services from 71
 * suppliers*.
 *
 * A buyer reading `Products 148 · Services 164 · Suppliers 96` has every reason
 * to add the first two firm counts, and this is the sentence that shows why
 * 44 + 71 is not 96: nineteen firms returned one of each.
 */
export function Breakdown({ result }: { result: BlendedSearchResult }) {
  const parts: string[] = [];
  if (result.breakdown.products > 0) {
    parts.push(
      `${t("search_blended.n_products", {
        count: result.breakdown.products,
        formatted: formatCount(result.breakdown.products),
      })} ${t("search_blended.from_suppliers", {
        count: result.breakdown.productSuppliers,
        formatted: formatCount(result.breakdown.productSuppliers),
      })}`,
    );
  }
  if (result.breakdown.services > 0) {
    parts.push(
      `${t("search_blended.n_services", {
        count: result.breakdown.services,
        formatted: formatCount(result.breakdown.services),
      })} ${t("search_blended.from_suppliers", {
        count: result.breakdown.serviceSuppliers,
        formatted: formatCount(result.breakdown.serviceSuppliers),
      })}`,
    );
  }
  if (parts.length === 0) return null;
  return <p className="text-body-sm text-body">{parts.join(" · ")}</p>;
}

/* ── The rail ────────────────────────────────────────────────────────────── */

/**
 * One group's options, as links — and `B3`'s switch built into every href.
 *
 * A products-scope link carries `kind=products` and a services-scope one
 * `kind=services`, so *choosing one of these implies the Products tab* is a
 * property of the URL rather than a behaviour a buyer has to discover. A shared
 * option keeps whatever tab is in view: it narrows, it does not choose a kind.
 */
export function RailGroup({
  group,
  query,
  active,
}: {
  group: FacetGroupView;
  query: SearchQuery;
  active: BlendedTab;
}) {
  const tab = tabForScope(group.scope as FacetScope, active);
  return (
    <div className="pb-2">
      {group.options.map((option) => {
        const next = toggleFacet(query, group.key, option.value, {
          multi: group.multi,
          selected: option.selected,
        });
        return (
          <FacetOptionLink
            key={option.value}
            href={pathWithQuery(BASE, next, { kind: tab === "all" ? undefined : tab, page: 1 })}
            label={option.label}
            count={option.count}
            selected={option.selected}
            selectedLabel={t("results.facet_selected")}
            disabled={option.disabled}
            disabledLabel={t("search_blended.facet_disabled")}
          />
        );
      })}
      {group.hidden > 0 && (
        <p className="pt-1 text-caption text-muted">{t("search_blended.facet_hidden", { count: group.hidden })}</p>
      )}
    </div>
  );
}

/* ── Sort ────────────────────────────────────────────────────────────────── */

/**
 * `Q3` — one cross-kind order, plus the kind-specific one, in scope.
 *
 * *Most complete specs* cannot rank a service against a product, so it appears
 * only while Products is the active tab, and the strip says why rather than
 * letting an option that comes and goes read as a bug. Links, not a `select`:
 * a dropdown needs JavaScript to navigate and every order here is a URL.
 */
export function SortControl({ query, active }: { query: SearchQuery; active: BlendedTab }) {
  const options = sortsForTab(active);
  const current = sortInScope(query.sort, active);
  return (
    <nav aria-label={t("search_blended.sort_label_a11y")} className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="text-body-sm text-muted">{t("search_blended.sort_label")}</span>
      {options.map((sort) => {
        const on = sort === current;
        const href = pathWithQuery(BASE, query, { sort, page: 1 });
        return (
          <a
            key={sort}
            href={href}
            rel={crawlRel(href)}
            {...(on ? { "aria-current": "true" as const } : {})}
            className={cn(
              "rounded-tag px-1.5 py-0.5 text-body-sm underline-offset-4",
              "focus-visible:outline-none focus-visible:shadow-focus",
              on ? "font-medium text-ink" : "text-body hover:text-ink hover:underline",
            )}
          >
            {t(`search_blended.sort.${sort}` as "search_blended.sort.best")}
          </a>
        );
      })}
      {active === "products" && (
        <span className="sr-only">{t("search_blended.sort_scope_note")}</span>
      )}
    </nav>
  );
}

/* ── Compare ─────────────────────────────────────────────────────────────── */

export function CompareTray({ query, tray }: { query: SearchQuery; tray: readonly string[] }) {
  const cleared = `${BASE}?${trayParams(query, [])}`;
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
        /*
           `/compare` is disallowed in robots.txt and noindex besides — a tray of
           whichever suppliers one buyer happened to pick means nothing to anyone
           else. This is the anchor that told a crawler it existed.
        */
        rel="nofollow"
        className="rounded-ctl border border-moss bg-moss px-3 py-1 text-caption font-medium text-on-ink transition-colors duration-120 ease-out hover:bg-moss-hover focus-visible:outline-none focus-visible:shadow-focus"
      >
        {t("compare.open")}
      </a>
      <a
        href={cleared}
        rel={crawlRel(cleared)}
        className="rounded-tag text-caption text-moss-deep underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
      >
        {t("compare.clear")}
      </a>
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
 * A reply-time filter can arrive from a goods page's link, and a spec filter
 * from a trade that is not this result set's majority has no rail group either.
 * A filter that narrows the list with no way to see or remove it is the boards'
 * own defect in a quieter form, so each one is a chip.
 */
function appliedFilters(query: SearchQuery, result: BlendedSearchResult): AppliedFilter[] {
  const out: AppliedFilter[] = [];
  const drawn = new Set<string>();

  for (const scope of result.rail) {
    for (const group of scope.groups) {
      drawn.add(group.key);
      for (const option of group.options) {
        if (!option.selected) continue;
        /*
           One value off, whichever kind of group it is. `setFacet` with the
           remaining values clears a single-value group and thins a multi-value
           one, so a chip and its rail option cannot disagree about what removing
           it means.
        */
        const remaining = currentFacetValues(query, group.key).filter((held) => held !== option.value);
        out.push({
          key: group.key,
          facet: group.label,
          value: option.label,
          removeHref: pathWithQuery(BASE, setFacet(query, group.key, remaining)),
        });
      }
    }
  }

  for (const label of appliedFacetLabels(query)) {
    if (drawn.has(label.key)) continue;
    out.push({ ...label, removeHref: pathWithQuery(BASE, withoutFacet(query, label.key)) });
  }

  for (const [fieldId, values] of Object.entries(query.spec)) {
    if (drawn.has(fieldId) || values.length === 0) continue;
    for (const value of values) {
      out.push({
        key: fieldId,
        facet: t("search_blended.facet_spec"),
        value,
        removeHref: pathWithQuery(BASE, withoutFacet(query, fieldId)),
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
    spec: {},
    availability: [],
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

export function RfqPrompt({ result }: { result: BlendedSearchResult }) {
  const rfq = result.rfq;
  if (!rfq) return null;
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
 * `Q5` — pagination, which neither board drew over a 312-result set.
 *
 * A stated window and both directions. The window is the answer to the question
 * a bare *Show 20 more* leaves open on a long list — *where am I* — and it is
 * derived from the same narrowed total the tab badge shows, so the two cannot
 * disagree.
 */
export function Pager({ query, result }: { query: SearchQuery; result: BlendedSearchResult }) {
  const { pager } = result;
  if (pager.total === 0) return null;
  const previous = pager.page > 1 ? pathWithQuery(BASE, query, { page: pager.page - 1 }) : null;
  const next = pager.page < pager.pages ? pathWithQuery(BASE, query, { page: pager.page + 1 }) : null;

  return (
    <nav
      aria-label={t("search_blended.pager_label")}
      className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4"
    >
      <p className="font-mono text-eyebrow tabular-nums text-muted">
        {t("search_blended.pager_range", {
          from: formatCount(pager.from),
          to: formatCount(pager.to),
          formatted: formatCount(pager.total),
        })}
      </p>
      {(previous || next) && (
        <div className="flex items-center gap-2">
          {previous && (
            <a href={previous} rel={crawlRel(previous)} className={buttonClassName({ variant: "secondary" })}>
              {t("search_blended.pager_previous")}
            </a>
          )}
          {next && (
            <a href={next} rel={crawlRel(next)} className={buttonClassName({ variant: "secondary" })}>
              {t("search_blended.pager_next")}
            </a>
          )}
        </div>
      )}
    </nav>
  );
}
