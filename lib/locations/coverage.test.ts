import { describe, expect, it } from "vitest";
import {
  alreadyCovered,
  isLeadTimeChoice,
  isRedundant,
  isStorableLeadTime,
  LEAD_TIME_CHOICES,
  orderCoverage,
  sameScope,
} from "./coverage";

const dubai = { emirate: "dubai" as const, areaId: null };
const alQuoz = { emirate: "dubai" as const, areaId: "area-quoz" };
const sharjah = { emirate: "sharjah" as const, areaId: null };

describe("lead times", () => {
  it("offers same day as zero, not as a missing value", () => {
    expect(LEAD_TIME_CHOICES[0]).toBe(0);
    expect(isLeadTimeChoice(0)).toBe(true);
    expect(isStorableLeadTime(0)).toBe(true);
  });

  it("refuses what the column would refuse", () => {
    expect(isStorableLeadTime(-1)).toBe(false);
    expect(isStorableLeadTime(337)).toBe(false);
    expect(isStorableLeadTime(1.5)).toBe(false);
  });

  it("stores a value the picker does not offer, so a retired band still renders", () => {
    expect(isLeadTimeChoice(36)).toBe(false);
    expect(isStorableLeadTime(36)).toBe(true);
  });
});

describe("sameScope", () => {
  it("compares emirates when neither names an area", () => {
    expect(sameScope(dubai, { emirate: "dubai", areaId: null })).toBe(true);
    expect(sameScope(dubai, sharjah)).toBe(false);
  });

  it("does not confuse an emirate with an area inside it", () => {
    // Both are legitimate rows and the database accepts both: a supplier can
    // cover Dubai in 48 hours and Al Quoz the same day.
    expect(sameScope(dubai, alQuoz)).toBe(false);
  });
});

describe("alreadyCovered", () => {
  it("refuses the same scope twice", () => {
    expect(alreadyCovered([dubai, sharjah], { emirate: "dubai", areaId: null })).toBe(true);
    expect(alreadyCovered([dubai], alQuoz)).toBe(false);
  });
});

describe("isRedundant", () => {
  it("flags an area promise its emirate already makes at the same speed", () => {
    const existing = [{ ...dubai, leadTimeHours: 48 }];
    expect(isRedundant(existing, { ...alQuoz, leadTimeHours: 48 })).toBe(true);
  });

  it("says nothing about an area promise that is faster", () => {
    // Narrowing is the case the two scales exist for.
    const existing = [{ ...dubai, leadTimeHours: 48 }];
    expect(isRedundant(existing, { ...alQuoz, leadTimeHours: 0 })).toBe(false);
  });

  it("never calls an emirate row redundant", () => {
    const existing = [{ ...alQuoz, leadTimeHours: 0 }];
    expect(isRedundant(existing, { ...dubai, leadTimeHours: 0 })).toBe(false);
  });
});

describe("orderCoverage", () => {
  it("leads with the broadest claim, then the fastest", () => {
    const names: Record<string, string> = { "area-quoz": "Al Quoz", "area-khor": "Ras Al Khor" };
    const rows = [
      { ...alQuoz, leadTimeHours: 0, id: "quoz" },
      { emirate: "dubai" as const, areaId: "area-khor", leadTimeHours: 24, id: "khor" },
      { ...sharjah, leadTimeHours: 24, id: "shj" },
      { ...dubai, leadTimeHours: 48, id: "dxb" },
    ];
    expect(orderCoverage(rows, (id) => names[id] ?? "").map((row) => row.id)).toEqual([
      "shj",
      "dxb",
      "quoz",
      "khor",
    ]);
  });
});
