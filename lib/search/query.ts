/**
 * The search query, parsed out of the URL and back into it.
 *
 * Tab state lives in the URL, not in component state: two tabs over one query
 * means a buyer can send someone the products tab of a search, and it means the
 * back button does what they expect.
 */
export type SearchTab = "businesses" | "products";

/**
 * How the result list is ordered.
 *
 * `best` is the ranked order — relevance, verification, response time, spec
 * completeness, distance and plan tier, weighted by the config the admin screen
 * edits. The other three are single-signal orders a buyer asks for explicitly,
 * and they are deliberately *not* the ranking with a thumb on one weight: a
 * buyer who picks "Fastest reply" means fastest reply, not "mostly relevance
 * but sorted a bit by speed".
 */
export type SearchSort = "best" | "rating" | "reply" | "newest";

const SORTS: readonly SearchSort[] = ["best", "rating", "reply", "newest"];

/** List or grid. The board draws the list; the grid is the denser view. */
export type SearchView = "list" | "grid";

export interface SearchQuery {
  q: string;
  tab: SearchTab;
  emirate?: string;
  area?: string;
  /** Minimum verification tier. Set explicitly by the buyer. */
  tier?: number;
  freeZone?: boolean;
  availability?: string[];
  /** Maximum median reply, in hours. */
  replyWithinHours?: number;
  /** Minimum years trading. */
  yearsTrading?: number;
  /** Spec facets, keyed by SpecField id. */
  spec: Record<string, string[]>;
  sort: SearchSort;
  view: SearchView;
  page: number;
  /**
   * The map viewport, when the buyer pressed "Search this area".
   *
   * In the URL rather than in client state because board 1c requires a pasted
   * link to reproduce the result set *and* the viewport. It is deliberately not
   * written by panning: the board is explicit that panning alone must not
   * re-rank the list, so this changes only on the button.
   */
  bounds?: MapBounds;
}

/** West, south, east, north — the order MapLibre's `toArray` produces. */
export interface MapBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

/**
 * `west,south,east,north`, to six decimal places.
 *
 * Four numbers in one parameter rather than four parameters: they are only ever
 * meaningful together, and a URL carrying three of them is a bug that should not
 * be representable.
 */
export function formatBounds(bounds: MapBounds): string {
  return [bounds.west, bounds.south, bounds.east, bounds.north]
    .map((n) => n.toFixed(6))
    .join(",");
}

export function parseBounds(raw: string | undefined): MapBounds | undefined {
  if (!raw) return undefined;
  const parts = raw.split(",").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return undefined;

  const [west, south, east, north] = parts as [number, number, number, number];
  // A degenerate or inverted box would select everything or nothing depending
  // on which side of the comparison it landed. Neither is what the buyer drew.
  if (west >= east || south >= north) return undefined;
  if (south < -90 || north > 90 || west < -180 || east > 180) return undefined;

  return { west, south, east, north };
}

const RESERVED = new Set([
  "q", "tab", "emirate", "area", "tier", "freeZone", "availability",
  "replyWithinHours", "yearsTrading", "page", "sort", "view", "bounds",
  // The comparison tray rides in the URL alongside the query. It is not a
  // facet and must never land in the spec bucket, or it becomes a filter on a
  // SpecField id that does not exist.
  "compare",
]);

function list(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return (Array.isArray(value) ? value : [value]).flatMap((v) => v.split(",")).filter(Boolean);
}

function one(value: string | string[] | undefined): string | undefined {
  const [first] = list(value);
  return first;
}

export function parseSearchQuery(
  params: Record<string, string | string[] | undefined>,
): SearchQuery {
  const tier = Number(one(params.tier));
  const hours = Number(one(params.replyWithinHours));
  const years = Number(one(params.yearsTrading));
  const page = Number(one(params.page));

  // Anything not reserved is a spec facet, keyed by SpecField id. The rail is
  // generated from the template, so the query string has to be open the same
  // way: adding a filterable field must not need a code change here either.
  const spec: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(params)) {
    if (RESERVED.has(key)) continue;
    const values = list(value);
    if (values.length > 0) spec[key] = values;
  }

  return {
    q: (one(params.q) ?? "").trim(),
    tab: one(params.tab) === "products" ? "products" : "businesses",
    emirate: one(params.emirate),
    area: one(params.area),
    tier: Number.isFinite(tier) && tier > 0 ? Math.min(4, tier) : undefined,
    freeZone: one(params.freeZone) === "1" || one(params.freeZone) === "true",
    availability: list(params.availability),
    replyWithinHours: Number.isFinite(hours) && hours > 0 ? hours : undefined,
    yearsTrading: Number.isFinite(years) && years > 0 ? years : undefined,
    spec,
    // Unknown values fall back rather than 404: a hand-edited URL should give
    // somebody the default list, not an error page.
    sort: SORTS.includes(one(params.sort) as SearchSort) ? (one(params.sort) as SearchSort) : "best",
    view: one(params.view) === "grid" ? "grid" : "list",
    page: Number.isFinite(page) && page > 1 ? page : 1,
    bounds: parseBounds(one(params.bounds)),
  };
}

/** Facets the buyer set, for the chip row and the drop-a-filter suggestion. */
export interface AppliedFacet {
  /** Query-string key. */
  key: string;
  /** Localised facet name, e.g. "Emirate". */
  facet: string;
  /** Localised value, e.g. "Dubai". */
  value: string;
}

export function toSearchParams(query: SearchQuery, overrides: Partial<SearchQuery> = {}): string {
  const merged = { ...query, ...overrides };
  const params = new URLSearchParams();

  if (merged.q) params.set("q", merged.q);
  if (merged.tab !== "businesses") params.set("tab", merged.tab);
  if (merged.emirate) params.set("emirate", merged.emirate);
  if (merged.area) params.set("area", merged.area);
  if (merged.tier) params.set("tier", String(merged.tier));
  if (merged.freeZone) params.set("freeZone", "1");
  if (merged.availability?.length) params.set("availability", merged.availability.join(","));
  if (merged.replyWithinHours) params.set("replyWithinHours", String(merged.replyWithinHours));
  if (merged.yearsTrading) params.set("yearsTrading", String(merged.yearsTrading));
  for (const [field, values] of Object.entries(merged.spec)) {
    if (values.length > 0) params.set(field, values.join(","));
  }
  // Defaults stay out of the URL: `?sort=best&view=list` on every link would
  // make the canonical of an unfiltered page differ from the page itself.
  if (merged.sort !== "best") params.set("sort", merged.sort);
  if (merged.view !== "list") params.set("view", merged.view);
  if (merged.page > 1) params.set("page", String(merged.page));
  if (merged.bounds) params.set("bounds", formatBounds(merged.bounds));

  return params.toString();
}

/** The same query with one facet removed. Drives "drop this filter". */
export function withoutFacet(query: SearchQuery, key: string): SearchQuery {
  const next: SearchQuery = { ...query, spec: { ...query.spec }, page: 1 };
  switch (key) {
    case "emirate": delete next.emirate; break;
    case "area": delete next.area; break;
    case "tier": delete next.tier; break;
    case "freeZone": next.freeZone = false; break;
    case "availability": next.availability = []; break;
    case "replyWithinHours": delete next.replyWithinHours; break;
    case "yearsTrading": delete next.yearsTrading; break;
    default: delete next.spec[key];
  }
  return next;
}

/** Every facet currently applied, as query-string keys. */
export function appliedKeys(query: SearchQuery): string[] {
  const keys: string[] = [];
  if (query.emirate) keys.push("emirate");
  if (query.area) keys.push("area");
  if (query.tier) keys.push("tier");
  if (query.freeZone) keys.push("freeZone");
  if (query.availability?.length) keys.push("availability");
  if (query.replyWithinHours) keys.push("replyWithinHours");
  if (query.yearsTrading) keys.push("yearsTrading");
  keys.push(...Object.keys(query.spec));
  return keys;
}
