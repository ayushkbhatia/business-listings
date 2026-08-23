import { describe, expect, it } from "vitest";
import { formatCount, formatDecimal, formatPercent } from "./count";

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
