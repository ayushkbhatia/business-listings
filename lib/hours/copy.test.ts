import { describe, expect, it } from "vitest";
import { copyPreview, sameWeek, summarise } from "./copy";
import type { Day, WeekHours } from "@/lib/trade/hours";

const LABEL: Record<Day, string> = {
  sun: "Sun", mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat",
};

const OFFICE: WeekHours = {
  sun: [],
  mon: [{ open: "08:00", close: "18:00" }],
  tue: [{ open: "08:00", close: "18:00" }],
  wed: [{ open: "08:00", close: "18:00" }],
  thu: [{ open: "08:00", close: "18:00" }],
  fri: [],
  sat: [],
};

const DEPOT: WeekHours = {
  sun: [{ open: "06:00", close: "14:00" }],
  mon: [{ open: "06:00", close: "14:00" }],
  tue: [{ open: "06:00", close: "14:00" }],
  wed: [{ open: "06:00", close: "14:00" }],
  thu: [{ open: "06:00", close: "14:00" }],
  fri: [],
  sat: [],
};

describe("summarise", () => {
  it("groups runs of identical days", () => {
    // Seven rows per branch across five branches is a wall a seller reads none
    // of, and the thing they are looking for is the branch that differs.
    expect(summarise(OFFICE, LABEL, "Closed")).toBe(
      "Sun Closed · Mon–Thu 08:00–18:00 · Fri–Sat Closed",
    );
  });

  it("keeps both halves of a split shift", () => {
    const split: WeekHours = {
      ...OFFICE,
      fri: [{ open: "08:00", close: "12:00" }, { open: "14:00", close: "18:00" }],
    };
    expect(summarise(split, LABEL, "Closed")).toContain("Fri 08:00–12:00, 14:00–18:00");
  });
});

describe("copyPreview", () => {
  const branches = [
    { id: "head", name: "Al Quoz head office", hours: OFFICE },
    { id: "depot", name: "Sharjah depot", hours: DEPOT },
    { id: "twin", name: "Deira office", hours: OFFICE },
  ];

  it("names every target and what it keeps today — criterion 2", () => {
    const preview = copyPreview(branches, "head", OFFICE, LABEL, "Closed");
    expect(preview.targets.map((target) => target.name)).toEqual([
      "Sharjah depot",
      "Deira office",
    ]);
    expect(preview.targets[0]!.summary).toContain("06:00–14:00");
  });

  it("never lists the branch being copied from", () => {
    // Copying a week onto itself is not a change, and listing it would pad the
    // number on the confirm button.
    const preview = copyPreview(branches, "head", OFFICE, LABEL, "Closed");
    expect(preview.targets.some((target) => target.id === "head")).toBe(false);
  });

  it("counts only the branches that would actually move", () => {
    /*
       Board 3d's fourth correction is about blast radius, and the honest
       radius is the branches whose hours differ. `Copy to 2 other branches…`
       over one real change would overstate what the seller is agreeing to.
    */
    const preview = copyPreview(branches, "head", OFFICE, LABEL, "Closed");
    expect(preview.targets).toHaveLength(2);
    expect(preview.changing).toBe(1);
    expect(preview.targets.find((target) => target.id === "twin")!.unchanged).toBe(true);
  });
});

describe("sameWeek", () => {
  it("ignores the public-holiday practice, which is not a shift", () => {
    expect(sameWeek({ ...OFFICE, publicHolidays: "closed" }, OFFICE)).toBe(true);
  });

  it("sees a changed time", () => {
    expect(sameWeek(OFFICE, { ...OFFICE, mon: [{ open: "09:00", close: "18:00" }] })).toBe(false);
  });
});
