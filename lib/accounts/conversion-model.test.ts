import { describe, expect, it } from "vitest";
import { cohortConversion, cohortWindow, CONVERSION_WINDOW_DAYS } from "./conversion-model";

/**
 * D-CONVERSION, board 4a: the ninety-day cohort, and the line it replaces.
 */

const DAY = 86_400_000;
const AS_OF = new Date("2026-10-01T08:00:00Z");
const daysBefore = (days: number) => new Date(AS_OF.getTime() - days * DAY);

describe("the ninety-day cohort", () => {
  it("only counts claims old enough to have had their ninety days", () => {
    const window = cohortWindow(AS_OF);
    expect(window.to.getTime()).toBe(daysBefore(CONVERSION_WINDOW_DAYS).getTime());
    const result = cohortConversion(
      [
        { businessId: "young", claimedAt: daysBefore(30) },
        { businessId: "old", claimedAt: daysBefore(120) },
      ],
      new Map(),
      AS_OF,
    );
    expect(result.cohort).toBe(1);
  });

  it("counts a first payment within ninety days of the claim, and not one after", () => {
    const claims = [
      { businessId: "a", claimedAt: daysBefore(200) },
      { businessId: "b", claimedAt: daysBefore(200) },
      { businessId: "c", claimedAt: daysBefore(200) },
    ];
    const paid = new Map([
      ["a", daysBefore(150)], // 50 days after claiming
      ["b", daysBefore(100)], // 100 days after
    ]);
    const result = cohortConversion(claims, paid, AS_OF);
    expect(result).toMatchObject({ cohort: 3, converted: 1 });
    expect(result.rate).toBeCloseTo(1 / 3);
  });

  it("counts a seller who paid while their claim waited for a decision", () => {
    const result = cohortConversion(
      [{ businessId: "early", claimedAt: daysBefore(150) }],
      new Map([["early", daysBefore(160)]]),
      AS_OF,
    );
    expect(result.converted).toBe(1);
  });

  it("says nothing rather than zero when no claim is old enough", () => {
    const result = cohortConversion([{ businessId: "young", claimedAt: daysBefore(10) }], new Map(), AS_OF);
    expect(result).toEqual({ cohort: 0, converted: 0, rate: null, claimedFrom: null, claimedTo: null });
  });

  it("leaves out claims older than a year before the window", () => {
    const result = cohortConversion([{ businessId: "ancient", claimedAt: daysBefore(600) }], new Map(), AS_OF);
    expect(result.cohort).toBe(0);
  });
});
