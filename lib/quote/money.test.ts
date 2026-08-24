import { describe, expect, it } from "vitest";
import { delta, filsToAed, lineTotalFils, parseAedToFils, quoteTotalAed } from "./money";

describe("parseAedToFils", () => {
  it("reads the Decimal strings Postgres returns", () => {
    expect(parseAedToFils("410.00")).toBe(41000n);
    expect(parseAedToFils("0.05")).toBe(5n);
    expect(parseAedToFils("1234")).toBe(123400n);
    expect(parseAedToFils("-712.50")).toBe(-71250n);
  });

  it("refuses a third decimal instead of rounding it away", () => {
    expect(() => parseAedToFils("410.005")).toThrow(/two decimals/);
    expect(() => parseAedToFils("nine hundred")).toThrow();
    expect(() => parseAedToFils("1e3")).toThrow();
  });
});

describe("totals", () => {
  it("adds the amounts that float arithmetic gets wrong", () => {
    // 0.1 + 0.2 in binary floating point is 0.30000000000000004.
    expect(quoteTotalAed([
      { qty: 1, unitPrice: "0.10" },
      { qty: 1, unitPrice: "0.20" },
    ])).toBe("0.30");
  });

  it("totals the seeded revision 2 exactly", () => {
    // 24 × 398.00 + 8 × 712.00 + 6 × 980.00
    expect(quoteTotalAed([
      { qty: 24, unitPrice: "398.00" },
      { qty: 8, unitPrice: "712.00" },
      { qty: 6, unitPrice: "980.00" },
    ])).toBe("21128.00");
  });

  it("survives a total larger than a float can hold precisely", () => {
    // 2^53 fils is about AED 90 trillion. Nobody will quote it; the point is
    // that the arithmetic does not quietly stop being exact if they do.
    expect(quoteTotalAed([{ qty: 1_000_000, unitPrice: "999999.99" }])).toBe("999999990000.00");
  });

  it("rejects a fractional quantity", () => {
    expect(() => lineTotalFils({ qty: 1.5, unitPrice: "10.00" })).toThrow(/whole number/);
  });

  it("is zero for no lines", () => {
    expect(quoteTotalAed([])).toBe("0.00");
  });
});

describe("filsToAed", () => {
  it("always writes two decimal places", () => {
    expect(filsToAed(5n)).toBe("0.05");
    expect(filsToAed(100n)).toBe("1.00");
    expect(filsToAed(0n)).toBe("0.00");
    expect(filsToAed(-71250n)).toBe("-712.50");
  });
});

describe("delta", () => {
  it("reports a price cut as a fall", () => {
    // Seeded r1 → r2: 22,264.00 down to 21,128.00.
    const d = delta(2_226_400n, 2_112_800n);
    expect(d.direction).toBe("down");
    expect(d.aed).toBe("-1136.00");
    expect(d.percent).toBe(-5.1);
  });

  it("has no percentage to report against a zero baseline", () => {
    expect(delta(0n, 100n).percent).toBeNull();
  });

  it("calls no change no change", () => {
    expect(delta(500n, 500n).direction).toBe("same");
  });
});
