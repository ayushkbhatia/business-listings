/**
 * The search query, parsed out of the URL and back into it.
 *
 * Tab state lives in the URL, not in component state: two tabs over one query
 * means a buyer can send someone the products tab of a search, and it means the
 * back button does what they expect.
 */
export type SearchTab = "businesses" | "products";

/**
 * The largest value Postgres will take in an int4 column.
 *
 * Only a guard: `verificationTier` is an int4, and an inbound `?tier=` that
 * exceeds it reaches Prisma and throws rather than returning the empty result
 * a filter nobody can satisfy should return. See the clamp in
 * `parseSearchQuery` for why this is the overflow bound and not a ladder rung.
 */
const INT4_MAX = 2_147_483_647;

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

/**
 * The four tabs of board `1c-s`'s blended result set. `all` is the default and
 * is only ever written explicitly by a saved search — see `kind` below.
 */
export type BlendedTab = "all" | "services" | "businesses" | "products";

export const BLENDED_TABS = ["all", "services", "businesses", "products"] as const satisfies readonly BlendedTab[];

/**
 * The service-track facets — board `1c-s`'s rail, keyed by query-string name.
 *
 * Five of the six are rows of the scope sheet a family marks filterable
 * (`ScopeSheetRow.filterable`, the single source `1g-s` B5 names). The sixth,
 * `credential`, is not a scope row: it is the register-checked credential a
 * firm holds, which `1c-s` B7 puts in the rail in place of the self-declared
 * regulator row.
 */
export const SERVICE_FACET_KEYS = [
  "engagement",
  "turnaround",
  "fee",
  "delivered",
  "credential",
  "sector",
] as const;
export type ServiceFacetKey = (typeof SERVICE_FACET_KEYS)[number];
export type ServiceFacets = Record<ServiceFacetKey, string[]>;

export function emptyServiceFacets(): ServiceFacets {
  return { engagement: [], turnaround: [], fee: [], delivered: [], credential: [], sector: [] };
}

/** The facets on a query, whether or not the caller built it with any. */
export function serviceFacetsOf(query: Pick<SearchQuery, "services">): ServiceFacets {
  return { ...emptyServiceFacets(), ...(query.services ?? {}) };
}

export function hasServiceFacets(query: Pick<SearchQuery, "services">): boolean {
  const facets = serviceFacetsOf(query);
  return SERVICE_FACET_KEYS.some((key) => facets[key].length > 0);
}

export interface SearchQuery {
  q: string;
  tab: SearchTab;
  /**
   * Board `1c-s` — which kind the blended result set is narrowed to.
   *
   * Absent means *All*. It narrows one result set after the query has run and
   * never takes part in the query itself (B3), which is why it is its own key
   * rather than a value of `tab`: `tab` chooses what the goods page counts, and
   * this chooses nothing about what is counted.
   */
  kind?: BlendedTab;
  /** Board `1c-s`'s service facets. Absent on every goods caller. */
  services?: ServiceFacets;
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
  "kind",
  ...SERVICE_FACET_KEYS,
]);

/**
 * The most values one service facet carries. A rail offers a handful; a URL
 * with fifty is somebody generating URLs, and every value is re-emitted into
 * every anchor on the page — the reflector `SPEC_KEY` below exists to close.
 */
const FACET_VALUES_MAX = 10;

/** A fee-basis key as `ScopeSheetFeeBasis.key` stores them. */
const FEE_KEY = /^[a-z][a-z0-9_]{0,39}$/;

/**
 * A free-text facet value — a turnaround or a sector — in its matching form.
 *
 * Case-folded and collapsed, the same form `sectorSlug` keys declared sectors
 * by, so *Free zone entities* and *free zone  entities* are one option. Commas
 * are the list separator in the URL, so the form replaces them; anything that
 * does not survive its own normalisation unchanged is not a value this page
 * wrote, and is dropped rather than echoed into every link.
 */
export function facetText(value: string): string {
  return value.replace(/,/g, " ").trim().replace(/\s+/g, " ").toLowerCase().slice(0, 60).trim();
}

const ENGAGEMENT_VALUES: ReadonlySet<string> = new Set(["ongoing_contract", "one_off_job", "call_off"]);
const DELIVERED_VALUES: ReadonlySet<string> = new Set(["remote", "at_our_office", "on_site"]);
const CREDENTIAL_VALUES: ReadonlySet<string> = new Set([
  "fta_tax_agent",
  "mof_audit_approval",
  "professional_body",
  "indemnity_insurance",
  "other",
]);

function facetValues(key: ServiceFacetKey, raw: string | string[] | undefined): string[] {
  /*
     Split on commas for the closed vocabularies, and not for the free-text
     ones: a sector is one value per parameter because `facetText` has already
     taken its commas out, and a hand-edited `sector=a,b` is two sectors either
     way.
  */
  const values = list(raw);
  const valid = values.filter((value) => {
    switch (key) {
      case "engagement":
        return ENGAGEMENT_VALUES.has(value);
      case "delivered":
        return DELIVERED_VALUES.has(value);
      case "credential":
        return CREDENTIAL_VALUES.has(value);
      case "fee":
        return FEE_KEY.test(value);
      case "turnaround":
      case "sector":
        return value.length > 0 && facetText(value) === value;
    }
  });
  return [...new Set(valid)].slice(0, FACET_VALUES_MAX);
}

/**
 * The shape of a spec facet's query key: a `SpecField` id, which is a cuid.
 *
 * ## Why this guard exists
 *
 * The spec bucket is open on purpose — a filterable field is added to a
 * template, not to this file — and until 2026-09-04 "open" meant *anything not
 * reserved*. That made the page a reflector: an unknown parameter was absorbed
 * as a facet and then re-emitted by `toSearchParams` into every one of the
 * ~165 anchors the filter rail renders. So a single junk parameter did not
 * decorate one URL, it forked the entire crawlable space beneath it, and the
 * space was bounded by what a caller could invent rather than by our data.
 *
 * It was not hypothetical. 27 of the 797 URLs an AI crawler walked that night
 * carried `nxtPcategory=` — Next's own internal route-parameter prefix, which
 * we picked up off the request and dutifully linked back. Any `utm_source`,
 * `gclid` or `fbclid` on an inbound campaign link did the same thing, which
 * means our own marketing links were spawning parallel URL universes.
 *
 * A `SpecField.id` is `@default(cuid())`, and `getSpecFacets` keys every group
 * by exactly that id. So the bucket stays open to every field the template
 * grows and closed to everything else. The bound is loose on length rather than
 * pinned at 25 so a future cuid revision does not silently empty every rail.
 */
const SPEC_KEY = /^c[a-z0-9]{20,30}$/;

function list(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return (Array.isArray(value) ? value : [value]).flatMap((v) => v.split(",")).filter(Boolean);
}

function one(value: string | string[] | undefined): string | undefined {
  const [first] = list(value);
  return first;
}

/**
 * The first value, whole — no comma splitting.
 *
 * `one` goes through `list`, which splits on commas because that is how a
 * multi-value facet travels. A compound value has to be read past it:
 * `bounds=56.1,25.9,56.2,26.0` through `one` yields `"56.1"`, and
 * `parseBounds` then rejects it as a box with one number in it. Silently — the
 * viewport simply stopped being applied.
 */
function whole(value: string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  const first = Array.isArray(value) ? value[0] : value;
  return first === "" ? undefined : first;
}

export function parseSearchQuery(
  params: Record<string, string | string[] | undefined>,
): SearchQuery {
  const tier = Number(one(params.tier));
  const hours = Number(one(params.replyWithinHours));
  const years = Number(one(params.yearsTrading));
  const page = Number(one(params.page));

  // Anything not reserved and shaped like a SpecField id is a spec facet. The
  // rail is generated from the template, so the query string has to be open the
  // same way: adding a filterable field must not need a code change here
  // either. What it must NOT be open to is a key nobody defined — see SPEC_KEY.
  const spec: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(params)) {
    if (RESERVED.has(key) || !SPEC_KEY.test(key)) continue;
    const values = list(value);
    if (values.length > 0) spec[key] = values;
  }

  return {
    q: (one(params.q) ?? "").trim(),
    tab: one(params.tab) === "products" ? "products" : "businesses",
    emirate: one(params.emirate),
    area: one(params.area),
    /*
       Clamped for int4 safety, and deliberately NOT to any rung of the ladder.

       The clamp is a guard rather than a policy: `verificationTier` is an int4
       and `Number("9999999999")` is finite and positive, so an unclamped value
       reaches Prisma and throws where a filter nobody can satisfy should simply
       return nothing. Dropping the filter instead — parsing to `undefined` —
       would be worse than either: the buyer asked to narrow and would be shown
       the whole unfiltered shelf.

       Clamping to `TOP_ACHIEVABLE_TIER` was the alternative and it is the
       dishonest one. An old bookmark carrying `?tier=3` would silently become
       tier 2, and because `toSearchParams` re-emits whatever this returns into
       every anchor and the applied-filter chip, the page would state a filter
       the buyer never set over results that do not match the one they did.
       Parsed as it says, the URL yields an honest empty state — which is a
       designed state here, not a failure.

       That reasoning is why this is `INT4_MAX` and not a tier. The ceiling has
       been written as a ladder rung twice and drifted both times: a literal `4`
       outlived the rung site visits took away, and a `MAX_STORED_TIER` of 3 was
       true for one commit before trade references were cut and the CHECK
       narrowed to 0..2. A guard that names the overflow it guards against has
       nothing to drift from — the ladder can shorten again without reaching
       into this line.

       Nothing in SEO turns on the value. `isFiltered` reads every key, so any
       `?tier=` is `noindex, follow` and canonicalises to the unfiltered shelf;
       `CRAWLABLE_QUERY_KEYS` holds only `page`, so the anchor is `nofollow`
       either way. The facet trap was opened by combining keys, never by their
       values, and this changes no key.
    */
    tier: Number.isFinite(tier) && tier > 0 ? Math.min(INT4_MAX, tier) : undefined,
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
    bounds: parseBounds(whole(params.bounds)),
    ...blendedParts(params),
  };
}

/**
 * The two board `1c-s` parts of a query, only where the URL carries them — so a
 * goods query parses to exactly the object it did before this board.
 */
function blendedParts(
  params: Record<string, string | string[] | undefined>,
): Pick<SearchQuery, "kind" | "services"> {
  const out: Pick<SearchQuery, "kind" | "services"> = {};
  const kind = one(params.kind);
  if (kind && (BLENDED_TABS as readonly string[]).includes(kind)) out.kind = kind as BlendedTab;

  const services = emptyServiceFacets();
  let any = false;
  for (const key of SERVICE_FACET_KEYS) {
    services[key] = facetValues(key, params[key]);
    if (services[key].length > 0) any = true;
  }
  if (any) out.services = services;
  return out;
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
  if (merged.kind) params.set("kind", merged.kind);
  if (merged.services) {
    for (const key of SERVICE_FACET_KEYS) {
      const values = merged.services[key] ?? [];
      if (values.length > 0) params.set(key, values.join(","));
    }
  }

  return params.toString();
}

/**
 * The query string that tray links carry, rebuilt from the parsed query.
 *
 * The three results routes each used to build this by re-serialising the raw
 * `searchParams` they were handed, which put the reflector back on the page one
 * layer below `parseSearchQuery`: a junk key survived into every "add to
 * comparison" href even after the facet bucket had learned to drop it. Rebuild
 * from the parsed query instead, and a parameter nobody defined has nowhere
 * left to hide.
 *
 * `compare` is carried through explicitly because it is the one reserved key
 * that is not part of `SearchQuery` — it is tray state, not a filter, and
 * `toSearchParams` has no business knowing about it.
 */
export function trayParams(query: SearchQuery, tray: readonly string[]): string {
  const params = toSearchParams(query);
  if (tray.length === 0) return params;
  const compare = `compare=${encodeURIComponent(tray.join(","))}`;
  return params ? `${params}&${compare}` : compare;
}

/**
 * `basePath` with `query` on it, and no bare `?` when there is nothing to put
 * there.
 *
 * `${basePath}?${toSearchParams(query)}` renders `/c/valves-and-fittings?` for
 * an unfiltered view, which addresses the same page under a second URL. Harmless
 * to a browser and not harmless in a crawl graph: it is a duplicate a crawler
 * has to fetch to discover is a duplicate, and the tabs emitted it as the
 * `aria-current` self-link on every clean shelf on the site.
 */
export function pathWithQuery(basePath: string, query: SearchQuery, overrides: Partial<SearchQuery> = {}): string {
  const params = toSearchParams(query, overrides);
  return params ? `${basePath}?${params}` : basePath;
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
    /*
       The map viewport. Without this it fell to the spec branch below, which
       deleted `spec["bounds"]` — a key that does not exist — and returned a
       query identical to the one it was given. So the "Map area" chip rendered
       a remove link pointing at the page it was already on: a control that
       looks like every other chip and cannot be dismissed.

       `bounds` is written only by "Search this area", so clearing it returns
       the buyer to the unbounded search, which is what the chip promises.
    */
    case "bounds": delete next.bounds; break;
    /*
       Board `1c-s`. Removing a service facet empties that one group; the tab the
       buyer is on stays, because a tab is not a filter.
    */
    case "engagement":
    case "turnaround":
    case "fee":
    case "delivered":
    case "credential":
    case "sector":
      next.services = { ...serviceFacetsOf(query), [key]: [] };
      break;
    default: delete next.spec[key];
  }
  return next;
}

/**
 * The query with everything that cannot change a count stripped out.
 *
 * `unstable_cache` builds its key from the arguments it is handed, so passing a
 * whole `SearchQuery` would fragment the cache by `page`, `sort` and `view` —
 * three fields that cannot move a single one of these numbers. Normalising them
 * away means page four of a shelf sorted by rating shares its facet counts with
 * page one sorted by relevance, which on a paginated shelf is most of the
 * benefit.
 *
 * `spec` stays. `businessWhere` ignores it, but `productWhere` does not, and the
 * products tab counts products.
 */
export function countable(query: SearchQuery): SearchQuery {
  return { ...query, page: 1, sort: "best", view: "list" };
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
  const facets = serviceFacetsOf(query);
  keys.push(...SERVICE_FACET_KEYS.filter((key) => facets[key].length > 0));
  return keys;
}
