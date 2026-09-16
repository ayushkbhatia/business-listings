import { VERIFIED_TIER } from "@/lib/verification";
import {
  SERVICE_FACET_KEYS,
  emptyServiceFacets,
  facetText,
  hasProductFacets,
  hasServiceFacets,
  tabInEffect,
  type BlendedTab,
  type SearchQuery,
  type ServiceFacetKey,
  type ServiceFacets,
} from "./query";

/**
 * Boards `1c-s`, `10c` and `10c-s` — one query, one result set, three kinds of
 * thing in it.
 *
 * Pure, with no database import, because every number on the page is decided
 * here and the boards' whole argument is that those numbers agree: the header,
 * the four tabs, every facet count and the rows are one set. So there is one
 * predicate — `matches` — and every count is that predicate run over the same
 * documents with one facet group changed. A count computed any other way is a
 * second definition of the query, which is the defect `1c-s` shipped with
 * (`All 147` over a filter that left 61).
 *
 * ## What `10c` + `10c-s` changed here
 *
 * **D1 — the tab row filters one list; it does not partition the index.** That
 * was already true of the four tabs. What was not true is that the *rail* was
 * services-only: place, tier and stock were applied in the database `where`,
 * so their counts could not be counted within the results and a product facet
 * had nowhere to live. The whole filter set now runs through `matches`, in
 * three declared scopes:
 *
 * | Scope | Facets | Answered by |
 * |---|---|---|
 * | `shared` | emirate, licence verified, free zone | every document |
 * | `products` | availability, spec fields | a product, or a firm holding one |
 * | `services` | the six scope-sheet facets | a service, or a firm offering one |
 *
 * **A kind-specific facet switches the tab rather than returning nothing**
 * (`B3`) — `tabInEffect`, in `query.ts`, so the rule holds for a pasted URL as
 * well as for a link this page drew.
 *
 * ## The document
 *
 * The handoff sketches a `SearchDocument` table with the facets travelling on
 * the row. The facets do travel on the document — that is what makes a facet
 * count a count over the current results rather than a join per option — but
 * the document is built per request from the rows that matched the words, not
 * stored. A stored index would need a writer on every scope-sheet save,
 * credential decision, coverage edit, publish, suspension and licence sweep,
 * and a stale row there is a count that is not the query. At 122 listings and
 * no live service in production, building it costs less than keeping it.
 */

export type ResultKind = "service" | "supplier" | "product";

export const RESULT_KINDS = ["service", "supplier", "product"] as const satisfies readonly ResultKind[];

/** Which tab shows which kind. */
export const TAB_KIND: Record<Exclude<BlendedTab, "all">, ResultKind> = {
  services: "service",
  suppliers: "supplier",
  products: "product",
};

/** The scope-sheet row each service-level facet reads. `credential` reads none. */
export const FACET_ROW: Record<Exclude<ServiceFacetKey, "credential">, string> = {
  engagement: "engagement_type",
  turnaround: "turnaround",
  fee: "fee_basis",
  delivered: "delivered_where",
  sector: "sectors",
};

/** The service-level facets — the ones a product can never answer. */
export const SERVICE_LEVEL_KEYS = ["engagement", "turnaround", "fee", "delivered", "sector"] as const;
type ServiceLevelKey = (typeof SERVICE_LEVEL_KEYS)[number];

/**
 * One service's answers, as far as the rail is concerned.
 *
 * `filterable` is the set of scope rows this service's family marks
 * filterable. A value on a row the family does not offer as a filter is not a
 * facet value — it is not offered, not counted, and a buyer filtering on that
 * row is not answered by it.
 */
export interface ServiceFacetValues {
  engagement: string | null;
  /** In `facetText` form. */
  turnaround: string | null;
  fee: string | null;
  delivered: string | null;
  /** In `facetText` form, one entry per sector. */
  sectors: readonly string[];
  filterable: ReadonlySet<string>;
}

/**
 * One product's answers — `10c`'s half of the rail.
 *
 * `spec` is keyed by `SpecField.id`, exactly as `Product.specValues` stores it
 * and as `SPEC_KEY` in `query.ts` bounds the query string, so a filterable
 * field added to a template needs no code change here either.
 */
export interface ProductFacetValues {
  availability: string;
  spec: Readonly<Record<string, readonly string[]>>;
  /** The trade it is filed under — which template's fields the rail may offer. */
  categoryId: string;
}

/**
 * Where a document is, for the shared scope.
 *
 * Three lists rather than one, because *reaching a place* has two shapes and
 * conflating them is how a branch in Al Quoz answers a search for Business Bay:
 *
 *   · `emirates` — every emirate this document reaches at all. Answers
 *     `?emirate=`, whether the reach is a branch or a coverage row.
 *   · `areaIds` — the specific areas it names. Answers `?area=` exactly.
 *   · `wideEmirates` — emirates covered *whole*, with no area named. Answers
 *     `?area=` for every area inside them, which is what an emirate-wide
 *     coverage row means and what a branch address never does.
 *
 * The same reading `coverageWhere` has in the database, moved to the document
 * so the rail can count it.
 */
export interface PlaceValues {
  emirates: readonly string[];
  areaIds: readonly string[];
  wideEmirates: readonly string[];
}

export interface SearchDoc {
  /** `service:<id>`, `supplier:<id>`, `product:<id>`. */
  id: string;
  kind: ResultKind;
  /** The row's own id. */
  rowId: string;
  businessId: string;
  /** Where the firm behind this document is, read the way its kind reads a place. */
  place: PlaceValues;
  /** The same three lists, narrowed to its free-zone addresses and registrations. */
  freeZone: PlaceValues;
  verificationTier: number;
  /** Measured median. Null when unmeasured — which no reply-time filter passes. */
  responseTimeMedianMs: number | null;
  establishedYear: number | null;
  /**
   * The services a service-level facet asks about.
   *
   * A service document carries itself. A supplier carries the services it
   * matched through — or every live service where it matched on its own name —
   * and **one of them has to answer every service facet at once**, the same
   * rule `businessWhere` holds spec facets to: a firm with a fixed-fee remote
   * service and an hourly on-site one does not offer a fixed-fee on-site
   * service. A product carries none, so a service facet leaves it out.
   */
  services: readonly ServiceFacetValues[];
  /**
   * The products a product-level facet asks about — the same rule, the other
   * kind. A product document carries itself; a supplier carries the products
   * the words found; a service carries none.
   */
  products: readonly ProductFacetValues[];
  /** The register-checked credential kinds the firm holds — `1c-s` B7. */
  credentials: readonly string[];
}

/* ── The filter set ──────────────────────────────────────────────────────── */

/**
 * Every filter the blended page applies, in one value.
 *
 * Built from the query by `filtersOf`, with the one thing a URL cannot state
 * resolved by the caller: `?area=` is a slug and a document holds ids, so the
 * loader looks the area up once and passes the pair. An area filter naming a
 * slug that does not exist resolves to `null` and narrows to nothing, which is
 * what a filter nobody can satisfy should do.
 */
export interface BlendedFilters {
  emirate: string | null;
  area: { id: string; emirate: string } | null;
  /** True when `?area=` named a slug that resolved to no row. */
  areaUnknown: boolean;
  tier: number | null;
  freeZone: boolean;
  replyWithinHours: number | null;
  yearsTrading: number | null;
  availability: readonly string[];
  spec: Readonly<Record<string, readonly string[]>>;
  services: ServiceFacets;
}

export function emptyFilters(): BlendedFilters {
  return {
    emirate: null,
    area: null,
    areaUnknown: false,
    tier: null,
    freeZone: false,
    replyWithinHours: null,
    yearsTrading: null,
    availability: [],
    spec: {},
    services: emptyServiceFacets(),
  };
}

/** The filters a query carries, with the area already resolved by the loader. */
export function filtersOf(
  query: SearchQuery,
  area: { id: string; emirate: string } | null,
): BlendedFilters {
  return {
    emirate: query.emirate ?? null,
    area,
    areaUnknown: Boolean(query.area) && area === null,
    tier: query.tier ?? null,
    freeZone: query.freeZone ?? false,
    replyWithinHours: query.replyWithinHours ?? null,
    yearsTrading: query.yearsTrading ?? null,
    availability: query.availability ?? [],
    spec: Object.fromEntries(
      Object.entries(query.spec ?? {}).filter(([, values]) => values.length > 0),
    ),
    services: { ...emptyServiceFacets(), ...(query.services ?? {}) },
  };
}

/* ── The predicate ───────────────────────────────────────────────────────── */

function valueOf(service: ServiceFacetValues, key: ServiceLevelKey): readonly string[] {
  if (key === "sector") return service.sectors;
  const value = service[key];
  return value === null ? [] : [value];
}

function answers(service: ServiceFacetValues, key: ServiceLevelKey, selected: readonly string[]): boolean {
  if (selected.length === 0) return true;
  if (!service.filterable.has(FACET_ROW[key])) return false;
  return valueOf(service, key).some((value) => selected.includes(value));
}

/** Whether a place reaches the emirate a query named. */
function inEmirate(place: PlaceValues, emirate: string): boolean {
  return place.emirates.includes(emirate);
}

/** Whether a place reaches the area a query named — its own row, or the emirate whole. */
function inArea(place: PlaceValues, area: { id: string; emirate: string }): boolean {
  return place.areaIds.includes(area.id) || place.wideEmirates.includes(area.emirate);
}

/** The shared scope — the three questions every kind of document can answer. */
function matchesShared(doc: SearchDoc, filters: BlendedFilters): boolean {
  if (filters.areaUnknown) return false;
  if (filters.emirate && !inEmirate(doc.place, filters.emirate)) return false;
  if (filters.area && !inArea(doc.place, filters.area)) return false;
  if (filters.tier !== null && doc.verificationTier < filters.tier) return false;
  if (filters.replyWithinHours !== null) {
    if (doc.responseTimeMedianMs === null) return false;
    if (doc.responseTimeMedianMs > filters.replyWithinHours * 3_600_000) return false;
  }
  if (filters.yearsTrading !== null) {
    if (doc.establishedYear === null) return false;
    if (doc.establishedYear > new Date().getFullYear() - filters.yearsTrading) return false;
  }
  /*
     A free zone narrows whatever place is already set rather than replacing it,
     the way `placeWhere` reads it: *a free-zone address in Dubai*, not *a free
     zone anywhere plus a branch in Dubai*.
  */
  if (filters.freeZone) {
    if (filters.area) return inArea(doc.freeZone, filters.area);
    if (filters.emirate) return inEmirate(doc.freeZone, filters.emirate);
    return doc.freeZone.emirates.length > 0 || doc.freeZone.areaIds.length > 0;
  }
  return true;
}

/** One product answering every product-level facet at once. */
function productAnswers(product: ProductFacetValues, filters: BlendedFilters): boolean {
  if (filters.availability.length > 0 && !filters.availability.includes(product.availability)) return false;
  for (const [fieldId, values] of Object.entries(filters.spec)) {
    if (values.length === 0) continue;
    const held = product.spec[fieldId] ?? [];
    if (!held.some((value) => values.includes(value))) return false;
  }
  return true;
}

/**
 * Whether one document is in the result set the filters describe.
 *
 * Within a group the options are alternatives — *fixed fee or per return* —
 * because a service has one fee basis and a buyer ticking two is widening.
 * Credentials are the exception and are all required: a firm holds several at
 * once, and the board's counts read *FTA registered tax agent 61, MoE listed
 * auditor 18* — eighteen that hold both, not eighteen more.
 *
 * ## A facet narrows the kinds that can answer it, and leaves the rest alone
 *
 * This is `B3` carried all the way through, and it is the rule the rail's three
 * scopes are named for. *In stock* is a question about a product: it narrows
 * products, and firms to those holding one, and it says **nothing whatever**
 * about a service. Excluding services from it instead would empty the Services
 * tab the moment a buyer ticked a stock filter — and then *a legal facet never
 * returns nothing* would be false in the one place the rule was written for.
 *
 * A credential is the exception that proves it: it is a property of the firm
 * rather than of the work, so every kind answers it.
 *
 * Together with `tabInEffect` this gives the behaviour the board draws: tick
 * *In stock* on Everything and the page moves you to Products with the tick
 * kept, while the Services badge beside it still reads what it read before,
 * because nothing about those services has changed.
 */
export function matches(doc: SearchDoc, filters: BlendedFilters): boolean {
  if (!matchesShared(doc, filters)) return false;
  if (!filters.services.credential.every((kind) => doc.credentials.includes(kind))) return false;

  const productActive =
    filters.availability.length > 0 || Object.values(filters.spec).some((values) => values.length > 0);
  if (productActive && doc.kind !== "service") {
    if (!doc.products.some((product) => productAnswers(product, filters))) return false;
  }

  const active = SERVICE_LEVEL_KEYS.filter((key) => filters.services[key].length > 0);
  if (active.length > 0 && doc.kind !== "product") {
    if (!doc.services.some((service) => active.every((key) => answers(service, key, filters.services[key])))) {
      return false;
    }
  }
  return true;
}

export function applyFilters(docs: readonly SearchDoc[], filters: BlendedFilters): SearchDoc[] {
  return docs.filter((doc) => matches(doc, filters));
}

/* ── Tabs ────────────────────────────────────────────────────────────────── */

export interface TabCounts {
  all: number;
  products: number;
  services: number;
  suppliers: number;
}

/**
 * The firms a supplier document stands for — one per distinct business, which
 * is what `B2` means by *a distinct count of businesses, never the sum*.
 *
 * 44 product suppliers plus 71 service suppliers is 115 gross against 96
 * distinct, because 19 firms returned both a product and a service. Summing the
 * two kind counts produces a number that can exceed the directory's own
 * claimed-listing count on a broad query.
 */
function supplierDocs<T extends { kind: ResultKind }>(docs: readonly T[]): T[] {
  return docs.filter((doc) => doc.kind === "supplier");
}

/** The businesses already represented in the set by something they listed. */
function representedFirms(docs: readonly SearchDoc[]): Set<string> {
  const firms = new Set<string>();
  for (const doc of docs) if (doc.kind !== "supplier") firms.add(doc.businessId);
  return firms;
}

/**
 * `B1`/`B2` — the header and the four tabs, from the one filtered set.
 *
 * **Everything is the things, not the things plus their sellers.** A supplier
 * has a row in Everything only where nothing it lists is already there: a firm
 * found by its own name with no matching product or service would otherwise be
 * invisible on the query it should win, and a firm behind three matched
 * products does not need a fourth row saying so. `148 + 164 = 312` holds for
 * every query where the words found a firm through something it listed, and
 * where they did not, the extra rows are the reason the buyer is not staring at
 * a zero.
 */
export function tabCounts(docs: readonly SearchDoc[]): TabCounts {
  const represented = representedFirms(docs);
  let products = 0;
  let services = 0;
  let orphans = 0;
  const firms = new Set<string>();
  for (const doc of docs) {
    firms.add(doc.businessId);
    if (doc.kind === "service") services += 1;
    else if (doc.kind === "product") products += 1;
    else if (!represented.has(doc.businessId)) orphans += 1;
  }
  return { all: products + services + orphans, products, services, suppliers: firms.size };
}

/**
 * The line under the header — *148 products from 44 suppliers · 164 services
 * from 71 suppliers*.
 *
 * It is `B2` said out loud. A buyer reading `Products 148 · Services 164 ·
 * Suppliers 96` has every reason to try adding the first two firm counts, and
 * this is the sentence that shows why 44 + 71 is not 96: nineteen firms
 * returned one of each.
 */
export interface KindBreakdown {
  products: number;
  productSuppliers: number;
  services: number;
  serviceSuppliers: number;
}

export function kindBreakdown(docs: readonly SearchDoc[]): KindBreakdown {
  const productFirms = new Set<string>();
  const serviceFirms = new Set<string>();
  let products = 0;
  let services = 0;
  for (const doc of docs) {
    if (doc.kind === "product") {
      products += 1;
      productFirms.add(doc.businessId);
    } else if (doc.kind === "service") {
      services += 1;
      serviceFirms.add(doc.businessId);
    }
  }
  return {
    products,
    productSuppliers: productFirms.size,
    services,
    serviceSuppliers: serviceFirms.size,
  };
}

/**
 * `B3` — a tab narrows the set it is handed and never asks for another one.
 * Order is kept, so the Services tab is the blended order with the rest taken
 * out rather than a second ranking.
 */
export function narrow<T extends { kind: ResultKind; businessId: string }>(
  docs: readonly T[],
  tab: BlendedTab | undefined,
): T[] {
  if (!tab || tab === "all") {
    const represented = new Set<string>();
    for (const doc of docs) if (doc.kind !== "supplier") represented.add(doc.businessId);
    return docs.filter((doc) => doc.kind !== "supplier" || !represented.has(doc.businessId));
  }
  if (tab === "suppliers") return supplierDocs(docs);
  const kind = TAB_KIND[tab];
  return docs.filter((doc) => doc.kind === kind);
}

/**
 * The tabs the row draws. *A tab with a zero count is not drawn* — except the
 * one the buyer is on, which stays so that the page they arrived at still says
 * where they are, and Everything, which is where the switch out of an empty tab
 * goes.
 */
export function visibleTabs(counts: TabCounts, current: BlendedTab | undefined): BlendedTab[] {
  const on = current ?? "all";
  return (["all", "products", "services", "suppliers"] as const).filter(
    (tab) => tab === "all" || tab === on || counts[tab] > 0,
  );
}

/**
 * The tabs that still hold something, for the *nothing in this kind* state —
 * `B9`'s middle row, which is the one that makes blending worth building.
 */
export function tabsWithResults(counts: TabCounts, current: BlendedTab): BlendedTab[] {
  return (["products", "services", "suppliers"] as const).filter(
    (tab) => tab !== current && counts[tab] > 0,
  );
}

/* ── The rail ────────────────────────────────────────────────────────────── */

/** Which part of the three-part rail a group sits in. */
export type FacetScope = "shared" | "products" | "services";

/** Every rail group's key: a shared one, a service facet, or a `SpecField` id. */
export type RailKey = "emirate" | "tier" | "freeZone" | "availability" | ServiceFacetKey | (string & {});

export interface FacetOptionView {
  value: string;
  label: string;
  count: number;
  selected: boolean;
  /**
   * `B9`, third state — present in these results and reachable from nowhere.
   *
   * *Disable the facet with its zero, do not let it be chosen.* An option whose
   * count is nought in the active scope is drawn with its nought and is not a
   * link, because a link that promises a result set and delivers an empty one
   * is the thing three zero states exist to prevent.
   */
  disabled: boolean;
}

export interface FacetGroupView {
  key: RailKey;
  scope: FacetScope;
  label: string;
  /** Multi-value groups toggle; single-value ones replace. Decides the href. */
  multi: boolean;
  options: FacetOptionView[];
  /** Options present in the results and not shown, stated rather than hidden. */
  hidden: number;
}

export interface FacetScopeView {
  scope: FacetScope;
  /** How many results this scope's facets narrow to — `Narrows to products 148`. */
  narrowsTo: number | null;
  groups: FacetGroupView[];
}

/**
 * The words the rail needs and cannot derive: group labels and option labels,
 * each with an order. Built by the loader from the families, the catalogue and
 * the spec templates, so this module never reads a table and never calls `t()`.
 */
export interface FacetVocabulary {
  groupLabel: Record<string, string>;
  /** `label` for an option value; `order` sorts closed vocabularies. */
  option: Record<string, ReadonlyMap<string, { label: string; order: number }>>;
  /** Group keys whose options are free text, ordered by how common they are. */
  freeText: ReadonlySet<string>;
  /** Group keys in the order the rail draws them, per scope. */
  order: Record<FacetScope, readonly RailKey[]>;
  /** Group keys that take several values at once. */
  multi: ReadonlySet<string>;
}

/** Free-text groups show this many options, most common first. */
export const TEXT_OPTIONS_SHOWN = 8;

/** The order the service groups are drawn in — the scope sheet's own. */
export const SERVICE_RAIL_ORDER: readonly ServiceFacetKey[] = [
  "engagement",
  "turnaround",
  "fee",
  "delivered",
  "credential",
  "sector",
];

/** The shared groups, in the order `10c-s` draws them. */
export const SHARED_RAIL_ORDER: readonly RailKey[] = ["emirate", "tier", "freeZone"];

/** Which scope each rail group belongs to — the rail's three parts, in one map. */
export function scopeOf(key: RailKey, vocabulary: FacetVocabulary): FacetScope {
  for (const scope of ["shared", "products", "services"] as const) {
    if (vocabulary.order[scope].includes(key)) return scope;
  }
  return "products";
}

/**
 * The tab a scope's facets narrow to — `B3`'s switch, as a value rather than a
 * behaviour, so the href, the count and the resolved tab are one decision.
 */
export function tabForScope(scope: FacetScope, active: BlendedTab): BlendedTab {
  if (scope === "products") return "products";
  if (scope === "services") return "services";
  return active;
}

/** One group's values, present in the documents, with how many carry each. */
type Universe = Map<string, Map<string, number>>;

function seenValues(doc: SearchDoc, vocabulary: FacetVocabulary): Map<string, Set<string>> {
  const seen = new Map<string, Set<string>>();
  const add = (key: string, value: string) => {
    const set = seen.get(key) ?? new Set<string>();
    set.add(value);
    seen.set(key, set);
  };

  for (const emirate of doc.place.emirates) add("emirate", emirate);
  if (doc.verificationTier >= VERIFIED_TIER) add("tier", String(VERIFIED_TIER));
  if (doc.freeZone.emirates.length > 0 || doc.freeZone.areaIds.length > 0) add("freeZone", "1");

  for (const product of doc.products) {
    add("availability", product.availability);
    for (const [fieldId, values] of Object.entries(product.spec)) {
      if (!vocabulary.order.products.includes(fieldId)) continue;
      for (const value of values) add(fieldId, value);
    }
  }

  for (const kind of doc.credentials) add("credential", kind);
  for (const service of doc.services) {
    for (const key of SERVICE_LEVEL_KEYS) {
      if (!service.filterable.has(FACET_ROW[key])) continue;
      for (const value of valueOf(service, key)) add(key, value);
    }
  }
  return seen;
}

/**
 * The values each group can offer on this query, from the documents the words
 * found **before** any facet — so the rail stays when a filter empties the
 * list, and each option shows the count it now has, which is the boards'
 * zero-after-filtering state.
 */
function universe(base: readonly SearchDoc[], vocabulary: FacetVocabulary): Universe {
  const out: Universe = new Map();
  for (const doc of base) {
    for (const [key, values] of seenValues(doc, vocabulary)) {
      const tally = out.get(key) ?? new Map<string, number>();
      for (const value of values) tally.set(value, (tally.get(value) ?? 0) + 1);
      out.set(key, tally);
    }
  }
  return out;
}

/** The filters with one group replaced by one option — the count an option states. */
export function withOption(filters: BlendedFilters, key: RailKey, value: string): BlendedFilters {
  switch (key) {
    case "emirate":
      return { ...filters, emirate: value };
    case "tier":
      return { ...filters, tier: Number(value) };
    case "freeZone":
      return { ...filters, freeZone: true };
    case "availability":
      return { ...filters, availability: [value] };
    default:
      break;
  }
  if ((SERVICE_FACET_KEYS as readonly string[]).includes(key)) {
    const facet = key as ServiceFacetKey;
    /*
       Credentials are all required, so an option's count is the set with it
       *added* — the firms holding it as well as what is already ticked. Every
       other group is a set of alternatives, so the option replaces it.
    */
    return {
      ...filters,
      services:
        facet === "credential"
          ? { ...filters.services, credential: [...new Set([...filters.services.credential, value])] }
          : { ...filters.services, [facet]: [value] },
    };
  }
  return { ...filters, spec: { ...filters.spec, [key]: [value] } };
}

/** Whether a group currently holds this value. */
export function optionSelected(filters: BlendedFilters, key: RailKey, value: string): boolean {
  switch (key) {
    case "emirate":
      return filters.emirate === value;
    case "tier":
      return filters.tier !== null && filters.tier >= Number(value);
    case "freeZone":
      return filters.freeZone;
    case "availability":
      return filters.availability.includes(value);
    default:
      break;
  }
  if ((SERVICE_FACET_KEYS as readonly string[]).includes(key)) {
    return filters.services[key as ServiceFacetKey].includes(value);
  }
  return (filters.spec[key] ?? []).includes(value);
}

/** Every value a group currently holds — for the chip row and for a toggle href. */
export function optionValues(filters: BlendedFilters, key: RailKey): readonly string[] {
  switch (key) {
    case "emirate":
      return filters.emirate ? [filters.emirate] : [];
    case "tier":
      return filters.tier !== null ? [String(filters.tier)] : [];
    case "freeZone":
      return filters.freeZone ? ["1"] : [];
    case "availability":
      return filters.availability;
    default:
      break;
  }
  if ((SERVICE_FACET_KEYS as readonly string[]).includes(key)) return filters.services[key as ServiceFacetKey];
  return filters.spec[key] ?? [];
}

/**
 * `B2` — every option's count is a count **within the current results**, and
 * within the list the option would actually land the buyer on.
 *
 * A shared option counts inside the active tab: *Dubai 198* on Everything is
 * Dubai's share of everything, and on Services it is Dubai's share of the
 * services. A kind-specific option counts inside its own kind, because that is
 * the tab `B3` will switch to — *In stock 96* of the 148 products, never of the
 * 312.
 *
 * For a group of alternatives, an option's count is the set with that group
 * replaced by the option alone: *Retainer 13* means thirteen results would
 * remain if Retainer were the fee basis asked for, with every other group as it
 * stands. With a filter on, the other groups' counts shrink — which is the
 * board's correction. A count that did not is a global count beside a filtered
 * list.
 */
export function facetRail(
  base: readonly SearchDoc[],
  filters: BlendedFilters,
  vocabulary: FacetVocabulary,
  active: BlendedTab,
): FacetScopeView[] {
  const present = universe(base, vocabulary);
  /*
     What the scope's own header states — `NARROWS TO PRODUCTS 148`. It is the
     tab badge's number, computed from the same filtered set, so a scope cannot
     promise a larger list than the tab it switches to.
  */
  const narrowedCounts = tabCounts(applyFilters(base, filters));

  return (["shared", "products", "services"] as const).map((scope) => {
    const tab = tabForScope(scope, active);
    const groups = vocabulary.order[scope]
      .map((key) => {
        const tally = present.get(key) ?? new Map<string, number>();
        const values = new Set([...tally.keys(), ...optionValues(filters, key)]);
        const options = [...values].map((value) => {
          /*
             Filter first, then narrow — never the other way round. Everything
             holds a supplier row only for a firm nothing else in the set
             represents, and which firms those are is a property of the
             *filtered* set: narrowing the unfiltered one and counting the
             survivors misses the firm whose only matching product this option
             takes away, which is a row the list would then draw and the count
             did not.
          */
          const trial = withOption(filters, key, value);
          const count = narrow(applyFilters(base, trial), tab).length;
          const selected = optionSelected(filters, key, value);
          return {
            value,
            label: vocabulary.option[key]?.get(value)?.label ?? value,
            count,
            selected,
            disabled: count === 0 && !selected,
            order: vocabulary.option[key]?.get(value)?.order ?? Number.MAX_SAFE_INTEGER,
            seen: tally.get(value) ?? 0,
          };
        });

        if (vocabulary.freeText.has(key)) {
          options.sort((a, b) => b.seen - a.seen || a.label.localeCompare(b.label));
        } else {
          options.sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
        }

        const shown = vocabulary.freeText.has(key)
          ? options.filter((option, index) => index < TEXT_OPTIONS_SHOWN || option.selected)
          : options;

        return {
          key,
          scope,
          label: vocabulary.groupLabel[key] ?? key,
          multi: vocabulary.multi.has(key),
          options: shown.map(({ value, label, count, selected, disabled }) => ({
            value,
            label,
            count,
            selected,
            disabled,
          })),
          hidden: options.length - shown.length,
        };
      })
      .filter((group) => group.options.length > 0);

    return {
      scope,
      /*
         Null on the shared scope, which narrows whatever is in view rather than
         a kind, so a number there would be the tab's count printed twice.
      */
      narrowsTo: scope === "shared" ? null : narrowedCounts[scope],
      groups,
      /*
         A kind the words never found gets no part of the rail at all.

         The values reach `universe` through the firms — a valve supplier that
         also lists an audit puts *Fixed fee* in it — so without this a goods
         query draws a whole services scope whose every option is nought. The
         test is the **unfiltered** set, not the filtered one: a filter that
         empties a kind must leave its part of the rail standing, with each
         option's new count, which is the state `1c-s` shipped this rail for.
      */
      drawn: scope === "shared" || narrow(base, tab).length > 0,
    };
  })
    .filter((view) => view.drawn && view.groups.length > 0)
    .map(({ scope, narrowsTo, groups }) => ({ scope, narrowsTo, groups }));
}

/* ── Zero after filtering ────────────────────────────────────────────────── */

export interface BlendedDropSuggestion {
  key: RailKey;
  /** The group's own words — the rail is not always on screen to read them off. */
  label: string;
  yields: number;
}

/** Every filter group currently applied, in the rail's order. */
export function appliedGroups(filters: BlendedFilters, vocabulary: FacetVocabulary): RailKey[] {
  const keys: RailKey[] = [];
  for (const scope of ["shared", "products", "services"] as const) {
    for (const key of vocabulary.order[scope]) {
      if (optionValues(filters, key).length > 0) keys.push(key);
    }
  }
  return keys;
}

/** The filters with one whole group cleared. */
export function withoutGroup(filters: BlendedFilters, key: RailKey): BlendedFilters {
  switch (key) {
    case "emirate":
      return { ...filters, emirate: null };
    case "tier":
      return { ...filters, tier: null };
    case "freeZone":
      return { ...filters, freeZone: false };
    case "availability":
      return { ...filters, availability: [] };
    default:
      break;
  }
  if ((SERVICE_FACET_KEYS as readonly string[]).includes(key)) {
    return { ...filters, services: { ...filters.services, [key as ServiceFacetKey]: [] } };
  }
  const spec = { ...filters.spec };
  delete spec[key];
  return { ...filters, spec };
}

/**
 * `10c`'s ladder — every filter worth dropping, and what dropping it gets.
 *
 * *Drop stainless body — 41 products, mostly ductile iron.* The board draws
 * three rungs and prices each one, so this returns every single-group escape
 * that leads somewhere rather than only the best of them: a buyer who will not
 * give up **in stock** may well give up the certification, and a ladder with
 * one rung makes that their problem.
 *
 * Counted inside the tab the buyer is on, because that is the list they are
 * being offered. Empty where no single group helps — the page then offers to
 * clear them all, which always helps when the words matched anything.
 */
export function dropLadder(
  base: readonly SearchDoc[],
  filters: BlendedFilters,
  vocabulary: FacetVocabulary,
  active: BlendedTab,
): BlendedDropSuggestion[] {
  const rungs: BlendedDropSuggestion[] = [];
  for (const key of appliedGroups(filters, vocabulary)) {
    /* Filter, then narrow — the same order every other count on the page uses. */
    const yields = narrow(applyFilters(base, withoutGroup(filters, key)), active).length;
    if (yields > 0) rungs.push({ key, label: vocabulary.groupLabel[key] ?? key, yields });
  }
  return rungs.sort((a, b) => b.yields - a.yields);
}

/* ── Which page renders ──────────────────────────────────────────────────── */

export type Composition = "goods" | "blended";

/**
 * Whether `/search` renders board `1c`'s map composition or the blended one.
 *
 * **D1 moved this line.** `1c-s` sat beside goods search and let the results
 * decide — words that found a live service got the blended page, words that
 * found none got the two-tab goods page. With no live service in production
 * that rule meant every query got a tab row that *partitions the index*, which
 * is the thing D1 exists to refuse: a default of Products makes a services-only
 * firm invisible on the query it should win, and a partition decides for the
 * buyer before they have seen what exists.
 *
 * So the order is now:
 *
 *   1. **A map viewport goes to the map.** `?bounds=` is the one question a
 *      blended list cannot answer — it asks *who is here*, in coordinates, and
 *      a service has coverage rather than a pin.
 *   2. **A tab or any facet stays blended.** The rail owns stock and spec now
 *      as well as the scope sheet, so a facet in the URL was put there by this
 *      page and bouncing it elsewhere would drop the filter the buyer set.
 *   3. **Words are blended.** Every one of them, whatever the index holds
 *      today — that is D1.
 *   4. **No words is goods search.** `/search` on its own, or with only a
 *      place, is the directory browsed on a map. A result set nobody asked for
 *      is a browse, and a browse is what the map is for.
 */
export function compositionFor(query: SearchQuery): Composition {
  return forcedComposition(query) ?? (query.q.trim() !== "" ? "blended" : "goods");
}

/** Rules 1 and 2 — the URL alone decides, and nothing needs counting. */
export function forcedComposition(query: SearchQuery): Composition | null {
  if (query.bounds) return "goods";
  if (query.kind !== undefined || hasServiceFacets(query) || hasProductFacets(query)) return "blended";
  return null;
}

/**
 * `B1` — `?tab=` may persist for sharing, but it must not fork the query or the
 * page.
 *
 * `/search?tab=products` is a link the top nav, the footer and the home page
 * have all carried since handoff 1, and bookmarks carry it too. Under D1 there
 * is no products *page* to send it to, so it resolves to the products *tab* of
 * the one list and the goods tab state is dropped, which keeps a second name
 * for the same state out of every link the page then draws.
 */
export function adoptLegacyTab(query: SearchQuery): SearchQuery {
  if (query.tab !== "products") return query;
  return { ...query, tab: "businesses", kind: query.kind ?? "products" };
}

/** The tab the page shows, with `B3`'s switch applied. */
export function activeTab(query: SearchQuery): BlendedTab {
  return tabInEffect(query);
}

/* ── Building a document's values ────────────────────────────────────────── */

/** A declared sector list, split the way sellers write one. */
export function splitSectors(value: string | null | undefined): { key: string; label: string }[] {
  if (!value) return [];
  const out = new Map<string, string>();
  for (const part of value.split(/[,;·\n]/)) {
    const label = part.trim().replace(/\s+/g, " ");
    const key = facetText(label);
    if (key.length === 0 || out.has(key)) continue;
    out.set(key, label.charAt(0).toUpperCase() + label.slice(1));
  }
  return [...out].map(([key, label]) => ({ key, label }));
}

/**
 * The trade the products scope may offer spec fields from — `10c`'s *Capacity —
 * over 100 TR*, and the one honest way to put it on a page that spans every
 * category at once.
 *
 * A spec field belongs to one category's template (`SpecField.templateId`), and
 * `/search` has no category. Offering the fields of whichever template happened
 * to turn up would name a trade the query is not about and silently drop every
 * product filed elsewhere. So the rail offers them only where **a majority of
 * the matched products sit in one trade**, and names that trade in the group's
 * own heading, so a buyer ticking *Capacity* can see which products the tick
 * can reach. Below a majority the products scope offers availability alone.
 */
export function majorityCategory(products: readonly ProductFacetValues[]): string | null {
  if (products.length === 0) return null;
  const tally = new Map<string, number>();
  for (const product of products) {
    tally.set(product.categoryId, (tally.get(product.categoryId) ?? 0) + 1);
  }
  const [top] = [...tally].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (!top) return null;
  return top[1] * 2 > products.length ? top[0] : null;
}

export { emptyServiceFacets };
