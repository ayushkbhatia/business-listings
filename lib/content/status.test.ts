import { describe, expect, it } from "vitest";
import { byOpportunity, pageState, RECRUIT_SEARCHES } from "./status";

/**
 * Board 6f's five statuses and its opportunity metric.
 *
 * The statuses matter because the board used one badge for two opposite
 * situations — supply without copy, and demand without supply — which route to
 * different teams. The metric matters because criterion 4 says leaving it
 * undefined decides where a sales team spends its week by accident.
 */
const base = {
  live: false,
  heldAt: null,
  listings: 0,
  need: 60,
  introWords: 0,
  minIntroWords: 250,
  monthlySearches: null,
};

describe("the five statuses are mutually exclusive", () => {
  it("calls a published page above the word floor live", () => {
    expect(pageState({ ...base, live: true, listings: 80, introWords: 300 }).status).toBe("live");
  });

  it("separates thin copy from thin supply", () => {
    // Two different conditions with two different owners and two different
    // remedies. The board used 142 for both.
    expect(pageState({ ...base, live: true, listings: 80, introWords: 210 }).status).toBe(
      "live_thin_copy",
    );
    expect(pageState({ ...base, listings: 12 }).status).toBe("held_supply");
  });

  it("routes supply-without-copy to content ops, not to the CRM", () => {
    expect(pageState({ ...base, listings: 80 }).status).toBe("queued_copy");
  });

  it("recruits only where the searches justify the calls", () => {
    expect(pageState({ ...base, listings: 39, monthlySearches: RECRUIT_SEARCHES }).status).toBe(
      "recruit",
    );
    expect(pageState({ ...base, listings: 39, monthlySearches: 999 }).status).toBe("held_supply");
  });

  it("does not read a missing search figure as a low one, or as a high one", () => {
    // Absent means the absolute floor decided the need, and it means nobody
    // knows whether a call would be answered. It is `held_supply` either way,
    // but it must never be `recruit`.
    expect(pageState({ ...base, listings: 39, monthlySearches: null }).status).toBe("held_supply");
    expect(pageState({ ...base, listings: 39, monthlySearches: null }).opportunity).toBe(0);
  });

  it("lets a person's hold outrank the arithmetic", () => {
    const held = pageState({
      ...base,
      live: true,
      listings: 80,
      introWords: 300,
      heldAt: new Date("2026-09-01"),
    });
    expect(held.status).toBe("held_editorial");
  });
});

describe("opportunity", () => {
  it("is demand unlocked per supplier recruited", () => {
    // The board's own worked example, and the reason the metric is defined
    // here: Jumeirah is two short of 2,260 searches; Business Bay is 21 short
    // of 3,940. Raw volume puts Business Bay first and gets it wrong.
    const jumeirah = pageState({ ...base, listings: 58, need: 60, monthlySearches: 2_260 });
    const businessBay = pageState({ ...base, listings: 78, need: 99, monthlySearches: 3_940 });

    expect(jumeirah.shortfall).toBe(2);
    expect(businessBay.shortfall).toBe(21);
    expect(jumeirah.opportunity).toBeCloseTo(1_130);
    expect(businessBay.opportunity).toBeCloseTo(187.6, 1);

    const sorted = [businessBay, jumeirah]
      .map((state, index) => ({ ...state, monthlySearches: [3_940, 2_260][index] as number }))
      .sort(byOpportunity);
    expect(sorted[0]?.opportunity).toBeCloseTo(1_130);
  });

  it("scores a page that meets its need at nought, and sorts it below the rest", () => {
    const met = pageState({ ...base, listings: 120, need: 99, monthlySearches: 3_940 });
    expect(met.opportunity).toBe(0);
    expect(met.shortfall).toBe(0);
  });

  it("breaks a tie between met pages on the larger figure", () => {
    // The board sorts these by sessions. Nothing in this product records
    // organic sessions, so recorded volume stands in — same intent, real data.
    const rows = [
      { ...pageState({ ...base, listings: 120, need: 60 }), monthlySearches: 400 },
      { ...pageState({ ...base, listings: 120, need: 60 }), monthlySearches: 9_100 },
    ].sort(byOpportunity);
    expect(rows[0]?.monthlySearches).toBe(9_100);
  });
});
