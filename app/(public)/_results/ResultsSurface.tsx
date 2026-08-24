import { Tabs } from "@/components/structure";
import { FilterChip, StatusBadge } from "@/components/display";
import { ListingCard, ProductCard } from "@/components/domain";
import { formatCount, formatDuration } from "@/lib/format";
import { t } from "@/lib/i18n";
import { primarySize } from "@/lib/spec";
import {
  PAGE_SIZE,
  type BusinessResult,
  type FacetGroup,
  type ProductResult,
} from "@/lib/db/queries";
import { toSearchParams, withoutFacet, type SearchQuery } from "@/lib/search/query";

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
        href={`${basePath}?${toSearchParams({ ...query, tab: query.tab, q: query.q, spec: {}, availability: [], page: 1, emirate: undefined, area: undefined, tier: undefined, freeZone: false, replyWithinHours: undefined, yearsTrading: undefined })}`}
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
          href: `${basePath}?${toSearchParams({ ...query, tab: "businesses", page: 1 })}`,
        },
        {
          key: "products",
          label: t("results.products_tab"),
          badge: productTotal,
          href: `${basePath}?${toSearchParams({ ...query, tab: "products", page: 1 })}`,
        },
      ]}
    />
  );
}

export function ResultsList({
  query,
  basePath,
  businesses,
  products,
  specFields = [],
}: Pick<ResultsSurfaceProps, "query" | "basePath" | "businesses" | "products" | "specFields">) {
  if (query.tab === "products" && products) {
    return (
      <>
        {/* The page h1 names the category or the query; the cards are h3. This
            is the level between them, and it is the tab that is showing. */}
        <h2 className="sr-only">{t("results.products_tab")}</h2>
        <div className="grid gap-[var(--gutter)] sm:grid-cols-2 xl:grid-cols-3">
          {products.rows.map((product) => (
            <ProductCard
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
      <div className="flex flex-col gap-[var(--gutter)]">
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
                context={business.claimStatus === "unclaimed" ? "unclaimed" : "search"}
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
                }}
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
            href={`${basePath}?${toSearchParams({ ...query, page: query.page - 1 })}`}
            className="rounded-ctl border border-line bg-card px-3 py-1 text-caption text-body hover:border-line-strong focus-visible:outline-none focus-visible:shadow-focus"
          >
            {t("table.previous")}
          </a>
        )}
        {query.page < pages && (
          <a
            href={`${basePath}?${toSearchParams({ ...query, page: query.page + 1 })}`}
            className="rounded-ctl border border-line bg-card px-3 py-1 text-caption text-body hover:border-line-strong focus-visible:outline-none focus-visible:shadow-focus"
          >
            {t("table.next")}
          </a>
        )}
      </div>
    </nav>
  );
}
