import { describe, expect, it } from "vitest";
import { bandsProblem, parseBands } from "./bands";
import {
  bandFor,
  compare,
  isNearMiss,
  licenceParts,
  sameDistrict,
  licenceDigits,
  nameSimilarity,
  nameTokens,
  phoneKey,
  withoutIdentifiers,
  type Listing,
} from "./similarity";

/**
 * Board 12b's bands.
 *
 * The tests that matter here are the ones about the middle. Above 90% a bulk
 * merge is safe; below 60% it is not a match; and the band between is where
 * merging two genuinely separate companies destroys reviews.
 */

const listing = (over: Partial<Listing> = {}): Listing => ({
  id: "a",
  tradeName: "Al Marwan Industrial Supplies LLC",
  licenceNumber: "DED-618402",
  licenceAuthority: "DED",
  emirate: "dubai",
  areaId: "area_quoz",
  addressLine: "Warehouse 12, Street 8, Al Quoz Industrial 1",
  phones: ["+97143472290"],
  ...over,
});

describe("the pieces", () => {
  it("reads a licence number as its digits", () => {
    expect(licenceDigits("DED-618402")).toBe("618402");
    expect(licenceDigits("618402")).toBe("618402");
  });

  it("drops the words every second company shares", () => {
    // "LLC", "General", "Trading" identify nobody.
    expect(nameTokens("Al Marwan General Trading LLC")).toEqual(["al", "marwan"]);
  });

  it("compares names by their identifying words, in any order", () => {
    expect(nameSimilarity("Al Marwan Trading LLC", "Al Marwan General Trading LLC")).toBe(1);
    expect(nameSimilarity("Marwan Al Supplies", "Al Marwan Supplies")).toBe(1);
    expect(nameSimilarity("Al Marwan Trading", "Gulf Line Trading")).toBe(0);
  });

  it("reads a UAE number written either way as the same number", () => {
    // The international form drops the trunk zero the local form keeps.
    expect(phoneKey("+971 4 347 2290")).toBe(phoneKey("04 347 2290"));
    expect(phoneKey("00971502048817")).toBe(phoneKey("0502048817"));
    expect(phoneKey("+971502048817")).toBe("502048817");
  });

  it("puts a score in a band", () => {
    expect(bandFor(0.95)).toBe("certain");
    expect(bandFor(0.9)).toBe("certain");
    expect(bandFor(0.74)).toBe("probable");
    expect(bandFor(0.6)).toBe("probable");
    expect(bandFor(0.59)).toBe("unlikely");
  });
});

describe("two records of one company", () => {
  it("is certain when the licence number and the name agree", () => {
    const result = compare(
      listing(),
      listing({ id: "b", tradeName: "Al Marwan Industrial Supplies" }),
    );
    expect(result.band).toBe("certain");
    expect(result.signals.map((s) => s.key)).toContain("licence_number");
  });

  it("names the authorities when a licence number matches across them", () => {
    // A company that moved from mainland to a free zone keeps its number style.
    const result = compare(
      listing(),
      listing({ id: "b", licenceAuthority: "JAFZA" }),
    );
    const signal = result.signals.find((s) => s.key === "licence_number")!;
    expect(signal.detail).toContain("DED");
    expect(signal.detail).toContain("JAFZA");
  });
});

describe("the band that destroys reviews if it is got wrong", () => {
  it("puts a same-name, different-licence pair in the middle", () => {
    const result = compare(
      listing(),
      listing({
        id: "b",
        licenceNumber: "DED-771203",
        phones: ["+97143472290"],
      }),
    );
    expect(result.band).toBe("probable");
    // And the screen can say why: the names and the phone, not the licence.
    expect(result.signals.map((s) => s.key)).not.toContain("licence_number");
    expect(result.signals.map((s) => s.key)).toContain("trade_name");
  });

  it("names every signal that agreed, so the number can be argued with", () => {
    const result = compare(listing(), listing({ id: "b", licenceNumber: "DED-771203" }));
    for (const signal of result.signals) {
      expect(signal.detail.length).toBeGreaterThan(0);
      expect(signal.strength).toBeGreaterThan(0);
      expect(signal.strength).toBeLessThanOrEqual(1);
    }
  });
});

describe("two companies sharing a building", () => {
  /*
   * The shape this whole weighting exists to refuse. Two tenants in one
   * industrial unit share the landlord's switchboard, the street address and
   * the area — and are entirely different companies.
   */
  const tenantA = listing({
    tradeName: "Al Marwan Industrial Supplies LLC",
    licenceNumber: "DED-618402",
  });
  const tenantB = listing({
    id: "b",
    tradeName: "Kestrel Technical Services LLC",
    licenceNumber: "DED-902551",
  });

  it("is not a match, however much of the building they share", () => {
    const result = compare(tenantA, tenantB);
    expect(result.band).toBe("unlikely");
    expect(result.score).toBeLessThan(0.6);
  });

  it("still names what they do share", () => {
    const result = compare(tenantA, tenantB);
    const keys = result.signals.map((s) => s.key);
    expect(keys).toContain("phone");
    expect(keys).toContain("same_area");
  });

  it("is flagged as having no identifier agreeing", () => {
    // Neither the licence nor the name. Nothing built on address and phone
    // alone may reach the certain band.
    expect(withoutIdentifiers(compare(tenantA, tenantB))).toBe(true);
  });

  it("cannot reach the certain band on shared premises alone", () => {
    const result = compare(tenantA, tenantB);
    expect(result.score).toBeLessThan(0.6);
  });
});

describe("the safety property", () => {
  it("no pair reaches the certain band without a licence number agreeing", () => {
    /*
     * The whole reason scoring is two paths rather than one weighted sum. A
     * linear sum lets enough weak signals add up to a bulk merge, and a bulk
     * merge of two separate companies destroys reviews.
     */
    const everything = compare(
      listing({ licenceNumber: "DED-618402" }),
      listing({ id: "b", licenceNumber: "SHJ-990011", licenceAuthority: "SHJ" }),
    );
    expect(withoutIdentifiers(everything)).toBe(false); // the names agree
    expect(everything.band).not.toBe("certain");
    expect(everything.score).toBeLessThan(0.9);
  });

  it("a licence match alone is certain, because it is an identifier", () => {
    const result = compare(
      listing(),
      listing({ id: "b", tradeName: "Completely Different Name FZE", phones: [], addressLine: null, areaId: null }),
    );
    expect(result.band).toBe("certain");
    // And it sits at the floor, so it is the first pair a person looks at.
    expect(result.score).toBe(0.9);
  });
});

describe("two unrelated listings", () => {
  it("score nothing when nothing agrees", () => {
    const result = compare(
      listing(),
      listing({
        id: "b",
        tradeName: "Southbank Packaging FZE",
        licenceNumber: "SAIF-330011",
        licenceAuthority: "SAIF",
        emirate: "sharjah",
        areaId: "area_saif",
        addressLine: "Office 4, SAIF Zone",
        phones: ["+97165551234"],
      }),
    );
    expect(result.score).toBe(0);
    expect(result.band).toBe("unlikely");
    expect(result.signals).toEqual([]);
  });
});

/* ── Board 12b ───────────────────────────────────────────────────────────── */

describe("a branch licence", () => {
  it("reads the root and the suffix", () => {
    expect(licenceParts("DED-441908-01")).toEqual({ root: "441908", suffix: "01" });
    expect(licenceParts("DED-441908")).toEqual({ root: "441908", suffix: null });
    expect(licenceParts("SAIF 40119/2")).toEqual({ root: "40119", suffix: "2" });
  });

  it("does not guess a suffix inside a run of digits", () => {
    expect(licenceParts("DED-44190801")).toEqual({ root: "44190801", suffix: null });
  });

  it("puts a branch of a claimed company in the manual band, never the bulk one", () => {
    // Board 12b's pair: licence root, phone, most of the name, the next area
    // along, the same activity — and still a person's decision.
    const result = compare(
      listing({
        tradeName: "Gulf Cool Technical Services LLC",
        licenceNumber: "DED-441908",
        areaId: "quoz3",
        areaName: "Al Quoz Industrial 3",
        phones: ["043406688"],
        activityKey: "air conditioning equipment trading",
      }),
      listing({
        id: "b",
        tradeName: "Gulf Cool Technical Services (Branch)",
        licenceNumber: "DED-441908-01",
        areaId: "quoz4",
        areaName: "Al Quoz Industrial 4",
        phones: ["04 340 6688"],
        activityKey: "air conditioning equipment trading",
      }),
    );
    expect(result.band).toBe("probable");
    expect(result.signals.map((s) => s.key)).toEqual(
      expect.arrayContaining(["licence_root", "phone", "trade_name", "nearby_area", "activity"]),
    );
    expect(result.signals.map((s) => s.key)).not.toContain("licence_number");
  });

  it("is not a match on the root alone", () => {
    const result = compare(
      listing({ licenceNumber: "DED-441908" }),
      listing({
        id: "b",
        tradeName: "Unrelated Name FZE",
        licenceNumber: "DED-441908-02",
        phones: [],
        addressLine: null,
        areaId: null,
      }),
    );
    expect(result.band).toBe("unlikely");
    // But it identifies something, so it is counted under the floor (B10).
    expect(isNearMiss(result)).toBe(true);
  });
});

describe("the district", () => {
  it("is one district when only the number differs", () => {
    expect(sameDistrict("Al Quoz Industrial 3", "Al Quoz Industrial 4")).toBe(true);
  });

  it("is not a district shared by the word Industrial", () => {
    expect(sameDistrict("Al Quoz Industrial 3", "Ras Al Khor Industrial 2")).toBe(false);
    expect(sameDistrict("Deira", "Deira")).toBe(false); // that is the same area, not a nearby one
  });
});

describe("the bands a tuning may set", () => {
  it("scores against the tuned lines", () => {
    const result = compare(listing(), listing({ id: "b", licenceNumber: "DED-771203" }), {
      floor: 0.4,
      certain: 0.95,
    });
    expect(result.band).toBe("probable");
  });

  it("refuses a certain line that would let circumstance bulk-merge", () => {
    expect(bandsProblem({ floor: 0.6, certain: 0.85 })).toBe("certain_too_low");
    expect(bandsProblem({ floor: 0.3, certain: 0.9 })).toBe("floor_too_low");
    expect(bandsProblem({ floor: 0.88, certain: 0.9 })).toBe("band_too_narrow");
    expect(bandsProblem({ floor: 0.55, certain: 0.95 })).toBeNull();
  });

  it("reads a malformed setting as the default rather than as whatever it says", () => {
    expect(parseBands({ floor: "x", certain: 0.9 })).toEqual({ floor: 0.6, certain: 0.9 });
    expect(parseBands({ floor: 0.5, certain: 0.8 })).toEqual({ floor: 0.6, certain: 0.9 });
    expect(parseBands({ floor: 0.5, certain: 0.92 })).toEqual({ floor: 0.5, certain: 0.92 });
  });
});
