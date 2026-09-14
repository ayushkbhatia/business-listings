import { describe, expect, it } from "vitest";
import {
  applyFacets,
  compositionFor,
  dropSuggestion,
  facetRail,
  forcedComposition,
  matches,
  narrow,
  splitSectors,
  tabCounts,
  TEXT_OPTIONS_SHOWN,
  visibleTabs,
  type FacetVocabulary,
  type SearchDoc,
  type ServiceFacetValues,
} from "./blended";
import {
  SERVICE_FACET_KEYS,
  emptyServiceFacets,
  facetText,
  parseSearchQuery,
  toSearchParams,
  withoutFacet,
  type ServiceFacets,
} from "./query";
import { DEFAULT_SERVICES_WEIGHTS, DEFAULT_WEIGHTS, rank, rankResultSet, type RankSignals } from "./ranking";

/**
 * Board `1c-s` — the numbers on a blended results page, without a database.
 *
 * The board's correction was a filter on screen that no count agreed with. So
 * the invariants here are the ones a total-checking pass cannot see: every
 * count is the same predicate over the same set, a tab narrows and never
 * re-counts, and a facet count shrinks when another filter is on.
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

let seq = 0;
function doc(kind: SearchDoc["kind"], services: ServiceFacetValues[], credentials: string[] = []): SearchDoc {
  seq += 1;
  return { id: `${kind}:${seq}`, kind, rowId: String(seq), businessId: `b${seq}`, services, credentials };
}

function facets(overrides: Partial<ServiceFacets>): ServiceFacets {
  return { ...emptyServiceFacets(), ...overrides };
}

const vocabulary: FacetVocabulary = {
  groupLabel: Object.fromEntries(SERVICE_FACET_KEYS.map((key) => [key, key])) as FacetVocabulary["groupLabel"],
  option: Object.fromEntries(SERVICE_FACET_KEYS.map((key) => [key, new Map()])) as unknown as FacetVocabulary["option"],
};

/* The board's own set, shrunk: FTA firms and a firm without, and a product. */
const SET: SearchDoc[] = [
  doc("service", [service({ fee: "per_return" })], ["fta_tax_agent"]),
  doc("service", [service({ fee: "retainer", delivered: "at_our_office" })], ["fta_tax_agent", "mof_audit_approval"]),
  doc("service", [service({ fee: "fixed_fee", turnaround: "2 weeks" })], []),
  doc("business", [service({ fee: "per_return" }), service({ fee: "fixed_fee", delivered: "on_site" })], ["fta_tax_agent"]),
  doc("business", [], []),
  doc("product", [], ["fta_tax_agent"]),
  doc("product", [], []),
];

describe("B1 — the header and the tabs are one count over the filtered set", () => {
  it("sums the tabs to the total, filtered or not", () => {
    for (const applied of [facets({}), facets({ credential: ["fta_tax_agent"] }), facets({ fee: ["per_return"] })]) {
      const counts = tabCounts(applied.credential.length || applied.fee.length ? applyFacets(SET, applied) : SET);
      expect(counts.services + counts.businesses + counts.products).toBe(counts.all);
    }
  });

  it("counts the filtered set when a filter is on — never the unfiltered one", () => {
    const filtered = applyFacets(SET, facets({ credential: ["fta_tax_agent"] }));
    expect(tabCounts(filtered)).toEqual({ all: 4, services: 2, businesses: 1, products: 1 });
    expect(tabCounts(SET).all).toBe(7);
  });
});

describe("B3 — a tab narrows one set and never re-counts it", () => {
  it("keeps the blended order and the counts the same on every tab", () => {
    const filtered = applyFacets(SET, facets({ credential: ["fta_tax_agent"] }));
    const counts = tabCounts(filtered);
    expect(narrow(filtered, "services").map((row) => row.id)).toEqual(
      filtered.filter((row) => row.kind === "service").map((row) => row.id),
    );
    expect(narrow(filtered, "services")).toHaveLength(counts.services);
    expect(narrow(filtered, "businesses")).toHaveLength(counts.businesses);
    expect(narrow(filtered, "products")).toHaveLength(counts.products);
    expect(narrow(filtered, "all")).toEqual(filtered);
    expect(narrow(filtered, undefined)).toEqual(filtered);
  });

  it("does not draw a tab with a zero count, except the one the buyer is on", () => {
    const counts = { all: 3, services: 3, businesses: 0, products: 0 };
    expect(visibleTabs(counts, undefined)).toEqual(["all", "services"]);
    expect(visibleTabs(counts, "products")).toEqual(["all", "services", "products"]);
  });
});

describe("the predicate", () => {
  it("requires every ticked credential — firms holding them as well", () => {
    expect(applyFacets(SET, facets({ credential: ["fta_tax_agent", "mof_audit_approval"] }))).toHaveLength(1);
  });

  it("offers alternatives within a group", () => {
    expect(applyFacets(SET, facets({ fee: ["per_return", "retainer"] })).map((row) => row.kind)).toEqual([
      "service",
      "service",
      "business",
    ]);
  });

  it("needs one service of a firm to answer every service facet at once", () => {
    const firm = SET[3]!;
    expect(matches(firm, facets({ fee: ["per_return"], delivered: ["remote"] }))).toBe(true);
    // per_return is remote and fixed_fee is on site; nothing is a per-return on-site service.
    expect(matches(firm, facets({ fee: ["per_return"], delivered: ["on_site"] }))).toBe(false);
  });

  it("leaves a product out of a service facet, and keeps it for a credential", () => {
    const product = SET[5]!;
    expect(matches(product, facets({ fee: ["per_return"] }))).toBe(false);
    expect(matches(product, facets({ credential: ["fta_tax_agent"] }))).toBe(true);
  });

  it("does not answer on a row the service's family does not offer as a filter", () => {
    const unfilterable = doc("service", [service({ filterable: new Set(["fee_basis"]) })]);
    expect(matches(unfilterable, facets({ fee: ["per_return"] }))).toBe(true);
    expect(matches(unfilterable, facets({ turnaround: ["5 working days"] }))).toBe(false);
  });
});

describe("B2 — a facet count is a count within the current results", () => {
  const rail = (applied: ServiceFacets) => facetRail(SET, applied, vocabulary);
  const count = (applied: ServiceFacets, key: string, value: string) =>
    rail(applied)
      .find((group) => group.key === key)
      ?.options.find((option) => option.value === value)?.count;

  it("is the number of rows that choosing it would leave", () => {
    for (const value of ["per_return", "retainer", "fixed_fee"]) {
      expect(count(facets({}), "fee", value)).toBe(applyFacets(SET, facets({ fee: [value] })).length);
    }
  });

  it("shrinks the other groups when a filter is on", () => {
    const off = count(facets({}), "fee", "fixed_fee");
    const on = count(facets({ credential: ["fta_tax_agent"] }), "fee", "fixed_fee");
    expect(on).toBeLessThan(off!);
    expect(on).toBe(applyFacets(SET, facets({ credential: ["fta_tax_agent"], fee: ["fixed_fee"] })).length);
  });

  it("counts a ticked credential as the whole set, and another as holding both", () => {
    const applied = facets({ credential: ["fta_tax_agent"] });
    expect(count(applied, "credential", "fta_tax_agent")).toBe(applyFacets(SET, applied).length);
    expect(count(applied, "credential", "mof_audit_approval")).toBe(1);
  });

  it("keeps the rail when the filters empty the list, with each option's count", () => {
    const applied = facets({ fee: ["per_hour"] });
    expect(applyFacets(SET, applied)).toHaveLength(0);
    const groups = rail(applied);
    expect(groups.map((group) => group.key)).toContain("fee");
    const fee = groups.find((group) => group.key === "fee")!;
    expect(fee.options.find((option) => option.value === "per_hour")).toMatchObject({ selected: true, count: 0 });
    expect(fee.options.find((option) => option.value === "retainer")?.count).toBe(1);
  });

  it("shows the commonest free-text values and says how many it did not", () => {
    const many = Array.from({ length: TEXT_OPTIONS_SHOWN + 3 }, (_, index) =>
      doc("service", [service({ turnaround: `${index + 1} days` })]),
    );
    const turnaround = facetRail(many, facets({}), vocabulary).find((group) => group.key === "turnaround")!;
    expect(turnaround.options).toHaveLength(TEXT_OPTIONS_SHOWN);
    expect(turnaround.hidden).toBe(3);
  });

  it("offers no price and no stock group — neither is a field a service has", () => {
    const keys = rail(facets({})).map((group) => group.key as string);
    for (const absent of ["price", "availability", "stock", "spec"]) expect(keys).not.toContain(absent);
  });
});

describe("zero after filtering names the filter to drop", () => {
  it("picks the group that opens the most", () => {
    const applied = facets({ credential: ["mof_audit_approval"], delivered: ["on_site"] });
    expect(applyFacets(SET, applied)).toHaveLength(0);
    expect(dropSuggestion(SET, applied)).toEqual({
      key: "delivered",
      yields: applyFacets(SET, { ...applied, delivered: [] }).length,
    });
  });

  it("says nothing when no single group helps", () => {
    const applied = facets({ credential: ["indemnity_insurance"], delivered: ["nowhere"] });
    expect(dropSuggestion(SET, applied)).toBeNull();
  });
});

describe("which composition `/search` renders", () => {
  const q = (params: Record<string, string>) => parseSearchQuery(params);

  it("sends a goods-only question to goods search", () => {
    expect(compositionFor(q({ q: "vat", availability: "in_stock" }), 5)).toBe("goods");
    expect(compositionFor(q({ q: "vat", bounds: "55.1,25.0,55.4,25.3" }), 5)).toBe("goods");
  });

  it("keeps a blended question blended whatever it finds", () => {
    expect(compositionFor(q({ q: "vat", kind: "services" }), 0)).toBe("blended");
    expect(compositionFor(q({ q: "vat", fee: "per_return" }), 0)).toBe("blended");
    expect(forcedComposition(q({ kind: "all" }))).toBe("blended");
  });

  it("lets words that find a service choose the blended page, and nothing else", () => {
    expect(compositionFor(q({ q: "vat return filing" }), 3)).toBe("blended");
    expect(compositionFor(q({ q: "gate valve" }), 0)).toBe("goods");
    expect(compositionFor(q({ emirate: "dubai" }), 12)).toBe("goods");
    expect(forcedComposition(q({ q: "vat" }))).toBeNull();
  });
});

describe("the service facets in the URL", () => {
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

  it("normalises free text into one matching form", () => {
    expect(facetText("  Free  Zone, entities ")).toBe("free zone entities");
    expect(splitSectors("Trading, free zone entities; Trading · Contracting")).toEqual([
      { key: "trading", label: "Trading" },
      { key: "free zone entities", label: "Free zone entities" },
      { key: "contracting", label: "Contracting" },
    ]);
  });

  function q(params: Record<string, string>) {
    return parseSearchQuery(params);
  }
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
    group: "service" | "business" | "product";
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
    row("b1", "business", { verificationTier: 2 }),
    row("b2", "business", { verificationTier: 0 }),
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

  it("puts a closer match above a looser one whatever its kind", () => {
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
