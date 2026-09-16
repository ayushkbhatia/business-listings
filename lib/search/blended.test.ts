import { describe, expect, it } from "vitest";
import {
  adoptLegacyTab,
  applyFilters,
  compositionFor,
  dropLadder,
  emptyFilters,
  facetRail,
  filtersOf,
  forcedComposition,
  kindBreakdown,
  majorityCategory,
  matches,
  narrow,
  splitSectors,
  tabCounts,
  tabsWithResults,
  TEXT_OPTIONS_SHOWN,
  visibleTabs,
  type BlendedFilters,
  type FacetVocabulary,
  type PlaceValues,
  type ProductFacetValues,
  type SearchDoc,
  type ServiceFacetValues,
} from "./blended";
import {
  SERVICE_FACET_KEYS,
  emptyServiceFacets,
  facetText,
  parseSearchQuery,
  setFacet,
  sortInScope,
  sortsForTab,
  tabInEffect,
  toggleFacet,
  toSearchParams,
  withoutFacet,
  type BlendedTab,
} from "./query";
import { DEFAULT_SERVICES_WEIGHTS, DEFAULT_WEIGHTS, rank, rankResultSet, type RankSignals } from "./ranking";

/**
 * Boards `1c-s`, `10c` and `10c-s` — the numbers on the search results page,
 * without a database.
 *
 * `1c-s`'s correction was a filter on screen that no count agreed with. D1's is
 * larger: a tab row that partitions the index, and a rail with no way to carry
 * a stock filter and a scope-sheet filter at once. So the invariants here are
 * the ones a total-checking pass cannot see — every count is the same predicate
 * over the same set, a tab narrows and never re-counts, a facet count shrinks
 * when another filter is on, and `Suppliers` is a distinct count of firms
 * rather than the sum of the two kind counts.
 */

const ALL_ROWS = new Set(["engagement_type", "turnaround", "fee_basis", "delivered_where", "sectors"]);

function service(overrides: Partial<ServiceFacetValues> = {}): ServiceFacetValues {
  return {
    engagement: "ongoing_contract",
    turnaround: "5 working days",
    fee: "per_return",
    delivered: "remote",
    sectors: [],
    filterable: ALL_ROWS,
    ...overrides,
  };
}

function product(overrides: Partial<ProductFacetValues> = {}): ProductFacetValues {
  return { availability: "in_stock", spec: {}, categoryId: "cat-chillers", ...overrides };
}

const NOWHERE: PlaceValues = { emirates: [], areaIds: [], wideEmirates: [] };
const DUBAI: PlaceValues = { emirates: ["dubai"], areaIds: ["area-quoz"], wideEmirates: [] };

let seq = 0;
function doc(
  kind: SearchDoc["kind"],
  overrides: Partial<SearchDoc> = {},
): SearchDoc {
  seq += 1;
  return {
    id: `${kind}:${seq}`,
    kind,
    rowId: String(seq),
    businessId: `b${seq}`,
    place: DUBAI,
    freeZone: NOWHERE,
    verificationTier: 2,
    responseTimeMedianMs: 3_600_000,
    establishedYear: 2010,
    services: [],
    products: [],
    credentials: [],
    ...overrides,
  };
}

function filters(overrides: Partial<BlendedFilters> = {}): BlendedFilters {
  return { ...emptyFilters(), ...overrides };
}

function serviceFilters(overrides: Partial<ReturnType<typeof emptyServiceFacets>>): BlendedFilters {
  return filters({ services: { ...emptyServiceFacets(), ...overrides } });
}

const vocabulary: FacetVocabulary = {
  groupLabel: Object.fromEntries(
    [...SERVICE_FACET_KEYS, "emirate", "tier", "freeZone", "availability", "field-capacity"].map((key) => [key, key]),
  ),
  option: {},
  freeText: new Set(["turnaround", "sector"]),
  order: {
    shared: ["emirate", "tier", "freeZone"],
    products: ["availability", "field-capacity"],
    services: [...SERVICE_FACET_KEYS],
  },
  multi: new Set(["availability", ...SERVICE_FACET_KEYS, "field-capacity"]),
};

/*
   The boards' own set, shrunk: FTA firms and a firm without, two products, and
   a supplier document for every firm that turned up — which is what `B2` means
   by a distinct count.
*/
const SET: SearchDoc[] = [
  doc("service", { businessId: "f1", services: [service({ fee: "per_return" })], credentials: ["fta_tax_agent"] }),
  doc("service", {
    businessId: "f2",
    services: [service({ fee: "retainer", delivered: "at_our_office" })],
    credentials: ["fta_tax_agent", "mof_audit_approval"],
  }),
  doc("service", { businessId: "f3", services: [service({ fee: "fixed_fee", turnaround: "2 weeks" })] }),
  doc("product", { businessId: "f1", products: [product()], credentials: ["fta_tax_agent"] }),
  doc("product", { businessId: "f4", products: [product({ availability: "made_to_order" })] }),
  /* f5 matched on its own name and listed nothing that matched — the orphan. */
  doc("supplier", { businessId: "f5" }),
  doc("supplier", {
    businessId: "f1",
    services: [service({ fee: "per_return" })],
    products: [product()],
    credentials: ["fta_tax_agent"],
  }),
  doc("supplier", { businessId: "f2", services: [service({ fee: "retainer", delivered: "at_our_office" })], credentials: ["fta_tax_agent", "mof_audit_approval"] }),
  doc("supplier", { businessId: "f3", services: [service({ fee: "fixed_fee", turnaround: "2 weeks" })] }),
  doc("supplier", { businessId: "f4", products: [product({ availability: "made_to_order" })] }),
];

describe("B1/B2 — the header, the tabs and the one count under them", () => {
  it("makes Everything the things plus the firms nothing else represents", () => {
    const counts = tabCounts(SET);
    expect(counts.products).toBe(2);
    expect(counts.services).toBe(3);
    /* f5 is the only firm with no product and no service in the set. */
    expect(counts.all).toBe(counts.products + counts.services + 1);
  });

  it("counts Suppliers as distinct businesses, never as the sum of the kinds", () => {
    const counts = tabCounts(SET);
    const breakdown = kindBreakdown(SET);
    /*
       f1 returned both a product and a service, so the gross figure the header
       line prints counts it twice. The tab does not — which is `B2`, and the
       reason 44 + 71 is not 96.
    */
    const behindTheKinds = new Set(
      SET.filter((row) => row.kind !== "supplier").map((row) => row.businessId),
    ).size;
    expect(breakdown.productSuppliers + breakdown.serviceSuppliers).toBeGreaterThan(behindTheKinds);
    expect(counts.suppliers).toBe(new Set(SET.map((row) => row.businessId)).size);
  });

  it("counts the filtered set when a filter is on — never the unfiltered one", () => {
    const filtered = applyFilters(SET, serviceFilters({ credential: ["fta_tax_agent"] }));
    expect(tabCounts(filtered).suppliers).toBe(2);
    expect(tabCounts(SET).suppliers).toBe(5);
  });
});

describe("B3 — a tab narrows one set and never re-counts it", () => {
  it("keeps the blended order and the counts the same on every tab", () => {
    const counts = tabCounts(SET);
    expect(narrow(SET, "services")).toHaveLength(counts.services);
    expect(narrow(SET, "products")).toHaveLength(counts.products);
    expect(narrow(SET, "suppliers")).toHaveLength(counts.suppliers);
    expect(narrow(SET, "all")).toHaveLength(counts.all);
    expect(narrow(SET, undefined)).toEqual(narrow(SET, "all"));
    expect(narrow(SET, "services").map((row) => row.id)).toEqual(
      SET.filter((row) => row.kind === "service").map((row) => row.id),
    );
  });

  it("keeps a firm out of Everything twice — its product is there, so its supplier row is not", () => {
    const everything = narrow(SET, "all");
    expect(everything.filter((row) => row.businessId === "f1" && row.kind === "supplier")).toHaveLength(0);
    expect(everything.filter((row) => row.businessId === "f5")).toHaveLength(1);
  });

  it("does not draw a tab with a zero count, except the one the buyer is on", () => {
    const counts = { all: 3, services: 3, products: 0, suppliers: 3 };
    expect(visibleTabs(counts, undefined)).toEqual(["all", "services", "suppliers"]);
    expect(visibleTabs(counts, "products")).toEqual(["all", "products", "services", "suppliers"]);
  });

  it("names the tabs that still hold something, for the nothing-in-this-kind state", () => {
    expect(tabsWithResults({ all: 312, products: 0, services: 164, suppliers: 96 }, "products")).toEqual([
      "services",
      "suppliers",
    ]);
  });

  it("switches the tab for a kind-specific facet rather than returning nothing", () => {
    const stock = parseSearchQuery({ q: "chiller", availability: "in_stock" });
    expect(tabInEffect(stock)).toBe("products");
    const onServices = parseSearchQuery({ q: "chiller", kind: "services", availability: "in_stock" });
    expect(tabInEffect(onServices)).toBe("products");
    const scope = parseSearchQuery({ q: "chiller", fee: "per_return" });
    expect(tabInEffect(scope)).toBe("services");
    expect(tabInEffect(parseSearchQuery({ q: "chiller", kind: "suppliers" }))).toBe("suppliers");
  });
});

describe("the predicate", () => {
  it("requires every ticked credential — firms holding them as well", () => {
    expect(applyFilters(SET, serviceFilters({ credential: ["fta_tax_agent", "mof_audit_approval"] }))).toHaveLength(2);
  });

  it("offers alternatives within a group", () => {
    const kinds = applyFilters(SET, serviceFilters({ fee: ["per_return", "retainer"] })).map((row) => row.kind);
    /* Two of the three services, and the two firms behind them. */
    expect(kinds.filter((kind) => kind === "service")).toHaveLength(2);
    expect(kinds.filter((kind) => kind === "supplier")).toHaveLength(2);
    /* A product answers no fee basis, so a fee basis says nothing about it. */
    expect(kinds.filter((kind) => kind === "product")).toHaveLength(2);
  });

  it("needs one service of a firm to answer every service facet at once", () => {
    const firm = doc("supplier", {
      services: [service({ fee: "per_return", delivered: "remote" }), service({ fee: "fixed_fee", delivered: "on_site" })],
    });
    expect(matches(firm, serviceFilters({ fee: ["per_return"], delivered: ["remote"] }))).toBe(true);
    // per_return is remote and fixed_fee is on site; nothing is a per-return on-site service.
    expect(matches(firm, serviceFilters({ fee: ["per_return"], delivered: ["on_site"] }))).toBe(false);
  });

  it("narrows the kinds that can answer a facet and leaves the rest alone — B3", () => {
    const goods = doc("product", { products: [product()], credentials: ["fta_tax_agent"] });
    const work = doc("service", { services: [service()] });

    /*
       A fee basis is a question about a service and a stock state one about a
       product. Neither narrows the other kind, which is what keeps the tab the
       switch lands on from being empty — and what keeps the badge beside it
       honest, since nothing about those rows has changed.
    */
    expect(matches(goods, serviceFilters({ fee: ["per_return"] }))).toBe(true);
    expect(matches(work, filters({ availability: ["in_stock"] }))).toBe(true);

    /* Within its own kind it narrows exactly as it says. */
    expect(matches(work, serviceFilters({ fee: ["per_hour"] }))).toBe(false);
    expect(matches(goods, filters({ availability: ["made_to_order"] }))).toBe(false);

    /* A credential is the firm's, not the work's, so every kind answers it. */
    expect(matches(goods, serviceFilters({ credential: ["fta_tax_agent"] }))).toBe(true);
    expect(matches(work, serviceFilters({ credential: ["fta_tax_agent"] }))).toBe(false);
  });

  it("holds a firm to both kinds of facet, because a firm answers both", () => {
    const both = doc("supplier", {
      services: [service({ fee: "per_return" })],
      products: [product({ availability: "in_stock" })],
    });
    expect(matches(both, { ...serviceFilters({ fee: ["per_return"] }), availability: ["in_stock"] })).toBe(true);
    expect(matches(both, { ...serviceFilters({ fee: ["per_return"] }), availability: ["made_to_order"] })).toBe(false);
  });

  it("needs one product of a firm to answer every product facet at once", () => {
    const firm = doc("supplier", {
      products: [
        product({ availability: "in_stock", spec: { size: ["DN50"] } }),
        product({ availability: "made_to_order", spec: { size: ["DN100"] } }),
      ],
    });
    expect(matches(firm, filters({ availability: ["in_stock"], spec: { size: ["DN50"] } }))).toBe(true);
    // A DN100 in stock is not something this firm holds.
    expect(matches(firm, filters({ availability: ["in_stock"], spec: { size: ["DN100"] } }))).toBe(false);
  });

  it("does not answer on a row the service's family does not offer as a filter", () => {
    const unfilterable = doc("service", { services: [service({ filterable: new Set(["fee_basis"]) })] });
    expect(matches(unfilterable, serviceFilters({ fee: ["per_return"] }))).toBe(true);
    expect(matches(unfilterable, serviceFilters({ turnaround: ["5 working days"] }))).toBe(false);
  });
});

describe("the shared scope reads a place the way each kind reaches one", () => {
  const branch = doc("product", { place: { emirates: ["dubai"], areaIds: ["area-quoz"], wideEmirates: [] } });
  const covers = doc("service", { place: { emirates: ["dubai"], areaIds: [], wideEmirates: ["dubai"] } });

  it("answers an emirate for a branch and for coverage alike", () => {
    expect(matches(branch, filters({ emirate: "dubai" }))).toBe(true);
    expect(matches(covers, filters({ emirate: "dubai" }))).toBe(true);
    expect(matches(branch, filters({ emirate: "sharjah" }))).toBe(false);
  });

  it("does not let a branch in one area answer a search for another", () => {
    const bay = { id: "area-bay", emirate: "dubai" };
    expect(matches(branch, filters({ area: bay }))).toBe(false);
    /* An emirate-wide coverage row does reach every area inside it. */
    expect(matches(covers, filters({ area: bay }))).toBe(true);
  });

  it("narrows a free-zone filter by the place already set", () => {
    const jafza = doc("supplier", {
      place: { emirates: ["dubai"], areaIds: ["area-jafza"], wideEmirates: [] },
      freeZone: { emirates: ["dubai"], areaIds: ["area-jafza"], wideEmirates: [] },
    });
    expect(matches(jafza, filters({ freeZone: true }))).toBe(true);
    expect(matches(jafza, filters({ freeZone: true, emirate: "dubai" }))).toBe(true);
    expect(matches(jafza, filters({ freeZone: true, emirate: "sharjah" }))).toBe(false);
  });

  it("refuses an area slug that names no row rather than ignoring it", () => {
    expect(matches(branch, filters({ areaUnknown: true }))).toBe(false);
  });

  it("drops a listing with no measured reply from a reply-time filter", () => {
    const unmeasured = doc("supplier", { responseTimeMedianMs: null });
    expect(matches(unmeasured, filters({ replyWithinHours: 24 }))).toBe(false);
    expect(matches(branch, filters({ replyWithinHours: 24 }))).toBe(true);
  });
});

describe("B2 — a facet count is a count within the current results", () => {
  const rail = (applied: BlendedFilters, active: BlendedTab = "all") =>
    facetRail(SET, applied, vocabulary, active);
  const group = (applied: BlendedFilters, key: string, active: BlendedTab = "all") =>
    rail(applied, active)
      .flatMap((scope) => scope.groups)
      .find((candidate) => candidate.key === key);
  const count = (applied: BlendedFilters, key: string, value: string, active: BlendedTab = "all") =>
    group(applied, key, active)?.options.find((option) => option.value === value)?.count;

  it("counts a kind-specific option inside its own kind, not inside Everything", () => {
    const products = narrow(SET, "products");
    expect(count(filters(), "availability", "in_stock")).toBe(
      products.filter((row) => matches(row, filters({ availability: ["in_stock"] }))).length,
    );
    expect(count(filters(), "fee", "per_return")).toBe(
      narrow(SET, "services").filter((row) => matches(row, serviceFilters({ fee: ["per_return"] }))).length,
    );
  });

  it("counts a shared option inside the active tab", () => {
    expect(count(filters(), "emirate", "dubai", "products")).toBe(narrow(SET, "products").length);
    expect(count(filters(), "emirate", "dubai", "services")).toBe(narrow(SET, "services").length);
  });

  it("shrinks the other groups when a filter is on", () => {
    const off = count(filters(), "fee", "fixed_fee");
    const on = count(serviceFilters({ credential: ["fta_tax_agent"] }), "fee", "fixed_fee");
    expect(on).toBeLessThan(off!);
  });

  it("counts a ticked credential as the whole set, and another as holding both", () => {
    const applied = serviceFilters({ credential: ["fta_tax_agent"] });
    expect(count(applied, "credential", "fta_tax_agent")).toBe(
      narrow(applyFilters(SET, applied), "services").length,
    );
    expect(count(applied, "credential", "mof_audit_approval")).toBe(1);
  });

  it("keeps the rail when the filters empty the list, and disables the options that lead nowhere", () => {
    const applied = serviceFilters({ fee: ["per_hour"] });
    /* No service and no firm answers it. The products are untouched — B3. */
    expect(narrow(applyFilters(SET, applied), "services")).toHaveLength(0);
    const fee = group(applied, "fee")!;
    expect(fee.options.find((option) => option.value === "per_hour")).toMatchObject({ selected: true, count: 0 });
    /* B9's third state: a nought is drawn and is not a link. */
    const dead = fee.options.filter((option) => option.count === 0 && !option.selected);
    expect(dead.every((option) => option.disabled)).toBe(true);
    expect(fee.options.find((option) => option.value === "per_hour")?.disabled).toBe(false);
  });

  it("puts each group in its declared scope, and states what that scope narrows to", () => {
    const scopes = rail(filters());
    expect(scopes.map((scope) => scope.scope)).toEqual(["shared", "products", "services"]);
    expect(scopes.find((scope) => scope.scope === "shared")?.narrowsTo).toBeNull();
    expect(scopes.find((scope) => scope.scope === "products")?.narrowsTo).toBe(tabCounts(SET).products);
    expect(scopes.find((scope) => scope.scope === "services")?.narrowsTo).toBe(tabCounts(SET).services);
  });

  it("shows the commonest free-text values and says how many it did not", () => {
    const many = Array.from({ length: TEXT_OPTIONS_SHOWN + 3 }, (_, index) =>
      doc("service", { services: [service({ turnaround: `${index + 1} days` })] }),
    );
    const turnaround = facetRail(many, filters(), vocabulary, "all")
      .flatMap((scope) => scope.groups)
      .find((candidate) => candidate.key === "turnaround")!;
    expect(turnaround.options).toHaveLength(TEXT_OPTIONS_SHOWN);
    expect(turnaround.hidden).toBe(3);
  });

  it("offers no price group — there is no price on any public surface", () => {
    const keys = rail(filters()).flatMap((scope) => scope.groups.map((candidate) => String(candidate.key)));
    for (const absent of ["price", "priceRange", "cost"]) expect(keys).not.toContain(absent);
  });
});

describe("the ladder — every filter worth dropping, and what dropping it gets", () => {
  it("prices each rung and puts the one that opens the most first", () => {
    const applied = serviceFilters({ credential: ["mof_audit_approval"], delivered: ["on_site"] });
    expect(narrow(applyFilters(SET, applied), "all")).toHaveLength(0);
    const ladder = dropLadder(SET, applied, vocabulary, "all");
    expect(ladder.length).toBeGreaterThan(0);
    expect(ladder.map((rung) => rung.yields)).toEqual([...ladder.map((rung) => rung.yields)].sort((a, b) => b - a));
    for (const rung of ladder) {
      expect(rung.yields).toBe(
        narrow(SET, "all").filter((row) =>
          matches(row, { ...applied, services: { ...applied.services, [rung.key]: [] } }),
        ).length,
      );
    }
  });

  it("offers no rung at all when no single group helps", () => {
    /* Two filters, each of which empties the set on its own. */
    const applied: BlendedFilters = {
      ...serviceFilters({ credential: ["knighthood"] }),
      emirate: "fujairah",
    };
    expect(narrow(applyFilters(SET, applied), "all")).toHaveLength(0);
    expect(dropLadder(SET, applied, vocabulary, "all")).toEqual([]);
  });
});

describe("which composition `/search` renders", () => {
  const q = (params: Record<string, string>) => parseSearchQuery(params);

  it("sends a map viewport to the map, and nothing else", () => {
    expect(compositionFor(q({ q: "vat", bounds: "55.1,25.0,55.4,25.3" }))).toBe("goods");
    expect(forcedComposition(q({ bounds: "55.1,25.0,55.4,25.3" }))).toBe("goods");
  });

  it("takes every query with words to the blended screen — D1", () => {
    expect(compositionFor(q({ q: "gate valve" }))).toBe("blended");
    expect(compositionFor(q({ q: "vat return filing" }))).toBe("blended");
    /* A stock filter used to force goods search. The rail owns it now. */
    expect(compositionFor(q({ q: "vat", availability: "in_stock" }))).toBe("blended");
  });

  it("keeps a browse with no words on the map", () => {
    expect(compositionFor(q({}))).toBe("goods");
    expect(compositionFor(q({ emirate: "dubai" }))).toBe("goods");
  });

  it("keeps any faceted question blended whatever it finds", () => {
    expect(compositionFor(q({ kind: "services" }))).toBe("blended");
    expect(compositionFor(q({ fee: "per_return" }))).toBe("blended");
    expect(forcedComposition(q({ kind: "all" }))).toBe("blended");
    expect(forcedComposition(q({ q: "vat" }))).toBeNull();
  });

  it("resolves the legacy products tab to the Products tab of the one list", () => {
    const legacy = adoptLegacyTab(q({ q: "valve", tab: "products" }));
    expect(legacy.kind).toBe("products");
    expect(legacy.tab).toBe("businesses");
    expect(toSearchParams(legacy)).not.toContain("tab=products");
    /* An explicit kind wins — the legacy key never overwrites a live one. */
    expect(adoptLegacyTab(q({ q: "valve", tab: "products", kind: "services" })).kind).toBe("services");
  });
});

describe("Q3 — one cross-kind order, and the kind-specific one in scope", () => {
  it("offers most complete specs only on Products", () => {
    expect(sortsForTab("products")).toContain("specs");
    for (const tab of ["all", "services", "suppliers"] as const) {
      expect(sortsForTab(tab)).not.toContain("specs");
    }
  });

  it("falls back to the ranking when a URL asks for an order the tab cannot carry", () => {
    expect(sortInScope("specs", "services")).toBe("best");
    expect(sortInScope("specs", "products")).toBe("specs");
    expect(sortInScope("reply", "services")).toBe("reply");
  });
});

describe("the facets in the URL", () => {
  const q = (params: Record<string, string>) => parseSearchQuery(params);

  it("round-trips every key", () => {
    const query = q({
      q: "vat",
      kind: "services",
      engagement: "ongoing_contract",
      fee: "per_return,retainer",
      delivered: "remote",
      credential: "fta_tax_agent",
      turnaround: "5 working days",
      sector: "free zone entities",
    });
    expect(parseSearchQuery(Object.fromEntries(new URLSearchParams(toSearchParams(query))))).toEqual(query);
  });

  it("drops values nobody could have written, rather than echoing them into every link", () => {
    const query = q({
      engagement: "forever",
      fee: "DROP TABLE",
      delivered: "moon",
      credential: "knighthood",
      sector: "Free Zone Entities",
      kind: "everything",
    });
    expect(query.services).toBeUndefined();
    expect(query.kind).toBeUndefined();
    expect(toSearchParams(query)).toBe("");
  });

  it("parses a goods query to exactly the object it did before", () => {
    const query = q({ q: "valve", tier: "2" });
    expect("services" in query).toBe(false);
    expect("kind" in query).toBe(false);
  });

  it("clears one group without touching the tab", () => {
    const query = q({ q: "vat", kind: "services", fee: "per_return", delivered: "remote" });
    const next = withoutFacet(query, "fee");
    expect(next.services?.fee).toEqual([]);
    expect(next.services?.delivered).toEqual(["remote"]);
    expect(next.kind).toBe("services");
  });

  it("sets and toggles a group wherever it lives — one column, one relation, one scope row", () => {
    const query = q({ q: "chiller" });
    expect(setFacet(query, "emirate", ["dubai"]).emirate).toBe("dubai");
    expect(setFacet(query, "tier", ["2"]).tier).toBe(2);
    expect(setFacet(query, "freeZone", ["1"]).freeZone).toBe(true);
    expect(toggleFacet(query, "availability", "in_stock", { multi: true, selected: false }).availability).toEqual([
      "in_stock",
    ]);
    const withSpec = setFacet(query, "cmfield00000000000000000", ["DN100"]);
    expect(withSpec.spec["cmfield00000000000000000"]).toEqual(["DN100"]);
    expect(toggleFacet(withSpec, "cmfield00000000000000000", "DN100", { multi: true, selected: true }).spec).toEqual({});
  });

  it("drops the area when the emirate moves — a place that cannot exist is not a filter", () => {
    const query = q({ q: "chiller", emirate: "dubai", area: "al-quoz-industrial-1" });
    expect(setFacet(query, "emirate", ["sharjah"]).area).toBeUndefined();
    expect(setFacet(query, "emirate", ["dubai"]).area).toBe("al-quoz-industrial-1");
  });

  it("normalises free text into one matching form", () => {
    expect(facetText("  Free  Zone, entities ")).toBe("free zone entities");
    expect(splitSectors("Trading, free zone entities; Trading · Contracting")).toEqual([
      { key: "trading", label: "Trading" },
      { key: "free zone entities", label: "Free zone entities" },
      { key: "contracting", label: "Contracting" },
    ]);
  });

  it("builds the filter set the predicate reads, with the area resolved", () => {
    const query = q({ q: "chiller", emirate: "dubai", area: "al-quoz-industrial-1", availability: "in_stock" });
    const resolved = filtersOf(query, { id: "area-quoz", emirate: "dubai" });
    expect(resolved.area).toEqual({ id: "area-quoz", emirate: "dubai" });
    expect(resolved.areaUnknown).toBe(false);
    expect(filtersOf(query, null).areaUnknown).toBe(true);
    expect(resolved.availability).toEqual(["in_stock"]);
  });
});

describe("the trade the products scope may offer spec fields from", () => {
  it("needs a majority, not a plurality", () => {
    const majority = [product({ categoryId: "a" }), product({ categoryId: "a" }), product({ categoryId: "b" })];
    expect(majorityCategory(majority)).toBe("a");
    const plurality = [
      product({ categoryId: "a" }),
      product({ categoryId: "a" }),
      product({ categoryId: "b" }),
      product({ categoryId: "c" }),
    ];
    expect(majorityCategory(plurality)).toBeNull();
    expect(majorityCategory([])).toBeNull();
  });
});

describe("rankResultSet — one documented sort, never a partition", () => {
  const base: RankSignals = {
    relevance: 1,
    verificationTier: 1,
    responseTimeMedianMs: null,
    specCompleteness: null,
    distanceKm: null,
    planMultiplier: 1,
  };
  interface Row {
    id: string;
    group: "service" | "supplier" | "product";
    signals: RankSignals;
  }
  const row = (id: string, group: Row["group"], overrides: Partial<RankSignals>): Row => ({
    id,
    group,
    signals: { ...base, ...overrides },
  });

  const rows: Row[] = [
    row("s1", "service", { verificationTier: 2 }),
    row("s2", "service", { verificationTier: 0 }),
    row("s3", "service", { verificationTier: 1 }),
    row("b1", "supplier", { verificationTier: 2 }),
    row("b2", "supplier", { verificationTier: 0 }),
    row("p1", "product", { verificationTier: 2 }),
  ];
  const ranked = rankResultSet(
    rows,
    (entry) => entry.group,
    (entry) => entry.signals,
    () => "goods",
    { goods: DEFAULT_WEIGHTS, services: DEFAULT_SERVICES_WEIGHTS },
  );

  it("keeps each kind in exactly its own ranking", () => {
    const services = rank(
      rows.filter((entry) => entry.group === "service"),
      (entry) => entry.signals,
      DEFAULT_SERVICES_WEIGHTS,
      "services",
    );
    expect(ranked.filter((entry) => entry.group === "service").map((entry) => entry.id)).toEqual(
      services.map((entry) => entry.id),
    );
  });

  it("interleaves the kinds rather than stacking them", () => {
    const order = ranked.map((entry) => entry.group);
    const firstProduct = order.indexOf("product");
    const lastService = order.lastIndexOf("service");
    expect(firstProduct).toBeLessThan(lastService);
    expect(order.slice(0, 3)).not.toEqual(["service", "service", "service"]);
  });

  it("puts a closer match above a looser one whatever its kind — Q6", () => {
    const mixed = rankResultSet(
      [row("loose", "service", { relevance: 0.4, verificationTier: 2 }), row("exact", "product", { relevance: 1, verificationTier: 0 })],
      (entry) => entry.group,
      (entry) => entry.signals,
      () => "goods",
      { goods: DEFAULT_WEIGHTS, services: null },
    );
    expect(mixed.map((entry) => entry.id)).toEqual(["exact", "loose"]);
  });

  it("returns a single kind as that kind's ranking", () => {
    const only = rows.filter((entry) => entry.group === "service");
    expect(
      rankResultSet(only, (entry) => entry.group, (entry) => entry.signals, () => "goods", {
        goods: DEFAULT_WEIGHTS,
        services: null,
      }).map((entry) => entry.id),
    ).toEqual(rank(only, (entry) => entry.signals, DEFAULT_WEIGHTS, "goods").map((entry) => entry.id));
  });
});
