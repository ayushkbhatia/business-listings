import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CARRIED_OVER_CHIPS,
  CHIP_CAP,
  chipHref,
  chipLabelProblem,
  featureBlock,
  firstFreePosition,
  normaliseChipQuery,
  orderProblem,
  slotOrder,
  type FeatureFacts,
} from "./homepage-rules";

/**
 * Board 6h — the rules the console and the home page share.
 */

const NOW = new Date("2026-09-14T08:00:00Z");
const verified: FeatureFacts = {
  verificationTier: 2,
  licenceExpiry: new Date("2027-04-14T00:00:00Z"),
  suspendedAt: null,
  publishedAt: new Date("2026-01-01T00:00:00Z"),
  mergedIntoId: null,
  closureRequestedAt: null,
  closedAt: null,
};

describe("featureBlock (B1)", () => {
  it("lets Tier 2 through and nothing below it", () => {
    expect(featureBlock(verified, NOW)).toBeNull();
    expect(featureBlock({ ...verified, verificationTier: 1 }, NOW)).toBe("licence_unchecked");
    expect(featureBlock({ ...verified, verificationTier: 0 }, NOW)).toBe("not_verified");
  });

  it("names a lapsed licence when the sweep has dropped the tier, and trusts the tier until it has", () => {
    const expired = new Date("2026-09-01T00:00:00Z");
    expect(featureBlock({ ...verified, verificationTier: 1, licenceExpiry: expired }, NOW)).toBe("licence_lapsed");
    // The date alone does not vacate the slot: "out of the rail on the next expiry pass".
    expect(featureBlock({ ...verified, licenceExpiry: expired }, NOW)).toBeNull();
  });

  it("puts the decisions that take a listing out of the directory ahead of the tier", () => {
    const at = new Date("2026-09-10T00:00:00Z");
    expect(featureBlock({ ...verified, suspendedAt: at }, NOW)).toBe("suspended");
    expect(featureBlock({ ...verified, publishedAt: null }, NOW)).toBe("unpublished");
    expect(featureBlock({ ...verified, closureRequestedAt: at }, NOW)).toBe("closed");
    expect(featureBlock({ ...verified, closedAt: at, suspendedAt: at }, NOW)).toBe("closed");
    expect(featureBlock({ ...verified, mergedIntoId: "b2", suspendedAt: at }, NOW)).toBe("merged");
  });

  it("has no input a plan or a payment could reach (B4)", () => {
    // A type-level promise, checked at runtime: the facts are the tier and the directory's own states.
    expect(Object.keys(verified).sort()).toEqual(
      ["closedAt", "closureRequestedAt", "licenceExpiry", "mergedIntoId", "publishedAt", "suspendedAt", "verificationTier"].sort(),
    );
  });
});

describe("slots (B2, B6)", () => {
  const held = [
    { position: 1, businessId: "a" },
    { position: 3, businessId: "c" },
  ];

  it("reads four positions with the gaps where they are", () => {
    expect(slotOrder(held)).toEqual(["a", null, "c", null]);
    expect(firstFreePosition(held)).toBe(2);
    expect(firstFreePosition([1, 2, 3, 4].map((position) => ({ position, businessId: String(position) })))).toBeNull();
  });

  it("accepts the same businesses in new places, and nothing else", () => {
    const current = ["a", null, "c", null];
    expect(orderProblem(current, ["c", "a", null, null])).toBeNull();
    expect(orderProblem(current, ["c", "a", null])).toBe("wrong_length");
    expect(orderProblem(current, ["a", "a", null, null])).toBe("duplicate");
    expect(orderProblem(current, ["a", "b", null, null])).toBe("different_members");
    expect(orderProblem(current, ["a", null, null, null])).toBe("different_members");
  });
});

describe("chips (B8)", () => {
  it("turns plain words into the search they run", () => {
    expect(normaliseChipQuery("  HVAC maintenance AMC ")).toEqual({ ok: true, query: "q=HVAC+maintenance+AMC" });
  });

  it("keeps a pasted results address's facets and drops what is a visit, not a search", () => {
    expect(normaliseChipQuery("/search?q=gate+valve&emirate=dubai&freeZone=1&page=4&view=grid&utm_source=x")).toEqual({
      ok: true,
      query: "q=gate+valve&emirate=dubai&freeZone=1",
    });
    expect(normaliseChipQuery("https://example.ae/search?tab=products&q=pumps")).toEqual({ ok: true, query: "q=pumps&tab=products" });
    expect(normaliseChipQuery("q=racking&emirate=sharjah")).toEqual({ ok: true, query: "q=racking&emirate=sharjah" });
  });

  it("refuses what the results page cannot run", () => {
    expect(normaliseChipQuery("   ")).toEqual({ ok: false, error: "query_empty" });
    expect(normaliseChipQuery("/guides/trade-licence")).toEqual({ ok: false, error: "query_not_search" });
    expect(normaliseChipQuery("/search?page=2&sort=rating")).toEqual({ ok: false, error: "query_no_terms" });
    expect(normaliseChipQuery("x".repeat(600))).toEqual({ ok: false, error: "query_too_long" });
    expect(chipLabelProblem("A")).toBe("label_length");
    expect(chipLabelProblem("x".repeat(41))).toBe("label_length");
    expect(chipLabelProblem("Steel fabrication")).toBeNull();
  });

  it("is stable: a stored query normalises to itself", () => {
    for (const chip of CARRIED_OVER_CHIPS) {
      expect(normaliseChipQuery(chipHref(chip.query))).toEqual({ ok: true, query: chip.query });
    }
  });
});

describe("the chips the migration carried over", () => {
  it("are the six the code knows, in the same order, and no more than the cap", () => {
    const sql = readFileSync(join(process.cwd(), "prisma/migrations/20261028100000_homepage_curation_6h/migration.sql"), "utf8");
    const rows = [...sql.matchAll(/\('curated_query_6h_(\d)', '([^']+)', '([^']+)', (\d)\)/g)].map((match) => ({
      label: match[2],
      query: match[3],
      position: Number(match[4]),
    }));
    expect(rows).toEqual(CARRIED_OVER_CHIPS.map((chip, index) => ({ ...chip, position: index + 1 })));
    expect(rows.length).toBeLessThanOrEqual(CHIP_CAP);
  });
});
