import { describe, expect, it } from "vitest";
import { availabilityBands, deliversLocally } from "./availability-bands";

/**
 * Criterion 3, which is the sharpest test of the no-price model on the whole
 * site: this is the one place a buyer looks at a quantity and expects a number
 * beside it, so it is where a price leaks first.
 */

const LOCAL = { deliversLocally: true, leadTimeDays: null };

describe("in stock reads as speed", () => {
  it("gives four bands, none of them a figure", () => {
    const bands = availabilityBands("in_stock", LOCAL);
    expect(bands.map((b) => b.quantity)).toEqual(["1 – 9", "10 – 49", "50 – 199", "200 +"]);
    expect(bands.map((b) => b.labelKey)).toEqual([
      "bands.collect_today",
      "bands.same_day",
      "bands.two_days_better",
      "bands.contract",
    ]);
    // Nothing in the second column is a number, a range or a currency.
    for (const band of bands) {
      expect(band.labelKey).not.toMatch(/price|aed|rate_[0-9]|from/i);
      expect(band.weeks).toBeUndefined();
    }
  });

  it("does not promise same-day for a seller who never said they deliver", () => {
    /*
       A seller with no service radius has not made that claim. The band falls
       back to the slower answer, which is wrong in the safe direction.
    */
    const bands = availabilityBands("in_stock", { deliversLocally: false, leadTimeDays: null });
    expect(bands[1]?.labelKey).toBe("bands.two_days");
  });
});

describe("anything not in stock reads as lead time", () => {
  it("builds weeks out from the stated lead time", () => {
    const bands = availabilityBands("made_to_order", { deliversLocally: true, leadTimeDays: 14 });
    expect(bands.map((b) => b.weeks)).toEqual([2, 3, 4, undefined]);
    // The unbounded band is never a number: nobody can quote for "200 +".
    expect(bands[3]?.labelKey).toBe("bands.by_arrangement");
  });

  it("never offers collect today on a made-to-order product", () => {
    const bands = availabilityBands("indent", { deliversLocally: true, leadTimeDays: 21 });
    expect(bands.map((b) => b.labelKey)).not.toContain("bands.collect_today");
  });

  it("says on enquiry rather than inventing a lead time", () => {
    const bands = availabilityBands("made_to_order", { deliversLocally: true, leadTimeDays: null });
    expect(bands.slice(0, 3).every((b) => b.labelKey === "bands.on_enquiry")).toBe(true);
  });

  it("rounds a part-week up to one week, never to zero", () => {
    // Three days is "1 week", not "0 weeks" — which would read as same-day.
    const bands = availabilityBands("made_to_order", { deliversLocally: true, leadTimeDays: 3 });
    expect(bands[0]?.weeks).toBe(1);
  });
});

describe("out of stock has no quantity table", () => {
  it("returns nothing, so the state can say one sentence instead", () => {
    /*
       Four rows about something there is none of pushes the enquiry action
       down the page, and the enquiry is the whole point of the state.
    */
    expect(availabilityBands("out_of_stock", LOCAL)).toEqual([]);
  });
});

describe("delivery is the seller's claim, never inferred from an address", () => {
  it("is true only when a branch states a radius", () => {
    expect(deliversLocally([{ serviceRadiusKm: 65 }])).toBe(true);
    expect(deliversLocally([{ serviceRadiusKm: null }])).toBe(false);
    expect(deliversLocally([])).toBe(false);
  });
});
