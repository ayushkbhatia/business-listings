import { describe, expect, it } from "vitest";
import {
  activeClosure,
  branchStatus,
  coverageOf,
  emirateSummary,
  isStocking,
  orderBranches,
  ramadanActive,
  type BranchLocation,
} from "./branches";

/**
 * Board 1f's rules, tested where they are decisions rather than markup.
 *
 * The ones worth pinning are the ones a screenshot cannot show: which badge wins
 * when a branch is both shut for a fit-out and inside its Monday shift, what
 * happens to an unpinned branch when the list sorts by distance, and whether the
 * delivery card invents a promise nobody made.
 */

const WEEK = {
  sun: [{ open: "08:00", close: "18:00" }],
  mon: [{ open: "08:00", close: "18:00" }],
  tue: [{ open: "08:00", close: "18:00" }],
  wed: [{ open: "08:00", close: "18:00" }],
  thu: [{ open: "08:00", close: "18:00" }],
};

function branch(over: Partial<BranchLocation> = {}): BranchLocation {
  return {
    id: "l1",
    type: "trade_counter",
    emirate: "dubai",
    addressLine: "Unit 5, Street 9",
    lat: 25.12,
    lng: 55.23,
    phone: "+97148834120",
    whatsapp: null,
    phoneVerified: true,
    hours: WEEK,
    ramadanHours: null,
    serviceRadiusKm: null,
    closedFrom: null,
    closedUntil: null,
    closureReason: null,
    area: { name: "Al Quoz Industrial 1", isFreeZone: false },
    ...over,
  };
}

/* A Monday, 10:00 in Dubai — inside the standard shift, outside Ramadan. */
const MONDAY_10 = new Date("2026-09-07T06:00:00.000Z");
/* The same Monday at 21:00 Dubai, after close. */
const MONDAY_21 = new Date("2026-09-07T17:00:00.000Z");
/* A Friday at 10:00 Dubai. The week above is closed Fri and Sat. */
const FRIDAY_10 = new Date("2026-09-11T06:00:00.000Z");

describe("which branches hold stock", () => {
  it("counts everything but a sales office", () => {
    expect(isStocking("trade_counter")).toBe(true);
    expect(isStocking("warehouse")).toBe(true);
    expect(isStocking("depot")).toBe(true);
    expect(isStocking("workshop")).toBe(true);
    expect(isStocking("head_office")).toBe(true);
    expect(isStocking("sales_office")).toBe(false);
  });

  it("badges a sales office with its type, not its hours", () => {
    /*
       Criterion 6. The hours are true and useless: a buyer reading "Open now"
       on an office loads a van and drives to a room with a desk in it.
    */
    const status = branchStatus(branch({ type: "sales_office" }), MONDAY_10);
    expect(status).toEqual({ kind: "type", type: "sales_office" });
  });
});

describe("open now, in Dubai, whatever the reader's clock says", () => {
  it("is open inside the shift", () => {
    expect(branchStatus(branch(), MONDAY_10)).toEqual({ kind: "open", until: "18:00" });
  });

  it("carries the next opening rather than a bare Closed", () => {
    const status = branchStatus(branch(), MONDAY_21);
    expect(status).toEqual({ kind: "closed", opensAt: "08:00" });
  });

  it("finds Sunday's opening from a Friday, across the closed weekend", () => {
    // Criterion 7. A bare "Closed" on a Friday tells a buyer nothing they can plan around.
    const status = branchStatus(branch(), FRIDAY_10);
    expect(status).toEqual({ kind: "closed", opensAt: "08:00" });
  });

  it("reports open at 09:00 in London, because it is 13:00 in Dubai", () => {
    /*
       Criterion 2, stated as the spec states it: "a buyer in London looking at
       a Dubai supplier at 09:00 GMT must see Open now because it is 13:00 in
       Dubai". The instant is the same one either way — what the naive version
       gets wrong is reading the hour off the host, which is right for a
       developer in Dubai and wrong for the region the page renders in.
    */
    const nineInLondon = new Date("2026-09-07T09:00:00.000+01:00");
    expect(branchStatus(branch(), nineInLondon)).toEqual({ kind: "open", until: "18:00" });

    // And the mirror: 17:00 in London is 21:00 in Dubai, after the shift ends.
    const fiveInLondon = new Date("2026-09-07T17:00:00.000+01:00");
    expect(branchStatus(branch(), fiveInLondon)).toMatchObject({ kind: "closed" });
  });

  it("is unknown, never closed, when no hours are on file", () => {
    expect(branchStatus(branch({ hours: {} }), MONDAY_10)).toEqual({ kind: "unknown" });
  });
});

describe("a closure outranks the hours", () => {
  const window = {
    closedFrom: new Date("2026-09-01T00:00:00.000Z"),
    closedUntil: new Date("2026-09-30T00:00:00.000Z"),
    closureReason: "Relocating to a larger unit in the same free zone.",
  };

  it("reports closed inside its own shift", () => {
    /*
       The branch's Monday says 08:00–18:00 and it is 10:00. Reading the hours
       alone sends somebody to a locked door with the page's blessing.
    */
    expect(branchStatus(branch(window), MONDAY_10)).toEqual({
      kind: "closed",
      // A date, not a time: criterion 7 forbids a bare "Closed", and the honest
      // answer for a closure is when it reopens, not when the shift would start.
      until: window.closedUntil,
    });
  });

  it("is inert outside the window", () => {
    const before = new Date("2026-08-24T06:00:00.000Z");
    expect(branchStatus(branch(window), before)).toEqual({ kind: "open", until: "18:00" });
  });

  it("needs all three columns before it is a closure at all", () => {
    expect(activeClosure(branch({ closedFrom: window.closedFrom }), MONDAY_10)).toBeNull();
    expect(activeClosure(branch(window), MONDAY_10)).toMatchObject({
      reason: window.closureReason,
    });
  });
});

describe("Ramadan", () => {
  it("is inactive in September and active inside the window", () => {
    expect(ramadanActive(MONDAY_10)).toBeNull();
    // 2027's window opens on 7 February.
    expect(ramadanActive(new Date("2027-02-20T09:00:00.000Z"))).toMatchObject({
      from: new Date("2027-02-07T00:00:00.000Z"),
    });
  });
});

describe("the order the column is read in", () => {
  const head = branch({ id: "head", type: "head_office", emirate: "sharjah", lat: 25.35, lng: 55.42 });
  const near = branch({ id: "near", emirate: "dubai", lat: 25.12, lng: 55.23 });
  const far = branch({ id: "far", emirate: "abu_dhabi", lat: 24.45, lng: 54.38 });
  const unpinned = branch({ id: "unpinned", emirate: "ajman", lat: null, lng: null });

  it("puts the head office first when there is no origin", () => {
    const result = orderBranches([near, far, head], null);
    expect(result.sort).toBe("emirate");
    expect(result.branches[0]?.id).toBe("head");
  });

  it("groups the remaining emirates the way the sub-line lists them", () => {
    /*
       Most branches first, not alphabetical. Sorting on the enum name put a
       Dubai supplier's three Dubai branches at ranks 1, 4 and 5, split by
       single branches in Abu Dhabi and Ajman that sort earlier on the letter.
    */
    const dubaiTwo = branch({ id: "dubai-2", emirate: "dubai", area: { name: "Al Quoz Industrial 3", isFreeZone: false } });
    const abuDhabi = branch({ id: "abu", emirate: "abu_dhabi" });
    const result = orderBranches([abuDhabi, near, dubaiTwo], null);
    // Dubai's two first (by area name within the emirate), Abu Dhabi's one last.
    expect(result.branches.map((b) => b.id)).toEqual(["near", "dubai-2", "abu"]);
  });

  it("sorts by distance from an origin, nearest first", () => {
    const result = orderBranches([far, head, near], { lat: 25.11, lng: 55.22 });
    expect(result.sort).toBe("distance");
    expect(result.branches.map((b) => b.id)).toEqual(["near", "head", "far"]);
    expect(result.distanceKm["near"]).toBeLessThan(2);
  });

  it("keeps an unpinned branch in the list, at the end, never measured", () => {
    /*
       Criterion 4 in the list rather than the map: the address is useful even
       unpinned, so it is not dropped — and it is not given a centroid so that it
       can be sorted, which would put a fabricated distance on the page.
    */
    const result = orderBranches([unpinned, far, near], { lat: 25.11, lng: 55.22 });
    expect(result.branches.map((b) => b.id)).toEqual(["near", "far", "unpinned"]);
    expect(result.distanceKm["unpinned"]).toBeUndefined();
  });
});

describe("the header sub-line", () => {
  it("lists emirates by branch count, descending", () => {
    const locations = [
      branch({ id: "a", emirate: "sharjah" }),
      branch({ id: "b", emirate: "dubai" }),
      branch({ id: "c", emirate: "dubai" }),
    ];
    expect(emirateSummary(locations)).toEqual({ emirates: ["dubai", "sharjah"], more: 0 });
  });

  it("caps at three and counts the rest", () => {
    const locations = (["dubai", "sharjah", "ajman", "fujairah"] as const).map((emirate, i) =>
      branch({ id: `l${i}`, emirate }),
    );
    const summary = emirateSummary(locations);
    expect(summary.emirates).toHaveLength(3);
    expect(summary.more).toBe(1);
  });
});

describe("the delivery card claims nothing the seller did not", () => {
  it("is absent when there is no radius and no note", () => {
    expect(coverageOf([branch()], null)).toBeNull();
  });

  it("takes the widest radius any branch states", () => {
    const locations = [
      branch({ id: "a", serviceRadiusKm: 25 }),
      branch({ id: "b", serviceRadiusKm: 65 }),
    ];
    expect(coverageOf(locations, null)).toMatchObject({ radiusKm: 65 });
  });

  it("carries the seller's own words and does not invent a promise", () => {
    const coverage = coverageOf([branch()], "  Same-day inside Dubai on stocked lines  ");
    expect(coverage).toMatchObject({
      radiusKm: null,
      note: "Same-day inside Dubai on stocked lines",
    });
  });

  it("treats a blank note as no note", () => {
    expect(coverageOf([branch()], "   ")).toBeNull();
  });
});
