import { describe, expect, it } from "vitest";
import { formatAED } from "./currency";

describe("formatAED", () => {
  it("renders the display form the design system specifies", () => {
    expect(formatAED(15624)).toBe("AED 15,624");
  });

  it("renders the quote form without the currency mark", () => {
    // The column head carries AED; repeating it on every line is noise.
    expect(formatAED(15624, { style: "quote" })).toBe("15,624.00");
  });

  it("never abbreviates a large value", () => {
    expect(formatAED(4_120_400)).toBe("AED 4,120,400");
    expect(formatAED(4_120_400)).not.toMatch(/[kMm]\b/);
  });

  it("rounds to whole dirhams for display and to fils for a quote", () => {
    expect(formatAED(15624.49)).toBe("AED 15,624");
    expect(formatAED(15624.5)).toBe("AED 15,625");
    expect(formatAED(15624.499, { style: "quote" })).toBe("15,624.50");
  });

  it("accepts the string a Prisma Decimal serialises to", () => {
    expect(formatAED("15624.00", { style: "quote" })).toBe("15,624.00");
    expect(formatAED(" 15624 ")).toBe("AED 15,624");
  });

  it("handles zero without a sign", () => {
    expect(formatAED(0)).toBe("AED 0");
    expect(formatAED(0, { style: "quote" })).toBe("0.00");
  });

  it("signs a negative, and brackets it only in accounting style", () => {
    expect(formatAED(-1200, { style: "quote" })).toBe("-1,200.00");
    expect(formatAED(-1200, { style: "quote", accounting: true })).toBe("(1,200.00)");
  });

  it("throws rather than printing NaN into a quote", () => {
    expect(() => formatAED(Number.NaN)).toThrow(TypeError);
    expect(() => formatAED("not a number")).toThrow(TypeError);
    expect(() => formatAED(Number.POSITIVE_INFINITY)).toThrow(TypeError);
  });

  it("uses latin digits regardless of the host locale", () => {
    expect(formatAED(15624)).toMatch(/^AED [\d,]+$/);
  });
});

describe("exact — board 3m, criterion 3", () => {
  it("keeps the fils that display rounds away", () => {
    // The second correction on the pair: a `THIS PERIOD` panel read `AED 1,784`
    // over two lines summing to 1,699, so the 84.95 of VAT was invisible and the
    // total was unreproducible.
    expect(formatAED(1783.95, { style: "exact" })).toBe("AED 1,783.95");
    expect(formatAED(1783.95)).toBe("AED 1,784");
  });

  it("carries the currency, unlike quote", () => {
    expect(formatAED(313.95, { style: "exact" })).toBe("AED 313.95");
    expect(formatAED(313.95, { style: "quote" })).toBe("313.95");
  });

  it("shows a whole amount to two places rather than dropping them", () => {
    // `Due today AED 0.00` on board 11f. "AED 0" reads as absence rather than as
    // a figure somebody computed.
    expect(formatAED(0, { style: "exact" })).toBe("AED 0.00");
  });

  it("signs a credit the same way the other styles do", () => {
    expect(formatAED(-76.65, { style: "exact" })).toBe("-AED 76.65");
    expect(formatAED(-76.65, { style: "exact", accounting: true })).toBe("(AED 76.65)");
  });
});
