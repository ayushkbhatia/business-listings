/**
 * Board `1e-s` — the rules of a firm's public services list.
 *
 * Pure, so every rule is a unit test and the gallery renders each state from
 * plain objects. `app/(public)/b/[slug]/services/page.tsx` fetches; this
 * decides what is shown, in what order, and what the filters say.
 */

/**
 * How far back a service's enquiry volume looks — B5.
 *
 * Ninety days, and the page says *in the last 90 days* rather than the render's
 * *this quarter*: a calendar quarter resets to zero on the first of the month
 * and would tell a buyer on 2 April that the firm's busiest service had two
 * enquiries. A trailing window says the same thing on every day.
 */
export const ENQUIRY_VOLUME_DAYS = 90;

/* ── The query ───────────────────────────────────────────────────────────── */

export interface ServicesCatalogueQuery {
  /** Engagement types, OR within the group. */
  engagement: string[];
  /** Fee-basis keys, OR within the group. */
  fee: string[];
  page: number;
}

/**
 * Thirty to a page — Q4.
 *
 * The board leaves the number unset: *thirty services is one screen of long
 * cards; fifty is not.* Thirty is that screen. Pro's service cap is unlimited,
 * so a firm will get there, and a page that renders every card at once for
 * that firm is a page nobody scrolls to the end of.
 */
export const SERVICES_PAGE_SIZE = 30;

/**
 * Where "these filters do almost nothing" stops being true — B6.
 *
 * The note renders on every firm, as the board asks. But its first wording is
 * a claim about this firm's list, and at thirty services it would be false: a
 * filter that narrows thirty rows to four is doing something. So the note keeps
 * its place and its honesty, and changes what it says past this many.
 */
export const FILTERS_EARN_THEIR_PLACE = 8;

type Raw = Record<string, string | string[] | undefined>;

function many(raw: Raw, key: string): string[] {
  const value = raw[key];
  const list = Array.isArray(value) ? value : value === undefined ? [] : [value];
  return [...new Set(list.flatMap((entry) => entry.split(",")).map((entry) => entry.trim()).filter(Boolean))];
}

/** From the URL. Unknown values are kept and simply match nothing. */
export function parseServicesQuery(raw: Raw): ServicesCatalogueQuery {
  const page = Number(Array.isArray(raw.page) ? raw.page[0] : raw.page);
  return {
    engagement: many(raw, "engagement"),
    fee: many(raw, "fee"),
    page: Number.isInteger(page) && page > 1 ? page : 1,
  };
}

/** Whether any filter is applied. A filtered view is not a page worth indexing. */
export function isServicesFiltered(query: ServicesCatalogueQuery): boolean {
  return query.engagement.length > 0 || query.fee.length > 0;
}

/**
 * Back to a query string, filters first and `page` last and alone — the shape
 * `lib/seo/crawl-policy.ts` keeps crawlable only when nothing else is set.
 */
export function servicesQueryString(
  query: ServicesCatalogueQuery,
  over: Partial<ServicesCatalogueQuery> = {},
): string {
  const next = { ...query, ...over };
  const params = new URLSearchParams();
  if (next.engagement.length > 0) params.set("engagement", [...next.engagement].sort().join(","));
  if (next.fee.length > 0) params.set("fee", [...next.fee].sort().join(","));
  if (next.page > 1) params.set("page", String(next.page));
  return params.toString();
}

/* ── The rows ────────────────────────────────────────────────────────────── */

export interface CatalogueService {
  id: string;
  /** The seller's manual order from `3f-s` B5 — the tiebreak. */
  position: number;
  engagementType: string | null;
  feeBasis: string | null;
  feeBasisLabel: string | null;
}

/**
 * Enquiry volume first, the seller's own order second — B5 and Q3.
 *
 * The board sorts by what the firm takes on most, and `3f-s` B5 promised the
 * seller that their drag order drives the page. Both hold here: volume decides
 * wherever it differs, and the manual order decides wherever it does not —
 * including the whole list on a firm with no enquiry history, which is every
 * firm the day this ships. The storefront overview keeps the seller's order
 * outright; that is where they lead with their best work.
 */
export function sortByVolume<T extends CatalogueService>(
  services: readonly T[],
  volume: ReadonlyMap<string, number>,
): T[] {
  return [...services].sort(
    (a, b) => (volume.get(b.id) ?? 0) - (volume.get(a.id) ?? 0) || a.position - b.position,
  );
}

/** Whether volume actually decided anything, which is what the sort line may claim. */
export function sortedByVolume(
  services: readonly CatalogueService[],
  volume: ReadonlyMap<string, number>,
): boolean {
  return services.some((service) => (volume.get(service.id) ?? 0) > 0);
}

/**
 * The one service awarded `MOST ENQUIRED`, or null — B5.
 *
 * Only a clear leader earns it. With one service there is nothing to lead; at a
 * tie at the top two services are equally most enquired and a badge on one of
 * them would be the sort order dressed up as a fact; and at zero there is no
 * volume to speak of. The same figure decides the sort, so the badge cannot sit
 * on anything but the first card.
 */
export function mostEnquired(
  services: readonly CatalogueService[],
  volume: ReadonlyMap<string, number>,
): { id: string; enquiries: number } | null {
  if (services.length < 2) return null;
  const counts = services
    .map((service) => ({ id: service.id, enquiries: volume.get(service.id) ?? 0 }))
    .sort((a, b) => b.enquiries - a.enquiries);
  const [first, second] = counts;
  if (!first || first.enquiries === 0) return null;
  if (second && second.enquiries === first.enquiries) return null;
  return first;
}

/** Filters applied: AND across groups, OR within one. */
export function applyServicesFilters<T extends CatalogueService>(
  services: readonly T[],
  query: ServicesCatalogueQuery,
): T[] {
  return services.filter(
    (service) =>
      (query.engagement.length === 0 ||
        (service.engagementType !== null && query.engagement.includes(service.engagementType))) &&
      (query.fee.length === 0 || (service.feeBasis !== null && query.fee.includes(service.feeBasis))),
  );
}

/* ── The facets ──────────────────────────────────────────────────────────── */

export interface FacetOption {
  value: string;
  /** The fee basis's own label; engagement types are worded by the screen. */
  label: string | null;
  count: number;
  selected: boolean;
}

/**
 * The two groups, counted over every live service rather than the filtered set.
 *
 * Counting over the whole list means an option's number does not move when a
 * neighbour in the same group is ticked — the count says how many of the firm's
 * services are sold that way, which is the thing a buyer is deciding on. Only
 * values the firm actually uses appear: an option that matches nothing is a
 * door into an empty room.
 *
 * With D11 closed, there are two groups and not three. There is no *taking
 * work* group, and nothing on this list can say a firm is at capacity.
 */
export function servicesFacets(
  services: readonly CatalogueService[],
  query: ServicesCatalogueQuery,
): { engagement: FacetOption[]; fee: FacetOption[] } {
  const engagement = new Map<string, number>();
  const fee = new Map<string, { label: string | null; count: number }>();

  for (const service of services) {
    if (service.engagementType) {
      engagement.set(service.engagementType, (engagement.get(service.engagementType) ?? 0) + 1);
    }
    if (service.feeBasis) {
      const held = fee.get(service.feeBasis);
      fee.set(service.feeBasis, {
        label: held?.label ?? service.feeBasisLabel,
        count: (held?.count ?? 0) + 1,
      });
    }
  }

  return {
    engagement: [...engagement].map(([value, count]) => ({
      value,
      label: null,
      count,
      selected: query.engagement.includes(value),
    })),
    fee: [...fee].map(([value, held]) => ({
      value,
      label: held.label,
      count: held.count,
      selected: query.fee.includes(value),
    })),
  };
}

/**
 * Whether the filter groups render at all — the board's *one service* state.
 *
 * One service is one option per group, which is not a choice. The note still
 * renders (B6); the groups do not.
 */
export function showsFilterGroups(total: number): boolean {
  return total > 1;
}

/** Which of the note's two wordings is true of this firm. */
export function filterNoteKind(total: number): "few" | "many" {
  return total <= FILTERS_EARN_THEIR_PLACE ? "few" : "many";
}

/* ── The page ────────────────────────────────────────────────────────────── */

export function paginate<T>(
  rows: readonly T[],
  page: number,
  size: number = SERVICES_PAGE_SIZE,
): { rows: T[]; page: number; pages: number } {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const current = Math.min(Math.max(1, page), pages);
  return { rows: rows.slice((current - 1) * size, current * size), page: current, pages };
}
