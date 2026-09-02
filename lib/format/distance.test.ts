import { describe, expect, it } from "vitest";
import { formatKm } from "./distance";

/**
 * The precision rule board 1c draws: one decimal close in, none further out.
 * Not inconsistency — the difference between 2.1 and 2.4 km decides which
 * supplier somebody drives to, and the difference between 19.2 and 19.4 decides
 * nothing while implying an accuracy a pin on a warehouse roof does not have.
 */
describe("formatKm", () => {
  it("keeps one decimal under ten kilometres", () => {
    expect(formatKm(2.14)).toMatch(/^2\.1\s?km$/);
    expect(formatKm(9.96)).toMatch(/^10\.0\s?km$/);
  });

  it("rounds to whole kilometres past ten", () => {
    expect(formatKm(14.4)).toMatch(/^14\s?km$/);
    expect(formatKm(19.6)).toMatch(/^20\s?km$/);
  });

  it("says 'under 0.1' rather than printing 0.0", () => {
    // A buyer filtered to Al Quoz, measured from Al Quoz's centroid. "0.0 km"
    // looks like a bug and "43 m" is more precision than a centroid earns.
    expect(formatKm(0.04)).toContain("0.1");
    expect(formatKm(0)).toContain("0.1");
  });

  it("is undefined for an unknown distance, never zero", () => {
    // Null means no origin or no pinned branch. Rendering it as "0 km" would
    // put the least-known supplier at the top of a distance sort.
    expect(formatKm(null)).toBeUndefined();
    expect(formatKm(undefined)).toBeUndefined();
    expect(formatKm(Number.NaN)).toBeUndefined();
    expect(formatKm(Number.POSITIVE_INFINITY)).toBeUndefined();
  });

  it("binds the unit to the number so a row cannot wrap between them", () => {
    expect(formatKm(2.1)).toContain(" ");
  });
});
