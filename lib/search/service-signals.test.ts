import { describe, expect, it } from "vitest";
import {
  coverageMatch,
  coversTarget,
  matchedServices,
  scopeCompleteness,
  type RankableService,
} from "./service-signals";

/**
 * Board `12c-s` B3 and B4 — scope completeness and coverage match, without a
 * database.
 */

const COMPLETE = {
  name: "Statutory audit",
  engagementType: "one_off_job",
  feeBasis: "per_engagement",
  turnaround: "3–4 weeks from complete records",
  deliveredWhere: "remote",
  deliverable: "Signed audit report",
} as const;

function service(
  overrides: Partial<RankableService & { name: string | null }> = {},
): RankableService & { name: string | null } {
  return {
    ...(COMPLETE as unknown as RankableService),
    categoryId: "audit",
    coverage: [],
    ...overrides,
  };
}

describe("B3 — scope completeness is measured the way spec completeness is", () => {
  it("is null with no live service — nothing to fill in, not zero", () => {
    expect(scopeCompleteness([])).toBeNull();
  });

  it("counts a sheet only at six of six", () => {
    expect(scopeCompleteness([service()])).toBe(1);
    expect(scopeCompleteness([service({ deliverable: null })])).toBe(0);
  });

  it("is complete sheets out of sheets, to two places", () => {
    expect(scopeCompleteness([service(), service({ turnaround: null }), service()])).toBe(0.67);
  });

  it("does not count whitespace as an answer", () => {
    expect(scopeCompleteness([service({ turnaround: "   " })])).toBe(0);
  });
});

describe("coverage reaches a place at the right scale", () => {
  const dubai = { emirate: "dubai" as const, areaId: null };
  const alQuoz = { emirate: "dubai" as const, areaId: "al-quoz" };
  const deira = { emirate: "dubai" as const, areaId: "deira" };

  it("an emirate-wide claim reaches every area inside it", () => {
    expect(coversTarget([dubai], alQuoz)).toBe(true);
  });

  it("an area claim reaches its emirate when that is all the buyer named", () => {
    expect(coversTarget([deira], dubai)).toBe(true);
  });

  it("an area claim does not reach a different area", () => {
    expect(coversTarget([deira], alQuoz)).toBe(false);
  });

  it("nothing reaches another emirate", () => {
    expect(coversTarget([dubai], { emirate: "sharjah", areaId: null })).toBe(false);
  });
});

describe("B4 — coverage match resolves per matched service, never from the union", () => {
  const sharjah = { emirate: "sharjah" as const, areaId: null };
  const dubai = { emirate: "dubai" as const, areaId: null };
  const target = { emirate: "sharjah" as const, areaId: null };

  it("is unknown where the buyer named no place", () => {
    expect(coverageMatch({ target: null, businessDefault: [dubai], matched: [service()] })).toBeNull();
  });

  it("is unknown where the listing has stated no coverage at all", () => {
    expect(coverageMatch({ target, businessDefault: [], matched: [service()] })).toBeNull();
  });

  it("scores a matched service that inherits a default reaching the place", () => {
    expect(coverageMatch({ target, businessDefault: [sharjah], matched: [service()] })).toBe(true);
  });

  it("refuses a matched service that narrowed itself away, even though the default reaches", () => {
    const narrowed = service({ coverage: [dubai] });
    expect(coverageMatch({ target, businessDefault: [sharjah], matched: [narrowed] })).toBe(false);
  });

  it("does not lend an unmatched service's reach to the listing", () => {
    // The practice whose listing reads seven emirates because one service
    // covers them: that service is not the one the query matched.
    const audit = service({ categoryId: "audit", coverage: [] });
    const payroll = service({ categoryId: "payroll", coverage: [sharjah] });
    const matched = matchedServices([audit, payroll], { categoryIds: ["audit"] });
    expect(matched).toEqual([audit]);
    expect(coverageMatch({ target, businessDefault: [dubai], matched })).toBe(false);
  });

  it("falls back to the default when no service matched, which is not the union either", () => {
    const wide = service({ categoryId: "payroll", coverage: [sharjah] });
    const matched = matchedServices([wide], { categoryIds: ["audit"] });
    expect(matched).toEqual([]);
    expect(coverageMatch({ target, businessDefault: [dubai], matched })).toBe(false);
  });
});

describe("which services a query matched", () => {
  const audit = service({ name: "Statutory audit", categoryId: "audit" });
  const vat = service({ name: "VAT registration", categoryId: "tax" });

  it("is the services filed under the scope's categories", () => {
    expect(matchedServices([audit, vat], { categoryIds: ["tax"] })).toEqual([vat]);
  });

  it("is the services whose name holds a word typed, with no category scope", () => {
    expect(matchedServices([audit, vat], { words: ["vat"] })).toEqual([vat]);
  });

  it("is none with neither — the caller then reads the default", () => {
    expect(matchedServices([audit, vat], {})).toEqual([]);
  });
});
