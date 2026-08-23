import { describe, expect, it } from "vitest";
import { NBSP } from "./locale";
import { formatBytes, formatNominalDiameter, formatSize } from "./size";

describe("formatSize", () => {
  it("renders the pairing the design system specifies", () => {
    expect(formatSize({ dn: 100 })).toBe(`DN100 · 4${NBSP}inch`);
  });

  it("puts metric first, always", () => {
    for (const dn of [15, 25, 50, 100, 300]) {
      expect(formatSize({ dn }).indexOf("DN")).toBe(0);
    }
  });

  it("uses the trade imperial name, not a conversion", () => {
    // DN100 measures 114.3 mm. The counter calls it four inch.
    expect(formatSize({ dn: 100 })).toContain(`4${NBSP}inch`);
    expect(formatSize({ dn: 15 })).toBe(`DN15 · 1/2${NBSP}inch`);
    expect(formatSize({ dn: 40 })).toBe(`DN40 · 1-1/2${NBSP}inch`);
    expect(formatSize({ dn: 65 })).toBe(`DN65 · 2-1/2${NBSP}inch`);
  });

  it("falls back to the metric size alone when there is no nominal imperial name", () => {
    expect(formatSize({ dn: 137 })).toBe("DN137");
  });

  it("converts a plain millimetre measurement, metric still first", () => {
    expect(formatSize({ mm: 100 })).toBe(`100${NBSP}mm · 3.94${NBSP}inch`);
  });

  it("converts an imperial-first source into metric-first output", () => {
    expect(formatSize({ inch: 4 })).toBe(`101.6${NBSP}mm · 4${NBSP}inch`);
  });

  it("keeps the number glued to its unit with a non-breaking space", () => {
    expect(formatSize({ dn: 100 })).toContain(" inch");
  });

  it("throws when given nothing to format", () => {
    expect(() => formatSize({})).toThrow(TypeError);
  });
});

describe("formatNominalDiameter", () => {
  it("renders the bare metric size for a filter chip", () => {
    expect(formatNominalDiameter(100)).toBe("DN100");
  });
});

describe("formatBytes", () => {
  it("uses decimal units, as every operating system now reports", () => {
    expect(formatBytes(2_400_000)).toBe(`2.4${NBSP}MB`);
    expect(formatBytes(999)).toBe(`999${NBSP}B`);
    expect(formatBytes(1000)).toBe(`1${NBSP}kB`);
    expect(formatBytes(15_700_000)).toBe(`16${NBSP}MB`);
  });

  it("rejects a negative size", () => {
    expect(() => formatBytes(-1)).toThrow(TypeError);
  });
});
