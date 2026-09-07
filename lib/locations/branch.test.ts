import { describe, expect, it } from "vitest";
import {
  branchCounts,
  branchStatus,
  measurable,
  offeredForHours,
  pinIssues,
  pinState,
} from "./branch";

const live = { published: true, publishedAt: new Date("2026-01-01") };
const hidden = { published: false, publishedAt: new Date("2026-01-01") };
const draft = { published: false, publishedAt: null };

describe("branchStatus", () => {
  it("reads the boolean first", () => {
    expect(branchStatus(live)).toBe("published");
    // A live branch with no stamp is still live. The backfill gives every
    // existing row one, and a row that somehow missed it must not read as a
    // draft while it is on a storefront.
    expect(branchStatus({ published: true, publishedAt: null })).toBe("published");
  });

  it("separates a branch taken down from one never finished", () => {
    expect(branchStatus(hidden)).toBe("hidden");
    expect(branchStatus(draft)).toBe("draft");
  });

  it("never returns to draft once a branch has been live", () => {
    // Publishing stamps the date; hiding does not clear it. This is the whole
    // of the distinction, and it is deliberate: the branch has made a claim to
    // buyers and un-hiding and re-hiding does not un-make that.
    const wasLive = { published: false, publishedAt: new Date("2026-01-01") };
    expect(branchStatus(wasLive)).toBe("hidden");
  });
});

describe("offeredForHours", () => {
  it("offers a hidden branch and skips a draft — board 3d's picker", () => {
    expect(offeredForHours(live)).toBe(true);
    expect(offeredForHours(hidden)).toBe(true);
    expect(offeredForHours(draft)).toBe(false);
  });
});

describe("pinState", () => {
  it("calls the absence of coordinates missing, whatever the column says", () => {
    expect(pinState({ lat: null, lng: null, geocodePrecision: null })).toBe("missing");
    expect(pinState({ lat: 25.1, lng: null, geocodePrecision: "exact" })).toBe("missing");
  });

  it("reads the precision when there is a pin", () => {
    expect(pinState({ lat: 25.1, lng: 55.2, geocodePrecision: "exact" })).toBe("exact");
    expect(pinState({ lat: 25.1, lng: 55.2, geocodePrecision: "approximate" })).toBe("approximate");
  });

  it("treats a pin with no stated precision as approximate", () => {
    // The CHECK makes this unreachable from the database. If it ever is
    // reachable, the safe answer is the one that keeps a guess out of the
    // distance sort rather than the one that lets it in.
    expect(pinState({ lat: 25.1, lng: 55.2, geocodePrecision: null })).toBe("approximate");
  });
});

describe("measurable", () => {
  it("keeps only the pins a person placed — criterion 3", () => {
    const branches = [
      { id: "a", lat: 25.1, lng: 55.2, geocodePrecision: "exact" as const },
      { id: "b", lat: 25.3, lng: 55.4, geocodePrecision: "approximate" as const },
      { id: "c", lat: null, lng: null, geocodePrecision: null },
    ];
    expect(measurable(branches).map((branch) => branch.id)).toEqual(["a"]);
  });

  it("returns nothing rather than everything when no pin is exact", () => {
    // The production shape on 2026-09-07: every branch approximate. The answer
    // has to be "we cannot measure this supplier", not "measure them anyway".
    const branches = [{ lat: 25.1, lng: 55.2, geocodePrecision: "approximate" as const }];
    expect(measurable(branches)).toEqual([]);
  });
});

describe("branchCounts", () => {
  it("makes the header, the table and the overlay agree — criterion 1", () => {
    const branches = [
      { ...live, lat: 25.0, lng: 55.1, geocodePrecision: "exact" as const },
      { ...live, lat: 25.1, lng: 55.2, geocodePrecision: "exact" as const },
      { ...live, lat: 25.3, lng: 55.4, geocodePrecision: "approximate" as const },
      { ...hidden, lat: 24.3, lng: 54.5, geocodePrecision: "exact" as const },
      { ...draft, lat: null, lng: null, geocodePrecision: null },
    ];
    const counts = branchCounts(branches);

    // The board's own five rows. It read `4 branches` over them while its map
    // counted `4 PINS · 1 MISSING` — four pins *of* five branches.
    expect(counts.total).toBe(5);
    expect(counts.shown).toBe(3);
    expect(counts.pinned).toBe(4);
    expect(counts.missing).toBe(1);
    expect(counts.pinned + counts.missing).toBe(counts.total);
  });

  it("counts an approximate pin as pinned", () => {
    // It draws a marker. The overlay counts markers, and the issue card is
    // where the seller is told the marker is not the address.
    const counts = branchCounts([
      { ...live, lat: 25.3, lng: 55.4, geocodePrecision: "approximate" },
    ]);
    expect(counts.pinned).toBe(1);
    expect(counts.missing).toBe(0);
  });
});

describe("pinIssues", () => {
  const rows = [
    { id: "a", name: "Al Quoz trade counter", pin: "exact" as const },
    { id: "b", name: "Sharjah depot", pin: "approximate" as const },
    { id: "c", name: "Ras Al Khor yard", pin: "missing" as const },
  ];

  it("names the missing pin first, and leaves the exact one out", () => {
    expect(pinIssues(rows)).toEqual([
      { id: "c", name: "Ras Al Khor yard", state: "missing" },
      { id: "b", name: "Sharjah depot", state: "approximate" },
    ]);
  });

  it("is empty when every pin is exact, so the card does not render", () => {
    expect(pinIssues([rows[0]!])).toEqual([]);
  });
});
