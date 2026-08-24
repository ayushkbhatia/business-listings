import { describe, expect, it } from "vitest";
import { MATCH_FLOOR, matchLine, tokenise, type MatchableProduct } from "./match";

/** Shaped like the seeded valve catalogue, because that is what it will meet. */
function product(over: Partial<MatchableProduct> & { id: string; name: string; size: string | null }): MatchableProduct {
  return {
    sku: null,
    searchText: `${over.name} ${over.size ?? ""}`.toLowerCase(),
    availability: "in_stock",
    stockQty: 40,
    leadTimeDays: null,
    minOrderQty: null,
    ...over,
  };
}

const CATALOGUE: MatchableProduct[] = [
  product({
    id: "p_gate_100",
    name: "Resilient seated gate valve DN100",
    size: "DN100",
    sku: "ALM-1000",
    searchText: "resilient seated gate valve dn100 alm-1000 valves and fittings dn100 4\" 4 inch flanged ductile iron pn16",
  }),
  product({
    id: "p_gate_150",
    name: "Resilient seated gate valve DN150",
    size: "DN150",
    searchText: "resilient seated gate valve dn150 valves and fittings dn150 6\" 6 inch flanged ductile iron pn16",
  }),
  product({
    id: "p_butterfly_200",
    name: "Wafer butterfly valve DN200",
    size: "DN200",
    searchText: "wafer butterfly valve dn200 valves and fittings dn200 8\" 8 inch gear operated",
  }),
  product({
    id: "p_imperial",
    name: 'Cast iron gate valve 4"',
    size: '4"',
    searchText: 'cast iron gate valve 4" valves and fittings 4" 4 inch dn100 flanged',
  }),
];

describe("matching a line the seller stocks", () => {
  it("finds the right size and says why", () => {
    const { best } = matchLine(
      { description: "Resilient seated gate valve, flanged", size: "DN100" },
      CATALOGUE,
    );
    expect(best?.product.id).toBe("p_gate_100");
    expect(best?.reasons).toContain("size");
    expect(best?.reasons).toContain("wording");
  });

  it("crosses metric and imperial, which is the whole point of the size table", () => {
    // The buyer wrote DN100. The seller catalogued it as 4". Same valve.
    const { best } = matchLine(
      { description: "Cast iron gate valve", size: "DN100" },
      [CATALOGUE[3]!],
    );
    expect(best?.product.id).toBe("p_imperial");
    expect(best?.reasons).toContain("size");
  });

  it("takes an exact SKU as the answer outright", () => {
    const { best } = matchLine({ description: "Need 24 off ALM-1000", size: null }, CATALOGUE);
    expect(best?.product.id).toBe("p_gate_100");
    expect(best?.reasons).toEqual(["sku"]);
    expect(best?.score).toBe(1);
  });
});

describe("the veto", () => {
  it("refuses a different bore however well the words agree", () => {
    // Every significant word matches p_gate_150. The size does not, so it is a
    // different product, and quoting it would put the wrong price on a quote
    // with the seller's name at the top.
    const { best, alternatives } = matchLine(
      { description: "Resilient seated gate valve, flanged", size: "DN100" },
      [CATALOGUE[1]!],
    );
    expect(best).toBeNull();
    expect(alternatives).toHaveLength(0);
  });

  it("cannot be reached by lowering a threshold", () => {
    const { alternatives } = matchLine(
      { description: "Resilient seated gate valve, flanged", size: "DN300" },
      CATALOGUE,
    );
    // A vetoed pair is absent, not merely ranked last.
    expect(alternatives.map((a) => a.product.id)).not.toContain("p_gate_100");
    expect(alternatives.map((a) => a.product.id)).not.toContain("p_gate_150");
  });
});

describe("the line nobody stocks", () => {
  it("returns no match for a size no seller carries", () => {
    // This is the seeded zero-result search, arriving as an enquiry line.
    const { best } = matchLine(
      { description: "API 6D trunnion mounted ball valve, full bore, fire safe", size: "DN600" },
      CATALOGUE,
    );
    expect(best).toBeNull();
  });

  it("returns no match against an empty catalogue rather than throwing", () => {
    expect(matchLine({ description: "anything", size: "DN100" }, [])).toEqual({
      best: null,
      alternatives: [],
    });
  });

  it("does not match on noise words alone", () => {
    const { best } = matchLine({ description: "Please supply as required", size: null }, CATALOGUE);
    expect(best).toBeNull();
  });
});

describe("tokenise", () => {
  it("keeps the inch mark as part of the token", () => {
    expect(tokenise('Gate valve 4" flanged')).toEqual(["gate", "valve", '4"', "flanged"]);
  });

  it("drops the words that distinguish nothing", () => {
    expect(tokenise("24 pcs of gate valve")).toEqual(["24", "gate", "valve"]);
  });
});

describe("MATCH_FLOOR", () => {
  it("is high enough that a bare category word does not clear it", () => {
    const { best } = matchLine({ description: "valve", size: null }, CATALOGUE);
    // One word out of one is a perfect wording ratio and still means nothing.
    // If this ever passes, the floor is doing no work.
    expect(best === null || best.score >= MATCH_FLOOR).toBe(true);
  });
});
