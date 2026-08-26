import { describe, expect, it } from "vitest";
import {
  categorySlugFor,
  classify,
  hasReadableTradeName,
  isOutOfScope,
  normaliseEmirate,
  tally,
  type LicenceRecord,
} from "./classify";

/**
 * Criterion 1's classifier, in the pure.
 *
 * The bias under test throughout is toward **queueing rather than rejecting**.
 * A record we cannot categorise costs somebody an afternoon; a record we
 * wrongly reject is a supplier who is not in the directory and will never know
 * why.
 */

const NOW = new Date("2026-08-26T00:00:00Z");

const record = (over: Partial<LicenceRecord> = {}): LicenceRecord => ({
  tradeName: "Al Marwan Industrial Supplies LLC",
  licenceNumber: "DED-618402",
  licenceAuthority: "DED",
  licenceExpiry: new Date("2027-03-01T00:00:00Z"),
  emirate: "Dubai",
  areaName: "Al Quoz Industrial 1",
  activity: "Trading in Valves & Pipe Fittings",
  phone: "+97143472290",
  ...over,
});

describe("a readable trade name", () => {
  it("accepts a real one", () => {
    expect(hasReadableTradeName("Al Marwan Industrial Supplies LLC")).toBe(true);
  });

  it("refuses the shapes an export actually carries", () => {
    for (const value of ["", "  ", "-", "--", "N/A", "n/a", "none", "NIL", "unknown", "7"]) {
      expect(hasReadableTradeName(value), value).toBe(false);
    }
  });

  it("accepts a two-letter name, because some are", () => {
    expect(hasReadableTradeName("KM")).toBe(true);
  });
});

describe("the emirate", () => {
  it("normalises the spellings and codes an export uses", () => {
    expect(normaliseEmirate("Dubai")).toBe("dubai");
    expect(normaliseEmirate("DXB")).toBe("dubai");
    expect(normaliseEmirate("abu dhabi")).toBe("abu_dhabi");
    expect(normaliseEmirate("RAK")).toBe("ras_al_khaimah");
    expect(normaliseEmirate("Umm Al Quwain")).toBe("umm_al_quwain");
  });

  it("does not recognise somewhere else", () => {
    expect(normaliseEmirate("Doha")).toBeNull();
    expect(normaliseEmirate("Riyadh")).toBeNull();
    expect(normaliseEmirate("")).toBeNull();
  });
});

describe("the category, from a licence activity", () => {
  it("reads the nouns that identify a trade", () => {
    expect(categorySlugFor("Trading in Valves & Pipe Fittings")).toBe("valves-and-fittings");
    expect(categorySlugFor("GI Pipe and Tube Trading")).toBe("pipes-and-tubing");
    expect(categorySlugFor("Air Conditioning Equipment Trading")).toBe("hvac-and-ventilation");
    expect(categorySlugFor("Electrical Cable & Accessories Trading")).toBe("electrical-and-cable");
    expect(categorySlugFor("Safety Equipment & Protective Clothing")).toBe("safety-and-ppe");
  });

  it("reads Arabic terms too", () => {
    expect(categorySlugFor("تجارة صمامات")).toBe("valves-and-fittings");
  });

  it("returns nothing rather than guessing", () => {
    // "General Trading" covers half the suppliers in Dubai. Queue it.
    expect(categorySlugFor("General Trading")).toBeNull();
    expect(categorySlugFor("Building Materials Trading")).toBeNull();
    expect(categorySlugFor(null)).toBeNull();
  });
});

describe("out of scope", () => {
  it("fires on activities that are positively something else", () => {
    expect(isOutOfScope("Restaurant & Cafeteria")).toBe(true);
    expect(isOutOfScope("Ladies Beauty Salon")).toBe(true);
    expect(isOutOfScope("Legal Consultancy")).toBe(true);
  });

  it("does not fire on a general trading licence", () => {
    // The single most common licence in the market. Rejecting it would empty
    // the directory of exactly the suppliers it is for.
    expect(isOutOfScope("General Trading")).toBe(false);
    expect(isOutOfScope("Trading in Building Materials")).toBe(false);
  });

  it("does not fire on something merely unrecognised", () => {
    expect(isOutOfScope("Marine Equipment Trading")).toBe(false);
  });
});

describe("classifying a record", () => {
  it("is ready when the activity names a trade", () => {
    expect(classify(record(), NOW)).toEqual({
      disposition: "ready",
      ground: null,
      categorySlug: "valves-and-fittings",
    });
  });

  it("queues a record it cannot categorise, rather than rejecting it", () => {
    const result = classify(record({ activity: "General Trading" }), NOW);
    expect(result.disposition).toBe("needs_category");
    expect(result.ground).toBeNull();
  });

  it("rejects a record with no readable name, first", () => {
    // Checked before everything else: a record with no name cannot be argued
    // about, and naming a different ground would send somebody looking.
    const result = classify(
      record({ tradeName: "-", emirate: "Doha", activity: "Restaurant" }),
      NOW,
    );
    expect(result).toMatchObject({ disposition: "rejected", ground: "no_readable_trade_name" });
  });

  it("rejects a licence more than 24 months expired", () => {
    const result = classify(
      record({ licenceExpiry: new Date("2023-01-01T00:00:00Z") }),
      NOW,
    );
    expect(result).toMatchObject({
      disposition: "rejected",
      ground: "licence_expired_24_months",
    });
  });

  it("keeps a licence that expired recently", () => {
    // A late renewal is the most ordinary thing in this market, and the
    // verification ladder already drops the tier for it.
    const result = classify(
      record({ licenceExpiry: new Date("2026-06-01T00:00:00Z") }),
      NOW,
    );
    expect(result.disposition).toBe("ready");
  });

  it("keeps a record with no expiry at all", () => {
    const result = classify(record({ licenceExpiry: null }), NOW);
    expect(result.disposition).toBe("ready");
  });

  it("rejects an address outside the UAE", () => {
    const result = classify(record({ emirate: "Doha" }), NOW);
    expect(result).toMatchObject({ disposition: "rejected", ground: "address_outside_uae" });
  });

  it("rejects an activity that is positively something else", () => {
    const result = classify(record({ activity: "Restaurant & Cafeteria" }), NOW);
    expect(result).toMatchObject({ disposition: "rejected", ground: "activity_out_of_scope" });
  });

  it("never returns published — that is a person's decision", () => {
    const dispositions = new Set(
      [
        record(),
        record({ activity: "General Trading" }),
        record({ tradeName: "" }),
        record({ emirate: "Doha" }),
      ].map((r) => classify(r, NOW).disposition),
    );
    expect(dispositions.has("ready" as never)).toBe(true);
    expect([...dispositions]).not.toContain("published");
  });
});

describe("the totals the run screen renders", () => {
  it("counts rejections by ground", () => {
    const totals = tally([
      classify(record(), NOW),
      classify(record({ activity: "General Trading" }), NOW),
      classify(record({ tradeName: "-" }), NOW),
      classify(record({ tradeName: "N/A" }), NOW),
      classify(record({ emirate: "Doha" }), NOW),
      classify(record({ activity: "Restaurant" }), NOW),
    ]);

    expect(totals.rows).toBe(6);
    expect(totals.categorised).toBe(1);
    expect(totals.queued).toBe(1);
    expect(totals.rejected).toBe(4);
    expect(totals.staged).toBe(2);
    expect(totals.byGround).toEqual({
      no_readable_trade_name: 2,
      address_outside_uae: 1,
      activity_out_of_scope: 1,
      licence_expired_24_months: 0,
    });
  });

  it("adds up", () => {
    const totals = tally([classify(record(), NOW), classify(record({ emirate: "Doha" }), NOW)]);
    expect(totals.staged + totals.rejected).toBe(totals.rows);
    expect(totals.categorised + totals.queued).toBe(totals.staged);
  });
});
