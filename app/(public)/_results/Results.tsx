import { FilterRail } from "@/components/structure";
import { t } from "@/lib/i18n";
import {
  countResults,
  getFixedFacets,
  getSpecFacets,
  getSponsoredBusinessId,
  getSpecTemplate,
  recordZeroResult,
  searchBusinesses,
  searchProducts,
  suggestFilterToDrop,
  type FacetGroup,
} from "@/lib/db/queries";
import { appliedKeys, toSearchParams, type SearchQuery } from "@/lib/search/query";
import { FacetLinks } from "./FacetLinks";
import { AlertForm } from "./AlertForm";
import { setAlert } from "./alert-actions";
import { ZeroResult } from "./ZeroResult";
import { AppliedChips, CompareTray, ResultsList, ResultsTabs } from "./ResultsSurface";

/**
 * Everything below the breadcrumb on a category page or a search.
 *
 * One component for both because they are the same surface with a different
 * scope: a category page is a search with the category fixed. Building them
 * separately would mean two filter rails and two zero-result states, and one
 * of them drifting.
 */
export interface ResultsProps {
  query: SearchQuery;
  basePath: string;
  /** Fixed by the route on a category page; absent on /search. */
  category?: {
    id: string;
    slug: string;
    name: string;
    ids: string[];
    /**
     * Where to find the spec template, when that is wider than `ids`.
     *
     * A subcategory rarely has one of its own, so its rail was empty: the
     * fields belong to the trade, and the niche inherits them. Counting stays
     * on `ids`, so the numbers on each chip are the subcategory's own.
     */
    templateIds?: string[];
  };
  /** The comparison tray, carried in the URL so adding is a navigation. */
  tray?: string[];
  /** The raw query string, so tray links can preserve every other facet. */
  search?: string;
}

const FIXED_FACET_LABELS = {
  tier: "facet.tier",
  emirate: "facet.emirate",
  freeZone: "facet.free_zone",
  availability: "facet.availability",
  replyWithinHours: "facet.reply",
  yearsTrading: "facet.years",
} as const;

export async function Results({ query, basePath, category, tray = [], search = "" }: ResultsProps) {
  const categoryIds = category?.ids;

  const [businessTotal, productTotal, sponsoredId, specTemplate] = await Promise.all([
    countResults({ ...query, tab: "businesses" }, categoryIds),
    countResults({ ...query, tab: "products" }, categoryIds),
    getSponsoredBusinessId(categoryIds, query.emirate),
    category ? getSpecTemplate(category.id) : Promise.resolve(null),
  ]);

  const [businesses, products] = await Promise.all([
    query.tab === "businesses"
      ? searchBusinesses(query, { categoryIds, sponsoredId })
      : Promise.resolve(undefined),
    query.tab === "products" ? searchProducts(query, { categoryIds }) : Promise.resolve(undefined),
  ]);

  const [fixedFacets, specFacets] = await Promise.all([
    getFixedFacets(query, categoryIds, {
      tier: t("facet.tier"),
      tierOption: (tier) => t("facet.tier_option", { tier }),
      emirate: t("facet.emirate"),
      emirateOption: (value) => t(`emirate.${value}` as never),
      availability: t("facet.availability"),
      availabilityOption: (value) => t(`availability.${value}` as never),
      freeZone: t("facet.free_zone"),
      freeZoneOption: t("facet.free_zone_option"),
      reply: t("facet.reply"),
      replyOption: (hours) => t("facet.reply_option", { hours }),
      years: t("facet.years"),
      yearsOption: (years) => t("facet.years_option", { years }),
    }),
    categoryIds
      ? getSpecFacets(categoryIds, query, category?.templateIds ?? categoryIds)
      : Promise.resolve([] as FacetGroup[]),
  ]);

  // Spec facets first: on a category page they are the reason a buyer came, and
  // "DN100, PN16" narrows a valve search far faster than an emirate does.
  const facets = [...specFacets, ...fixedFacets];
  const total = query.tab === "products" ? productTotal : businessTotal;

  let suggestion = null;
  if (total === 0) {
    // Written before the suggestion is computed so a slow count never costs the
    // record. Nothing reads it until handoff 4; the history is the point.
    await recordZeroResult(query, category?.id ?? null);
    suggestion = await suggestFilterToDrop(query, categoryIds);
  }

  const appliedCount = appliedKeys(query).length;

  return (
    <div className="grid gap-[var(--gutter)] lg:grid-cols-[16rem_minmax(0,1fr)]">
      <div className="min-w-0">
        <FilterRail
          label={t("results.filters")}
          appliedCount={appliedCount}
          appliedLabel={t("results.applied", { count: appliedCount })}
          clearAllLabel={t("results.clear_all")}
          clearAllHref={`${basePath}?${toSearchParams({
            ...query,
            spec: {},
            availability: [],
            emirate: undefined,
            area: undefined,
            tier: undefined,
            freeZone: false,
            replyWithinHours: undefined,
            yearsTrading: undefined,
            page: 1,
          })}`}
          sections={facets.map((group) => ({
            key: group.key,
            label: group.label,
            activeCount: group.options.filter((o) => o.selected).length,
            defaultOpen: group.source === "spec" || group.options.some((o) => o.selected),
            children: (
              <FacetLinks
                group={group}
                query={query}
                basePath={basePath}
                selectedLabel={t("results.facet_selected")}
              />
            ),
          }))}
        />
      </div>

      <div className="min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <ResultsTabs
            query={query}
            basePath={basePath}
            businessTotal={businessTotal}
            productTotal={productTotal}
          />
          <p className="font-mono text-eyebrow tabular-nums text-muted">
            {query.tab === "products"
              ? t("results.product_count", { count: productTotal })
              : t("results.count", { count: businessTotal })}
          </p>
        </div>

        <div className="mt-3 flex flex-col gap-2">
          <AppliedChips query={query} basePath={basePath} facets={facets} />
          <CompareTray tray={tray} basePath={basePath} search={search} />
        </div>

        <div className="mt-4">
          {total === 0 ? (
            <ZeroResult
              rfqHref={category ? `/rfq/new?category=${category.slug}` : "/rfq/new"}
              query={query}
              basePath={basePath}
              suggestion={suggestion}
              facetLabel={(key) => {
                const fixed = FIXED_FACET_LABELS[key as keyof typeof FIXED_FACET_LABELS];
                if (fixed) return t(fixed);
                return facets.find((group) => group.key === key)?.label ?? key;
              }}
              categoryName={category?.name}
              categoryHref={category ? `/c/${category.slug}` : undefined}
              alert={
                /*
                   Criterion 8. Only where there are words to watch for — an
                   alert on an empty query would fire on the next product
                   anybody lists, which is the false positive that loses the
                   buyer on the one message they get.
                */
                query.q.trim().length > 0 ? (
                  <AlertForm
                    query={query.q}
                    {...(category ? { categoryId: category.id } : {})}
                    {...(query.emirate ? { emirate: query.emirate } : {})}
                    create={setAlert}
                  />
                ) : null
              }
            />
          ) : (
            <ResultsList
              query={query}
              basePath={basePath}
              businesses={businesses}
              products={products}
              specFields={specTemplate?.fields}
              tray={tray}
              search={search}
            />
          )}
        </div>
      </div>
    </div>
  );
}
