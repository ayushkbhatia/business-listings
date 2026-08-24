import { describe, expect, it } from "vitest";
import {
  DAYS,
  everyDay,
  hoursInEffect,
  isClosedAllWeek,
  minutesOf,
  nextRamadan,
  normalise,
  problemsWith,
  ramadanFor,
  type WeekHours,
} from "@/lib/trade/hours";

const COUNTER: WeekHours = {
  sun: [{ open: "08:00", close: "13:00" }, { open: "16:00", close: "20:00" }],
  mon: [{ open: "08:00", close: "13:00" }, { open: "16:00", close: "20:00" }],
  fri: [{ open: "08:00", close: "12:00" }],
  sat: [],
};

describe("the week", () => {
  it("starts on Sunday", () => {
    // The Gulf working week. A Monday-first editor puts the weekend in the
    // middle of the list.
    expect(DAYS[0]).toBe("sun");
    expect(DAYS).toHaveLength(7);
  });
});

describe("what is wrong with a week", () => {
  it("accepts a split shift", () => {
    // The norm, not an edge case: open at eight, shut for the afternoon, open
    // again at four.
    expect(problemsWith(COUNTER)).toEqual([]);
  });

  it("rejects a close before its open", () => {
    const problems = problemsWith({ sun: [{ open: "16:00", close: "08:00" }] });
    expect(problems).toEqual([{ day: "sun", kind: "backwards", open: "16:00", close: "08:00" }]);
  });

  it("rejects a close equal to its open", () => {
    expect(problemsWith({ sun: [{ open: "09:00", close: "09:00" }] })[0]?.kind).toBe("backwards");
  });

  it("catches a mistyped afternoon that swallows the morning", () => {
    // "16:00–20:00" entered as "06:00–20:00". Merging it silently would publish
    // hours the supplier does not keep.
    const problems = problemsWith({
      sun: [{ open: "08:00", close: "13:00" }, { open: "06:00", close: "20:00" }],
    });
    expect(problems.some((p) => p.kind === "overlap")).toBe(true);
  });

  it("rejects a time that is not a time", () => {
    const problems = problemsWith({ sun: [{ open: "8am", close: "13:00" }] });
    expect(problems[0]).toEqual({ day: "sun", kind: "bad_time", value: "8am" });
  });

  it("rejects an hour that does not exist", () => {
    expect(problemsWith({ sun: [{ open: "25:00", close: "26:00" }] })[0]?.kind).toBe("bad_time");
  });

  it("treats a closed day as fine, not as missing", () => {
    expect(problemsWith({ sat: [] })).toEqual([]);
    expect(problemsWith({})).toEqual([]);
  });
});

describe("normalise", () => {
  it("orders shifts and fills in every day", () => {
    const result = normalise({
      sun: [{ open: "16:00", close: "20:00" }, { open: "08:00", close: "13:00" }],
    });
    expect(result.sun?.[0]?.open).toBe("08:00");
    expect(Object.keys(result)).toHaveLength(7);
  });

  it("drops a half-typed shift rather than storing it", () => {
    const result = normalise({ sun: [{ open: "08:00", close: "" }] });
    expect(result.sun).toEqual([]);
  });

  it("makes two identical weeks compare equal whatever order they were typed in", () => {
    const a = normalise({ sun: [{ open: "16:00", close: "20:00" }, { open: "08:00", close: "13:00" }] });
    const b = normalise({ sun: [{ open: "08:00", close: "13:00" }, { open: "16:00", close: "20:00" }] });
    expect(a).toEqual(b);
  });
});

describe("helpers", () => {
  it("counts minutes from midnight", () => {
    expect(minutesOf("08:30")).toBe(510);
    expect(minutesOf("00:00")).toBe(0);
    expect(Number.isNaN(minutesOf("nope"))).toBe(true);
  });

  it("copies one day to all seven", () => {
    const week = everyDay([{ open: "09:00", close: "15:00" }]);
    expect(Object.keys(week)).toHaveLength(7);
    expect(week.sat).toEqual([{ open: "09:00", close: "15:00" }]);
  });

  it("knows a week with nothing in it", () => {
    expect(isClosedAllWeek({})).toBe(true);
    expect(isClosedAllWeek({ sun: [] })).toBe(true);
    expect(isClosedAllWeek(COUNTER)).toBe(false);
  });
});

describe("Ramadan", () => {
  it("knows the window for a year in the table", () => {
    const window = ramadanFor(2026);
    expect(window?.from.toISOString().slice(0, 10)).toBe("2026-02-17");
    expect(window?.to.toISOString().slice(0, 10)).toBe("2026-03-19");
  });

  it("says the dates are approximate rather than implying precision", () => {
    // Ramadan starts on a moon sighting announced a day or two beforehand. The
    // table is right to within a day at each end and the flag says so.
    expect(ramadanFor(2026)?.approximate).toBe(true);
  });

  it("returns nothing past the table rather than extrapolating", () => {
    // A lunar calendar extrapolated by arithmetic drifts. Better to have no
    // answer than a wrong one nobody checks.
    expect(ramadanFor(2044)).toBeNull();
  });

  it("is active inside its window and not outside it", () => {
    expect(ramadanFor(2026, new Date("2026-03-01T09:00:00Z"))?.active).toBe(true);
    expect(ramadanFor(2026, new Date("2026-04-01T09:00:00Z"))?.active).toBe(false);
    expect(ramadanFor(2026, new Date("2026-01-01T09:00:00Z"))?.active).toBe(false);
  });

  it("finds the next window from a date between two of them", () => {
    expect(nextRamadan(new Date("2026-06-01T00:00:00Z"))?.year).toBe(2027);
  });
});

describe("which hours apply today", () => {
  const ramadan = { all: [{ open: "09:00", close: "15:00" }] };

  it("uses the ordinary week outside Ramadan", () => {
    const result = hoursInEffect(COUNTER, ramadan, new Date("2026-06-01T09:00:00Z"));
    expect(result.isRamadan).toBe(false);
    expect(result.hours).toBe(COUNTER);
  });

  it("switches over inside Ramadan, without anybody doing anything", () => {
    // Automatic is the whole point. A supplier who has to remember to switch
    // will remember in week three.
    const result = hoursInEffect(COUNTER, ramadan, new Date("2026-03-01T09:00:00Z"));
    expect(result.isRamadan).toBe(true);
    expect(result.hours.sun).toEqual([{ open: "09:00", close: "15:00" }]);
    expect(result.hours.sat).toEqual([{ open: "09:00", close: "15:00" }]);
  });

  it("lets a single day override the blanket Ramadan hours", () => {
    const result = hoursInEffect(
      COUNTER,
      { ...ramadan, fri: [] },
      new Date("2026-03-01T09:00:00Z"),
    );
    expect(result.hours.fri).toEqual([]);
    expect(result.hours.sun).toEqual([{ open: "09:00", close: "15:00" }]);
  });

  it("keeps the ordinary week when no Ramadan hours were set", () => {
    const result = hoursInEffect(COUNTER, null, new Date("2026-03-01T09:00:00Z"));
    expect(result.isRamadan).toBe(false);
  });

  it("does not close a business because its Ramadan block is empty", () => {
    // An empty block is a seller who opened the section and left, not a
    // seller who shuts for a month.
    const result = hoursInEffect(COUNTER, {}, new Date("2026-03-01T09:00:00Z"));
    expect(result.isRamadan).toBe(false);
    expect(result.hours).toBe(COUNTER);
  });
});
