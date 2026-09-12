import { describe, expect, it } from "vitest";
import {
  COUNTING_BAR,
  MAX_BADGES,
  countsTowardTask,
  matchSheets,
  sheetShape,
  taskCount,
  thinServices,
  type CountableService,
} from "./setup-sheet";
import { REQUIRED_COUNT } from "./scope-sheet";

const complete = (over: Partial<CountableService> = {}): CountableService => ({
  id: "s1",
  live: true,
  name: "Statutory audit",
  engagementType: "ongoing_contract",
  feeBasis: "fixed_fee",
  turnaround: "3–4 weeks",
  deliveredWhere: "remote",
  deliverable: "Signed report",
  ...over,
});

/** The render's third row: live at 2 of 6, missing turnaround and fee basis. */
const thin = (over: Partial<CountableService> = {}): CountableService =>
  complete({
    id: "s3",
    name: "Corporate tax registration",
    feeBasis: null,
    turnaround: null,
    deliveredWhere: null,
    deliverable: null,
    ...over,
  });

describe("publishing and counting are two rules — B4, AC3, AC4", () => {
  it("counts a service only when it is live and at the bar", () => {
    expect(countsTowardTask(complete())).toBe(true);
    expect(countsTowardTask(complete({ live: false }))).toBe(false);
    expect(countsTowardTask(thin())).toBe(false);
  });

  it("takes a service at exactly the bar and refuses the one below it", () => {
    // Four of six: name, engagement type, fee basis, turnaround.
    const four = complete({ deliveredWhere: null, deliverable: null });
    expect(countsTowardTask(four)).toBe(true);

    const three = complete({ deliveredWhere: null, deliverable: null, feeBasis: null });
    expect(countsTowardTask(three)).toBe(false);
  });

  it("keeps the bar below the completeness total, or the two rules collapse", () => {
    /*
       If the counting bar were six, "publishes but does not count" would have
       no states between them and the task would be a completeness gate wearing
       a different name — which is the thing `3g-s` B4 exists to refuse.
    */
    expect(COUNTING_BAR).toBeGreaterThan(1);
    expect(COUNTING_BAR).toBeLessThan(REQUIRED_COUNT);
  });

  it("does not count whitespace as an answer", () => {
    const spaces = complete({ turnaround: "   ", deliverable: "  ", deliveredWhere: null });
    expect(countsTowardTask(spaces)).toBe(false);
  });
});

describe("the thin-service callout names the fields — B6, AC5", () => {
  it("names turnaround and fee basis, in the editor's order", () => {
    const [row] = thinServices([thin()]);
    expect(row!.filled).toBe(2);
    expect(row!.total).toBe(REQUIRED_COUNT);
    expect(row!.missing).toEqual(["feeBasis", "turnaround", "deliveredWhere", "deliverable"]);
  });

  it("leaves drafts alone — unfinished on purpose is not thin", () => {
    expect(thinServices([thin({ live: false })])).toEqual([]);
  });

  it("says nothing about a service that counts", () => {
    expect(thinServices([complete()])).toEqual([]);
  });
});

describe("the task's own arithmetic", () => {
  it("counts two of three live, with one thin — the render's state", () => {
    const state = taskCount([complete(), complete({ id: "s2" }), thin()], 3);
    expect(state.live).toBe(3);
    expect(state.counting).toBe(2);
    expect(state.toGo).toBe(1);
    expect(state.done).toBe(false);
    expect(state.thin.map((row) => row.name)).toEqual(["Corporate tax registration"]);
  });

  it("closes at three counting and never goes below zero beyond it", () => {
    const three = [complete(), complete({ id: "s2" }), complete({ id: "s3" })];
    expect(taskCount(three, 3)).toMatchObject({ counting: 3, toGo: 0, done: true });

    const six = [...three, complete({ id: "s4" }), complete({ id: "s5" }), complete({ id: "s6" })];
    expect(taskCount(six, 3)).toMatchObject({ counting: 6, toGo: 0, done: true });
  });
});

describe("the sheet's shape is counted, never claimed", () => {
  it("counts the rows and the filterable ones off the family itself", () => {
    const rows = [
      { filterable: true },
      { filterable: true },
      { filterable: false },
    ];
    expect(sheetShape(rows, 214)).toEqual({
      rows: 3,
      required: REQUIRED_COUNT,
      filterable: 2,
      usedBy: 214,
    });
  });

  it("reports zero firms as zero rather than hiding it", () => {
    // The cold state, and it is where this directory is: no seller has chosen a
    // sheet yet. The card decides how to render it; the shape must not lie.
    expect(sheetShape([], 0).usedBy).toBe(0);
  });
});

describe("matching badges come from what the firm offers — B2, AC2", () => {
  const families = [
    {
      id: "audit-and-assurance",
      name: "Audit & assurance",
      common: ["Statutory audit", "VAT return filing", "Corporate tax registration"],
    },
    {
      id: "facilities-management",
      name: "Facilities management",
      common: ["Planned preventive maintenance", "HVAC servicing", "Deep cleaning"],
    },
    { id: "general", name: "General services", common: [] },
  ];

  it("badges the sheet whose services the seller actually named", () => {
    const matched = matchSheets(families, ["Statutory audit", "VAT filing", "Corporate tax"]);
    expect(matched[0]!.id).toBe("audit-and-assurance");
    expect(matched[0]!.score).toBeGreaterThan(0);
  });

  it("never badges more than two", () => {
    const matched = matchSheets(families, [
      "Statutory audit",
      "HVAC servicing",
      "General services",
    ]);
    expect(matched.length).toBeLessThanOrEqual(MAX_BADGES);
  });

  it("badges nothing when nothing matches, rather than picking one", () => {
    /*
       An arbitrary badge is worse than no badge: the badge is the entire reason
       a seller trusts the first card over the third, and one that fires on no
       evidence teaches them to ignore it.
    */
    expect(matchSheets(families, ["Yacht chartering"])).toEqual([]);
    expect(matchSheets(families, [])).toEqual([]);
  });

  it("ignores tokens too short to mean anything", () => {
    // "tax" is three characters and sits in half the directory's copy. On its
    // own it must not badge the audit sheet.
    expect(matchSheets(families, ["tax"])).toEqual([]);
  });

  it("counts a service once however many phrases it matches", () => {
    /*
       "Corporate tax registration" hits two of the audit family's phrases. If
       the score summed them, a family would rank by how many near synonyms
       somebody happened to author for it rather than by fit.
    */
    const one = matchSheets(families, ["Corporate tax registration"]);
    const two = matchSheets(families, ["Corporate tax registration", "Deep cleaning"]);
    expect(one[0]!.score).toBeLessThanOrEqual(3);
    expect(two.map((row) => row.id).sort()).toEqual([
      "audit-and-assurance",
      "facilities-management",
    ]);
  });

  it("ranks the same way twice on tied scores", () => {
    const first = matchSheets(families, ["Statutory audit", "HVAC servicing"]);
    const again = matchSheets(families, ["Statutory audit", "HVAC servicing"]);
    expect(first).toEqual(again);
  });
});
