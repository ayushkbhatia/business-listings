import { describe, expect, it } from "vitest";
import { firstPriced, statesAPrice } from "./no-price";

/**
 * Board `5c-s` B4 and criterion 4: no field in the builder carries a fee, a
 * price or a rate onto a page. The cases that must pass are as load-bearing as
 * the ones that must not — a check that refused every number would be routed
 * around by writing numbers as words.
 */

describe("what reads as a price", () => {
  it.each([
    "Audits from AED 5,000",
    "AED5000 fixed",
    "Dhs. 40 a metre",
    "5,000 AED all in",
    "5k dirhams per filing",
    "$300 per return",
    "Bookkeeping at 350/hour",
    "Cleaning 120 per visit",
    "Fees from 2,500",
    "Price: 40",
    "Rates starting at 90",
    "20% off your first audit",
    "Save 15% this Ramadan",
    "up to 30% discount",
  ])("refuses %s", (text) => {
    expect(statesAPrice(text)).toBe(true);
  });
});

describe("what does not", () => {
  it.each([
    "Statutory audit, VAT and corporate tax since 2009",
    "98% of returns filed a week early",
    "218 clients across Dubai and Sharjah",
    "Invoiced in AED, paid on your terms",
    "First-rate work since 2009",
    "Response rate within 2 hours",
    "Fee on enquiry",
    "ISO 9001:2015 certified",
    "Open 7 days a week, 24 hours a day",
    "Ramadan hours: counter open 9am to 3pm",
    "Quote RAMADAN26 in your enquiry",
    "Two partners, ACCA",
  ])("allows %s", (text) => {
    expect(statesAPrice(text)).toBe(false);
  });

  it("finds the one that does, among many", () => {
    expect(firstPriced(["Signed report", "From AED 4,000", "Two weeks"])).toBe("From AED 4,000");
    expect(firstPriced(["Signed report", "Two weeks"])).toBeNull();
  });
});
