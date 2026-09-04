import { describe, expect, it } from "vitest";
import {
  BRANCH_TYPES,
  RADIUS_DEFAULT,
  RADIUS_MAX,
  branchGaps,
  branchIsReady,
  checkLandline,
  checkWhatsApp,
  clampRadius,
  isBranchType,
  isPinned,
  locationAllowance,
  parseRadius,
  roundCoord,
  withinUae,
} from "./branch-fields";

const READY = {
  areaId: "area_1",
  addressLine: "Warehouse 7, Al Serkal Complex, 4B Street",
  phone: "04 340 6688",
  whatsapp: "+971557041120",
  lat: 25.1281,
  lng: 55.2296,
};

describe("branch types", () => {
  it("keeps the six the schema already publishes", () => {
    // The board draws five. Re-cutting a public enum to rename two of them is a
    // migration and a rewrite of every seller's answer, for nothing a buyer sees.
    expect(BRANCH_TYPES).toHaveLength(6);
    expect(BRANCH_TYPES).toContain("trade_counter");
    expect(BRANCH_TYPES).toContain("depot");
  });

  it("leads with the place the business is run from", () => {
    expect(BRANCH_TYPES[0]).toBe("head_office");
  });

  it("refuses a value that is not one of them", () => {
    expect(isBranchType("workshop")).toBe(true);
    expect(isBranchType("showroom")).toBe(false);
    expect(isBranchType("")).toBe(false);
  });
});

describe("the service radius", () => {
  it("defaults to the figure the card states", () => {
    expect(RADIUS_DEFAULT).toBe(40);
  });

  it("reads a number a seller typed, however they typed it", () => {
    expect(parseRadius("40")).toBe(40);
    expect(parseRadius("40 km")).toBe(40);
    expect(parseRadius(" 65 ")).toBe(65);
  });

  it("treats an empty field as no delivery promise rather than a zero one", () => {
    // Null is what `coverageOf` on 1f reads as "no card". Zero would be a claim.
    expect(parseRadius("")).toBeNull();
    expect(parseRadius("0")).toBeNull();
    expect(parseRadius("abc")).toBeNull();
  });

  it("holds the number inside the range the country makes meaningful", () => {
    expect(clampRadius(0)).toBe(1);
    expect(clampRadius(9999)).toBe(RADIUS_MAX);
    expect(clampRadius(40.4)).toBe(40);
  });
});

describe("the pin", () => {
  it("rounds to six decimals, which is about eleven centimetres", () => {
    expect(roundCoord(25.128134567891234)).toBe(25.128135);
    expect(roundCoord(55.2296)).toBe(55.2296);
  });

  it("accepts a point inside the country", () => {
    expect(withinUae(25.1281, 55.2296)).toBe(true);
    // Al Ain, hard against the Omani border.
    expect(withinUae(24.2075, 55.7447)).toBe(true);
  });

  it("refuses one that is not a UAE branch", () => {
    expect(withinUae(51.5074, -0.1278)).toBe(false);
    expect(withinUae(Number.NaN, 55.2296)).toBe(false);
  });

  it("is pinned only with both coordinates", () => {
    expect(isPinned({ lat: 25.1, lng: 55.2 })).toBe(true);
    expect(isPinned({ lat: 25.1, lng: null })).toBe(false);
    expect(isPinned({ lat: null, lng: null })).toBe(false);
  });
});

describe("the landline", () => {
  it("takes a UAE landline however it is written", () => {
    expect(checkLandline("04 340 6688")).toEqual({ ok: true, value: "04 340 6688" });
    expect(checkLandline("+971 4 340 6688").ok).toBe(true);
    expect(checkLandline("06 534 1200").ok).toBe(true);
  });

  it("takes a toll-free switchboard", () => {
    expect(checkLandline("800 82255").ok).toBe(true);
  });

  it("refuses a mobile, because the area code is the point of this field", () => {
    // 04 tells a buyer this supplier is in Dubai. A mobile loses that, and it
    // would pass any check that only counted digits.
    expect(checkLandline("050 641 2288")).toEqual({ ok: false, problem: "not_a_landline" });
  });

  it("refuses something that is not a number at all", () => {
    expect(checkLandline("ring the yard")).toEqual({ ok: false, problem: "not_a_number" });
  });

  it("treats blank as absent rather than wrong", () => {
    expect(checkLandline("   ")).toEqual({ ok: true, value: null });
  });
});

describe("WhatsApp", () => {
  it("stores E.164, because that is what the link dials", () => {
    expect(checkWhatsApp("055 704 1120")).toEqual({ ok: true, value: "+971557041120" });
    expect(checkWhatsApp("+971 55 704 1120")).toEqual({ ok: true, value: "+971557041120" });
  });

  it("refuses a landline, which would be a dead wa.me link", () => {
    expect(checkWhatsApp("04 340 6688")).toEqual({ ok: false, problem: "not_a_mobile" });
  });

  it("treats blank as absent", () => {
    expect(checkWhatsApp("")).toEqual({ ok: true, value: null });
  });
});

describe("what Continue checks", () => {
  it("passes a branch with an area, an address, a number and a pin", () => {
    expect(branchIsReady(READY)).toBe(true);
    expect(branchGaps(READY)).toEqual([]);
  });

  it("blocks on a missing pin", () => {
    // Criterion 4. Without coordinates the listing cannot reach the area page
    // that publishing it is for.
    expect(branchGaps({ ...READY, lat: null, lng: null })).toEqual(["pin"]);
  });

  it("blocks on a missing area or address", () => {
    expect(branchGaps({ ...READY, areaId: null })).toEqual(["area"]);
    expect(branchGaps({ ...READY, addressLine: "  " })).toEqual(["address"]);
  });

  it("accepts either number, and blocks when there is neither", () => {
    expect(branchGaps({ ...READY, phone: null })).toEqual([]);
    expect(branchGaps({ ...READY, whatsapp: null })).toEqual([]);
    expect(branchGaps({ ...READY, phone: null, whatsapp: null })).toEqual(["contact"]);
  });

  it("does not ask for hours", () => {
    // Criterion 5: a branch with none renders "Hours not provided" on 1f, which
    // is honest and fixable later.
    expect(branchIsReady(READY)).toBe(true);
  });

  it("reports every gap, not the first", () => {
    const empty = { areaId: null, addressLine: "", phone: null, whatsapp: null, lat: null, lng: null };
    expect(branchGaps(empty)).toEqual(["area", "address", "contact", "pin"]);
  });
});

describe("the location counter", () => {
  it("counts branches used against the plan's cap", () => {
    expect(locationAllowance(3, "Basic", 1)).toEqual({
      used: 1,
      cap: 3,
      planName: "Basic",
      canAddMore: true,
    });
  });

  it("closes the add control on Free, where one location is the whole plan", () => {
    // Criterion 2: the control becomes an upgrade link rather than a button
    // that would be refused on click.
    expect(locationAllowance(1, "Free", 1).canAddMore).toBe(false);
  });

  it("never closes it on an uncapped plan", () => {
    expect(locationAllowance(null, "Pro", 40).canAddMore).toBe(true);
  });

  it("keeps the counter honest when a downgrade left a seller over the cap", () => {
    const allowance = locationAllowance(1, "Free", 3);
    expect(allowance.used).toBe(3);
    expect(allowance.canAddMore).toBe(false);
  });
});
