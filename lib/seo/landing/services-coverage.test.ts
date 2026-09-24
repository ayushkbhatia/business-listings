import { describe, expect, it } from "vitest";
import {
  branchInPlace,
  emiratesReached,
  inTrade,
  membershipOf,
  reachesPlace,
  type CoverageFirm,
} from "./services-coverage";

/**
 * Board `6a-s` B1 — which firms a services landing page is about.
 *
 * The rule the route, the gate, the sitemap, the matrices and the snapshot all
 * read, tested where it lives. Each case is one of the ways the page is built
 * wrong: as a location filter, as the business union, or by forgetting that a
 * firm reaches a trade through a service it publishes as well as through the
 * categories it is filed under.
 */

const VAT = "vat";
const AUDIT = "audit";
const TRADE = new Set([VAT]);

const BUSINESS_BAY = { emirate: "dubai" as const, areaId: "business-bay" };
const DOWNTOWN = { emirate: "dubai" as const, areaId: "downtown" };
const DUBAI = { emirate: "dubai" as const, areaId: null };

function firm(over: Partial<CoverageFirm>): CoverageFirm {
  return {
    primaryCategoryId: "elsewhere",
    categoryIds: [],
    services: [],
    coverageDefault: [],
    branches: [],
    ...over,
  };
}

describe("B1 — coverage, not address", () => {
  it("lists a firm with no Business Bay address whose service covers it", () => {
    const remote = firm({
      primaryCategoryId: VAT,
      coverageDefault: [{ emirate: "dubai", areaId: null }],
      services: [{ id: "s1", categoryId: VAT, coverage: [] }],
      branches: [{ emirate: "dubai", areaId: "deira" }],
    });
    expect(membershipOf(remote, TRADE, BUSINESS_BAY)).toEqual({
      reach: "coverage",
      tradeServiceIds: ["s1"],
      answeringServiceIds: ["s1"],
    });
  });

  it("reads an area row as that area, and an emirate row as every area in it", () => {
    const set = [{ emirate: "dubai" as const, areaId: "business-bay" }];
    expect(reachesPlace(set, BUSINESS_BAY)).toBe(true);
    expect(reachesPlace(set, DOWNTOWN)).toBe(false);
    expect(reachesPlace([{ emirate: "dubai", areaId: null }], DOWNTOWN)).toBe(true);
    expect(reachesPlace([{ emirate: "sharjah", areaId: null }], DOWNTOWN)).toBe(false);
  });

  it("lets any row in an emirate reach the emirate — a firm in Business Bay works in Dubai", () => {
    expect(reachesPlace([{ emirate: "dubai", areaId: "business-bay" }], DUBAI)).toBe(true);
  });
});

describe("coverage resolves per service, never the business union", () => {
  it("leaves out a firm whose service in this trade is narrowed elsewhere, whatever its default says", () => {
    const narrowed = firm({
      primaryCategoryId: VAT,
      coverageDefault: [{ emirate: "dubai", areaId: null }],
      services: [{ id: "s1", categoryId: VAT, coverage: [{ emirate: "abu_dhabi", areaId: null }] }],
    });
    expect(membershipOf(narrowed, TRADE, BUSINESS_BAY)).toBeNull();
    expect(membershipOf(narrowed, TRADE, DUBAI)).toBeNull();
  });

  it("does not let a service in another trade lend its reach", () => {
    const auditReaches = firm({
      primaryCategoryId: VAT,
      services: [
        { id: "vat", categoryId: VAT, coverage: [{ emirate: "sharjah", areaId: null }] },
        { id: "audit", categoryId: AUDIT, coverage: [{ emirate: "dubai", areaId: null }] },
      ],
    });
    expect(membershipOf(auditReaches, TRADE, BUSINESS_BAY)).toBeNull();
  });

  it("names the services that reach first, and keeps the ones that do not", () => {
    const two = firm({
      primaryCategoryId: VAT,
      coverageDefault: [{ emirate: "dubai", areaId: null }],
      services: [
        { id: "far", categoryId: VAT, coverage: [{ emirate: "sharjah", areaId: null }] },
        { id: "near", categoryId: VAT, coverage: [] },
      ],
    });
    expect(membershipOf(two, TRADE, BUSINESS_BAY)).toEqual({
      reach: "coverage",
      tradeServiceIds: ["far", "near"],
      answeringServiceIds: ["near"],
    });
  });
});

describe("in the trade", () => {
  it("counts a live service filed in the trade, from a firm filed somewhere else", () => {
    const auditFirmWithVat = firm({
      primaryCategoryId: AUDIT,
      coverageDefault: [{ emirate: "dubai", areaId: null }],
      services: [{ id: "vat", categoryId: VAT, coverage: [] }],
    });
    expect(inTrade(auditFirmWithVat, TRADE)).toBe(true);
    expect(membershipOf(auditFirmWithVat, TRADE, BUSINESS_BAY)?.reach).toBe("coverage");
  });

  it("reads a firm listed in the trade with no service in it on its default", () => {
    const listed = firm({ categoryIds: [VAT], coverageDefault: [{ emirate: "dubai", areaId: null }] });
    expect(membershipOf(listed, TRADE, BUSINESS_BAY)?.reach).toBe("coverage");
    expect(membershipOf(listed, TRADE, { emirate: "sharjah", areaId: null })).toBeNull();
  });

  it("ignores a firm with nothing in the trade, wherever it works", () => {
    const other = firm({ coverageDefault: [{ emirate: "dubai", areaId: null }] });
    expect(membershipOf(other, TRADE, BUSINESS_BAY)).toBeNull();
    expect(emiratesReached(other, TRADE)).toEqual([]);
  });
});

describe("an office is presence", () => {
  it("lists an unclaimed import by its Business Bay address, and says it is an office", () => {
    const office = firm({ primaryCategoryId: VAT, branches: [{ emirate: "dubai", areaId: "business-bay" }] });
    expect(membershipOf(office, TRADE, BUSINESS_BAY)?.reach).toBe("branch");
    expect(membershipOf(office, TRADE, DOWNTOWN)).toBeNull();
    expect(membershipOf(office, TRADE, DUBAI)?.reach).toBe("branch");
  });

  it("says both where an office sits in a place the service also covers", () => {
    const both = firm({
      primaryCategoryId: VAT,
      coverageDefault: [{ emirate: "dubai", areaId: null }],
      services: [{ id: "s", categoryId: VAT, coverage: [] }],
      branches: [{ emirate: "dubai", areaId: "business-bay" }],
    });
    expect(membershipOf(both, TRADE, BUSINESS_BAY)?.reach).toBe("both");
  });

  it("places a branch by its area at area scale and by its emirate at emirate scale", () => {
    const branch = { emirate: "dubai" as const, areaId: "deira" };
    expect(branchInPlace(branch, BUSINESS_BAY)).toBe(false);
    expect(branchInPlace(branch, DUBAI)).toBe(true);
  });
});

describe("emiratesReached — the snapshot's and the index's question", () => {
  it("agrees with membershipOf at emirate scale for every emirate", () => {
    const shaped = firm({
      primaryCategoryId: VAT,
      coverageDefault: [{ emirate: "dubai", areaId: null }],
      services: [
        { id: "a", categoryId: VAT, coverage: [{ emirate: "sharjah", areaId: "sharjah-industrial" }] },
        { id: "b", categoryId: VAT, coverage: [] },
      ],
      branches: [{ emirate: "ajman", areaId: "ajman-industrial" }],
    });
    const reached = new Set(emiratesReached(shaped, TRADE));
    for (const emirate of ["dubai", "sharjah", "ajman", "abu_dhabi", "fujairah"] as const) {
      expect(reached.has(emirate), emirate).toBe(
        membershipOf(shaped, TRADE, { emirate, areaId: null }) !== null,
      );
    }
  });
});
