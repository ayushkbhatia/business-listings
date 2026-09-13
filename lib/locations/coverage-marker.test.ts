import { describe, expect, it } from "vitest";
import {
  coverageMarker,
  coverageTally,
  reachesScope,
  withinCoverage,
} from "./service-coverage";
import type { CoverageScope } from "./coverage";

/**
 * Board `3c-s` B3 and B4 — the markers and the header chip, derived.
 *
 * Every case builds the default and the row and asks for the marker, because
 * the whole rule is that nothing stores one. A marker read back off a column
 * would pass these tests on the day it was written and fail the day the
 * default changed — the `edits the default` block below is what that looks
 * like.
 */

const dubai: CoverageScope = { emirate: "dubai", areaId: null };
const sharjah: CoverageScope = { emirate: "sharjah", areaId: null };
const abuDhabi: CoverageScope = { emirate: "abu_dhabi", areaId: null };
const ajman: CoverageScope = { emirate: "ajman", areaId: null };
const alQuoz: CoverageScope = { emirate: "dubai", areaId: "area-al-quoz" };
const alAin: CoverageScope = { emirate: "abu_dhabi", areaId: "area-al-ain" };

/** Meridian's default on the board: Dubai, Sharjah, Abu Dhabi. */
const DEFAULT = [dubai, sharjah, abuDhabi];
const SEVEN: CoverageScope[] = [
  "abu_dhabi", "dubai", "sharjah", "ajman", "umm_al_quwain", "ras_al_khaimah", "fujairah",
].map((emirate) => ({ emirate, areaId: null }) as CoverageScope);

describe("reach", () => {
  it("lets an emirate-wide claim reach every area inside it", () => {
    expect(reachesScope([dubai], alQuoz)).toBe(true);
  });

  it("never lets an area reach its emirate", () => {
    // Al Quoz is not Dubai. Treating it as Dubai would widen a claim.
    expect(reachesScope([alQuoz], dubai)).toBe(false);
  });

  it("keeps Al Ain inside Abu Dhabi and not an eighth emirate — B9", () => {
    expect(reachesScope([abuDhabi], alAin)).toBe(true);
    expect(reachesScope([alAin], abuDhabi)).toBe(false);
  });

  it("treats an empty set as reaching nothing, and an empty inner as trivially within", () => {
    expect(reachesScope([], dubai)).toBe(false);
    expect(withinCoverage([], [])).toBe(true);
  });
});

describe("the four markers, on the board's own rows", () => {
  it("VAT return filing — no rows of its own is inherited", () => {
    expect(coverageMarker(DEFAULT, [])).toBe("inherited");
  });

  it("Monthly bookkeeping — Dubai and Sharjah is narrowed", () => {
    expect(coverageMarker(DEFAULT, [dubai, sharjah])).toBe("narrowed");
  });

  it("Corporate tax registration — all seven is wider than the default", () => {
    expect(coverageMarker(DEFAULT, SEVEN)).toBe("wider");
  });

  it("Statutory audit — Dubai only is narrowed", () => {
    expect(coverageMarker(DEFAULT, [dubai])).toBe("narrowed");
  });

  it("an area inside a default emirate is narrowed", () => {
    expect(coverageMarker(DEFAULT, [alQuoz])).toBe("narrowed");
  });

  it("one emirate outside the default makes the whole row wider, even alongside narrowing", () => {
    // Dubai is in the default, Ajman is not. A row that does both is wider,
    // because that is the half a buyer in Ajman is affected by.
    expect(coverageMarker(DEFAULT, [dubai, ajman])).toBe("wider");
  });

  it("an emirate whose default holds only an area is wider", () => {
    // Default covers Al Ain; the row claims the whole of Abu Dhabi.
    expect(coverageMarker([dubai, alAin], [abuDhabi])).toBe("wider");
  });
});

describe("the fourth state the board left out", () => {
  it("rows that happen to equal the default are `same`, not inherited", () => {
    /*
       The spec's prose says equal is inherited and its pseudocode says equal is
       narrowed. It is neither: these rows will not follow an edit to the
       default, which is precisely what `2d-s` B5 exists to prevent a seller
       from doing by accident.
    */
    expect(coverageMarker(DEFAULT, [dubai, sharjah, abuDhabi])).toBe("same");
    expect(coverageMarker(DEFAULT, [abuDhabi, dubai, sharjah])).toBe("same");
  });

  it("an emirate row is `same` against a default that holds that emirate plus an area inside it", () => {
    expect(coverageMarker([dubai, alQuoz], [dubai])).toBe("same");
  });
});

describe("edits the default — why nothing is stored", () => {
  it("moves a narrowed row to wider when the default shrinks under it", () => {
    const own = [dubai, sharjah];
    expect(coverageMarker(DEFAULT, own)).toBe("narrowed");
    expect(coverageMarker([dubai], own)).toBe("wider");
  });

  it("moves a wider row to narrowed when the default grows past it", () => {
    const own = [dubai, ajman];
    expect(coverageMarker(DEFAULT, own)).toBe("wider");
    expect(coverageMarker([...DEFAULT, ajman], own)).toBe("narrowed");
  });

  it("keeps an inheriting row inheriting whatever the default becomes", () => {
    expect(coverageMarker([], [])).toBe("inherited");
    expect(coverageMarker(SEVEN, [])).toBe("inherited");
  });

  it("calls every row wider against an empty default", () => {
    // A firm that cleared its default and kept one narrowed service. The row is
    // now the only coverage the firm has, and the marker has to say so.
    expect(coverageMarker([], [dubai])).toBe("wider");
  });
});

describe("the header chip — B4", () => {
  it("reads `3 EMIRATES DEFAULT · 2 NARROWER · 1 WIDER` for the board's four rows", () => {
    expect(coverageTally(DEFAULT, [[], [dubai, sharjah], SEVEN, [dubai]])).toEqual({
      defaultEmirates: 3,
      inherited: 1,
      same: 0,
      narrowed: 2,
      wider: 1,
    });
  });

  it("counts a default emirate once whether it is held whole or through an area", () => {
    expect(coverageTally([dubai, alQuoz, alAin], []).defaultEmirates).toBe(2);
  });

  it("changes when the default changes, with no row touched", () => {
    const rows = [[], [dubai, sharjah], [dubai]];
    expect(coverageTally(DEFAULT, rows)).toMatchObject({ narrowed: 2, wider: 0 });
    expect(coverageTally([dubai], rows)).toMatchObject({
      defaultEmirates: 1,
      same: 1,
      wider: 1,
      narrowed: 0,
    });
  });

  it("is all zeros with no services, and still counts the default", () => {
    expect(coverageTally(DEFAULT, [])).toEqual({
      defaultEmirates: 3,
      inherited: 0,
      same: 0,
      narrowed: 0,
      wider: 0,
    });
  });
});
