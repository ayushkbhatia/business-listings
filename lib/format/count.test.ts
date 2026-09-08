import { describe, expect, it } from "vitest";
import { formatCount, formatDecimal, formatPercent, formatRating } from "./count";

describe("formatCount", () => {
  it("groups thousands and never abbreviates", () => {
    expect(formatCount(41204)).toBe("41,204");
    expect(formatCount(218)).toBe("218");
    expect(formatCount(1_000_000)).toBe("1,000,000");
  });

  it("does not produce a k, M or B suffix at any magnitude", () => {
    for (const n of [999, 1000, 41204, 999_999, 1_000_000, 12_345_678]) {
      expect(formatCount(n)).not.toMatch(/[kKMB]/);
    }
  });

  it("shows zero as zero, not as a dash", () => {
    expect(formatCount(0)).toBe("0");
  });

  it("throws on a non-finite value", () => {
    expect(() => formatCount(Number.NaN)).toThrow(TypeError);
  });
});

describe("formatDecimal", () => {
  it("keeps one decimal and drops a trailing zero", () => {
    expect(formatDecimal(4.216)).toBe("4.2");
    expect(formatDecimal(4.0)).toBe("4");
    expect(formatDecimal(4.96)).toBe("5");
  });
});

describe("formatPercent", () => {
  it("renders a ratio as whole percent", () => {
    expect(formatPercent(0.3)).toBe("30%");
    expect(formatPercent(0.304)).toBe("30%");
    expect(formatPercent(1)).toBe("100%");
  });
});

describe("formatRating", () => {
  it("always carries one decimal, so 4 and 4.2 read as the same kind of number", () => {
    // formatDecimal drops the trailing zero, which put "4" in the rating card
    // and "4.0" in the storefront header on the same page.
    expect(formatRating(4)).toBe("4.0");
    expect(formatRating(4.216)).toBe("4.2");
    expect(formatRating(5)).toBe("5.0");
  });

  it("rounds to one decimal rather than truncating", () => {
    expect(formatRating(4.25)).toBe("4.3");
    expect(formatRating(3.94)).toBe("3.9");
  });

  it("refuses a value that is not a finite number", () => {
    expect(() => formatRating(Number.NaN)).toThrow(TypeError);
    expect(() => formatRating(Number.POSITIVE_INFINITY)).toThrow(TypeError);
  });
});

describe("formatPercent decimals", () => {
  it("keeps whole percents by default, as every caller before 3l wanted", () => {
    expect(formatPercent(0.147)).toBe("15%");
  });

  it("keeps a small rate visible when a decimal is asked for", () => {
    /*
       Board 3l. A reveal rate of 0.5% rounds to 0% at whole precision — a stage
       reading as having lost everybody when it converted one buyer in two
       hundred, on the page whose whole job is proportions.
    */
    expect(formatPercent(0.005, { decimals: 1 })).toBe("0.5%");
    expect(formatPercent(0.147, { decimals: 1 })).toBe("14.7%");
    expect(formatPercent(0.446, { decimals: 1 })).toBe("44.6%");
  });

  it("pads to the asked precision so a column stays aligned", () => {
    expect(formatPercent(0.5, { decimals: 1 })).toBe("50.0%");
  });
});
