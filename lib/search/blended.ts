import {
  SERVICE_FACET_KEYS,
  emptyServiceFacets,
  facetText,
  hasServiceFacets,
  type BlendedTab,
  type SearchQuery,
  type ServiceFacetKey,
  type ServiceFacets,
} from "./query";

/**
 * Board `1c-s` — one query, one result set, three kinds of thing in it.
 *
 * Pure, with no database import, because every number on the page is decided
 * here and the board's whole argument is that those numbers agree: the header,
 * the four tabs, every facet count and the rows are one set. So there is one
 * predicate — `matches` — and every count is that predicate run over the same
 * documents with one facet group changed. A count computed any other way is a
 * second definition of the query, which is the defect the board shipped with
 * (`All 147` over a filter that left 61).
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

export type ResultKind = "service" | "business" | "product";

export const RESULT_KINDS = ["service", "business", "product"] as const satisfies readonly ResultKind[];

/** Which tab shows which kind. */
export const TAB_KIND: Record<Exclude<BlendedTab, "all">, ResultKind> = {
  services: "service",
  businesses: "business",
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

export interface SearchDoc {
  /** `service:<id>`, `business:<id>`, `product:<id>`. */
  id: string;
  kind: ResultKind;
  /** The row's own id. */
  rowId: string;
  businessId: string;
  /**
   * The services a service-level facet asks about.
   *
   * A service document carries itself. A business carries the services it
   * matched through — or every live service where it matched on its own name —
   * and **one of them has to answer every service facet at once**, the same
   * rule `businessWhere` holds spec facets to: a firm with a fixed-fee remote
   * service and an hourly on-site one does not offer a fixed-fee on-site
   * service. A product carries none, so a service facet leaves it out.
   */
  services: readonly ServiceFacetValues[];
  /** The register-checked credential kinds the firm holds — `1c-s` B7. */
  credentials: readonly string[];
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

/**
 * Whether one document is in the result set the facets describe.
 *
 * Within a group the options are alternatives — *fixed fee or per return* —
 * because a service has one fee basis and a buyer ticking two is widening.
 * Credentials are the exception and are all required: a firm holds several at
 * once, and the board's counts read *FTA registered tax agent 61, MoE listed
 * auditor 18* — eighteen that hold both, not eighteen more.
 */
export function matches(doc: SearchDoc, facets: ServiceFacets): boolean {
  if (!facets.credential.every((kind) => doc.credentials.includes(kind))) return false;
  const active = SERVICE_LEVEL_KEYS.filter((key) => facets[key].length > 0);
  if (active.length === 0) return true;
  return doc.services.some((service) => active.every((key) => answers(service, key, facets[key])));
}

export function applyFacets(docs: readonly SearchDoc[], facets: ServiceFacets): SearchDoc[] {
  return docs.filter((doc) => matches(doc, facets));
}

/* ── Tabs ────────────────────────────────────────────────────────────────── */

export interface TabCounts {
  all: number;
  services: number;
  businesses: number;
  products: number;
}

/** B1 — the header and the four tabs, from the one filtered set. */
export function tabCounts(docs: readonly SearchDoc[]): TabCounts {
  const counts = { all: docs.length, services: 0, businesses: 0, products: 0 };
  for (const doc of docs) {
    if (doc.kind === "service") counts.services += 1;
    else if (doc.kind === "business") counts.businesses += 1;
    else counts.products += 1;
  }
  return counts;
}

/**
 * B3 — a tab narrows the set it is handed and never asks for another one.
 * Order is kept, so the Services tab is the blended order with the rest taken
 * out rather than a second ranking.
 */
export function narrow<T extends { kind: ResultKind }>(docs: readonly T[], tab: BlendedTab | undefined): T[] {
  if (!tab || tab === "all") return [...docs];
  const kind = TAB_KIND[tab];
  return docs.filter((doc) => doc.kind === kind);
}

/**
 * The tabs the row draws. *A tab with a zero count is not drawn* — except the
 * one the buyer is on, which stays so that the page they arrived at still says
 * where they are.
 */
export function visibleTabs(counts: TabCounts, current: BlendedTab | undefined): BlendedTab[] {
  const on = current ?? "all";
  return (["all", "services", "businesses", "products"] as const).filter(
    (tab) => tab === "all" || tab === on || counts[tab] > 0,
  );
}

/* ── The rail ────────────────────────────────────────────────────────────── */

export interface FacetOptionView {
  value: string;
  label: string;
  count: number;
  selected: boolean;
}

export interface FacetGroupView {
  key: ServiceFacetKey;
  label: string;
  options: FacetOptionView[];
  /** Options present in the results and not shown, stated rather than hidden. */
  hidden: number;
}

/**
 * The words the rail needs and cannot derive: group labels and option labels,
 * each with an order. Built by the loader from the families and the catalogue,
 * so this module never reads a table and never calls `t()`.
 */
export interface FacetVocabulary {
  groupLabel: Record<ServiceFacetKey, string>;
  /** `label` for an option value; `order` sorts closed vocabularies. */
  option: Record<ServiceFacetKey, ReadonlyMap<string, { label: string; order: number }>>;
}

/** Free-text groups show this many options, most common first. */
export const TEXT_OPTIONS_SHOWN = 8;

const TEXT_KEYS: ReadonlySet<ServiceFacetKey> = new Set(["turnaround", "sector"]);

/** The order groups are drawn in — the scope sheet's own, with the checked credential in the regulator's place. */
export const RAIL_ORDER: readonly ServiceFacetKey[] = [
  "engagement",
  "turnaround",
  "fee",
  "delivered",
  "credential",
  "sector",
];

/**
 * The values each group can offer on this query, from the documents the words
 * found **before** any facet — so the rail stays when a filter empties the
 * list, and each option shows the count it now has, which is the board's
 * zero-after-filtering state.
 */
function universe(base: readonly SearchDoc[]): Record<ServiceFacetKey, Map<string, number>> {
  const out = Object.fromEntries(SERVICE_FACET_KEYS.map((key) => [key, new Map<string, number>()])) as Record<
    ServiceFacetKey,
    Map<string, number>
  >;
  for (const doc of base) {
    const seen = Object.fromEntries(SERVICE_FACET_KEYS.map((key) => [key, new Set<string>()])) as Record<
      ServiceFacetKey,
      Set<string>
    >;
    for (const kind of doc.credentials) seen.credential.add(kind);
    for (const service of doc.services) {
      for (const key of SERVICE_LEVEL_KEYS) {
        if (!service.filterable.has(FACET_ROW[key])) continue;
        for (const value of valueOf(service, key)) seen[key].add(value);
      }
    }
    for (const key of SERVICE_FACET_KEYS) {
      for (const value of seen[key]) out[key].set(value, (out[key].get(value) ?? 0) + 1);
    }
  }
  return out;
}

/**
 * B2 — every option's count is a count **within the current results**.
 *
 * For a group of alternatives, an option's count is the set with that group
 * replaced by the option alone: *Retainer 13* means thirteen results would
 * remain if Retainer were the fee basis asked for, with every other group as it
 * stands. For credentials, which are all required, it is the set with the
 * option added: the firms holding it *as well as* what is already ticked, so a
 * ticked credential counts the whole set.
 *
 * With a filter on, the other groups' counts shrink — which is the board's
 * correction. A count that did not is a global count beside a filtered list.
 */
export function facetRail(
  base: readonly SearchDoc[],
  facets: ServiceFacets,
  vocabulary: FacetVocabulary,
): FacetGroupView[] {
  const present = universe(base);

  return RAIL_ORDER.map((key) => {
    const values = new Set([...present[key].keys(), ...facets[key]]);
    const options = [...values].map((value) => {
      const selected = facets[key].includes(value);
      const trial: ServiceFacets =
        key === "credential"
          ? { ...facets, credential: [...new Set([...facets.credential, value])] }
          : { ...facets, [key]: [value] };
      return {
        value,
        label: vocabulary.option[key].get(value)?.label ?? value,
        count: base.reduce((total, doc) => total + (matches(doc, trial) ? 1 : 0), 0),
        selected,
        order: vocabulary.option[key].get(value)?.order ?? Number.MAX_SAFE_INTEGER,
        seen: present[key].get(value) ?? 0,
      };
    });

    if (TEXT_KEYS.has(key)) {
      options.sort((a, b) => b.seen - a.seen || a.label.localeCompare(b.label));
    } else {
      options.sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
    }

    const shown = TEXT_KEYS.has(key)
      ? options.filter((option, index) => index < TEXT_OPTIONS_SHOWN || option.selected)
      : options;

    return {
      key,
      label: vocabulary.groupLabel[key],
      options: shown.map(({ value, label, count, selected }) => ({ value, label, count, selected })),
      hidden: options.length - shown.length,
    };
  }).filter((group) => group.options.length > 0);
}

/* ── Zero after filtering ────────────────────────────────────────────────── */

export interface BlendedDropSuggestion {
  key: ServiceFacetKey;
  yields: number;
}

/**
 * Which one facet group to clear, and what clearing it gets.
 *
 * *The empty state names which filter to drop.* Each applied group is removed
 * in turn and the set counted with the same predicate; the one that opens the
 * most wins, ties to the rail's order. Null where no single group helps — the
 * page then offers to clear them all, which always helps when the words
 * matched anything.
 */
export function dropSuggestion(base: readonly SearchDoc[], facets: ServiceFacets): BlendedDropSuggestion | null {
  let best: BlendedDropSuggestion | null = null;
  for (const key of RAIL_ORDER) {
    if (facets[key].length === 0) continue;
    const yields = applyFacets(base, { ...facets, [key]: [] }).length;
    if (yields > 0 && (!best || yields > best.yields)) best = { key, yields };
  }
  return best;
}

/* ── Which page renders ──────────────────────────────────────────────────── */

export type Composition = "goods" | "blended";

/**
 * Whether `/search` renders board `1c`'s map composition or this board's.
 *
 * `1c-s` *sits beside* goods search and deliberately does not resemble it, so
 * one route carries two compositions and this decides between them, in order:
 *
 *   1. **A goods-only question goes to goods.** Availability, a spec value and
 *      a map viewport are all questions a service cannot answer, and the
 *      blended rail has none of them (B6) — rendering one there would show a
 *      filter the rail cannot remove.
 *   2. **A blended question stays blended.** A tab or a service facet in the
 *      URL was put there by this page, and bouncing it to a page without that
 *      rail would drop the filter the buyer set.
 *   3. **Otherwise the results decide.** Words that find at least one live
 *      service get the blended page; words that find none get goods search,
 *      which is also the board's own *goods-only query* state — businesses and
 *      products, and no Services tab. **No words is goods search**: `/search`
 *      on its own, or with only a place, is the directory browsed on a map, and
 *      every live service in an emirate is not an answer to a question nobody
 *      typed.
 */
export function compositionFor(query: SearchQuery, serviceMatches: number): Composition {
  return forcedComposition(query) ?? (query.q.trim() !== "" && serviceMatches > 0 ? "blended" : "goods");
}

/** Rules 1 and 2 — the URL alone decides, and nothing needs counting. */
export function forcedComposition(query: SearchQuery): Composition | null {
  if ((query.availability?.length ?? 0) > 0) return "goods";
  if (Object.values(query.spec ?? {}).some((values) => values.length > 0)) return "goods";
  if (query.bounds) return "goods";
  if (query.kind !== undefined || hasServiceFacets(query)) return "blended";
  return null;
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

export { emptyServiceFacets };
