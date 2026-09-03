import { describe, expect, it } from "vitest";
import { formatCountdown, formatDate, formatDateRange, formatDateShort, formatDateTime, formatDuration, formatMonth, formatRelative, isWithinRelativeWindow } from "./date";

const AUG_14 = new Date("2026-08-14T09:30:00+04:00");

describe("formatDate", () => {
  it("renders the form the design system specifies", () => {
    expect(formatDate(AUG_14)).toBe("14 Aug 2026");
  });

  it("reads the date in Dubai, not on the server", () => {
    // Vercel runs UTC. 21:30 UTC on the 13th is already the 14th in Dubai, and
    // the buyer and the seller must not see different days.
    expect(formatDate(new Date("2026-08-13T21:30:00Z"))).toBe("14 Aug 2026");
    expect(formatDate(new Date("2026-08-13T19:30:00Z"))).toBe("13 Aug 2026");
  });

  it("honours an explicit zone when one is passed", () => {
    expect(formatDate(new Date("2026-08-13T21:30:00Z"), { timeZone: "UTC" })).toBe("13 Aug 2026");
  });

  it("accepts an ISO string or an epoch", () => {
    expect(formatDate("2026-08-14T09:30:00+04:00")).toBe("14 Aug 2026");
    expect(formatDate(AUG_14.getTime())).toBe("14 Aug 2026");
  });

  it("throws on an invalid date rather than printing Invalid Date", () => {
    expect(() => formatDate("not a date")).toThrow(TypeError);
  });
});

describe("formatDateShort and formatDateTime", () => {
  it("drops the year, and pairs the date with a 24-hour clock", () => {
    expect(formatDateShort(AUG_14)).toBe("14 Aug");
    expect(formatDateTime(AUG_14)).toBe("14 Aug 2026, 09:30");
  });
});

describe("formatDateRange", () => {
  it("collapses a same-month range to one month and year", () => {
    expect(formatDateRange("2026-08-14T08:00:00+04:00", "2026-08-18T08:00:00+04:00")).toBe(
      "14–18 Aug 2026",
    );
  });

  it("keeps both months inside one year, every month three letters", () => {
    expect(formatDateRange("2026-08-30T08:00:00+04:00", "2026-09-02T08:00:00+04:00")).toBe(
      "30 Aug – 2 Sep 2026",
    );
  });

  it("spells both dates out across a year boundary", () => {
    expect(formatDateRange("2026-12-30T08:00:00+04:00", "2027-01-02T08:00:00+04:00")).toBe(
      "30 Dec 2026 – 2 Jan 2027",
    );
  });

  it("collapses a single day to a single date", () => {
    expect(formatDateRange(AUG_14, AUG_14)).toBe("14 Aug 2026");
  });

  it("uses an en dash, not a hyphen", () => {
    expect(formatDateRange("2026-08-14T08:00:00+04:00", "2026-08-18T08:00:00+04:00")).toContain("–");
    expect(formatDateRange("2026-08-14T08:00:00+04:00", "2026-08-18T08:00:00+04:00")).not.toContain("-");
  });
});

describe("formatRelative", () => {
  const now = new Date("2026-08-14T12:00:00+04:00");
  const ago = (ms: number) => formatRelative(new Date(now.getTime() - ms), { now });

  it("walks the ladder the design system draws", () => {
    expect(ago(4 * 60_000)).toBe("4 min ago");
    expect(ago(2 * 3_600_000)).toBe("2 h ago");
    expect(ago(2 * 86_400_000 + 4 * 3_600_000)).toBe("2 d 4 h ago");
  });

  it("says now under a minute", () => {
    expect(ago(0)).toBe("now");
    expect(ago(59_000)).toBe("now");
    expect(ago(60_000)).toBe("1 min ago");
  });

  it("never shows more than two units", () => {
    const s = ago(2 * 86_400_000 + 4 * 3_600_000 + 37 * 60_000);
    expect(s).toBe("2 d 4 h ago");
  });

  it("drops the smaller unit when it is zero", () => {
    expect(ago(3 * 3_600_000)).toBe("3 h ago");
    expect(ago(3 * 86_400_000)).toBe("3 d ago");
  });

  it("gives up and shows the date past a week", () => {
    expect(ago(7 * 86_400_000)).toBe("7 Aug 2026");
    expect(ago(40 * 86_400_000)).toBe("5 Jul 2026");
  });

  it("mirrors the ladder into the future for closing and renewal dates", () => {
    const inMs = (ms: number) => formatRelative(new Date(now.getTime() + ms), { now });
    expect(inMs(45 * 60_000)).toBe("in 45 min");
    expect(inMs(2 * 3_600_000)).toBe("in 2 h");
    expect(inMs(2 * 86_400_000 + 4 * 3_600_000)).toBe("in 2 d 4 h");
  });

  it("takes the reference time as an argument so it is deterministic", () => {
    expect(formatRelative("2026-08-14T11:56:00+04:00", { now: "2026-08-14T12:00:00+04:00" })).toBe(
      "4 min ago",
    );
  });
});

describe("formatDuration", () => {
  it("renders an elapsed span with at most two units", () => {
    expect(formatDuration(30_000)).toBe("under a minute");
    expect(formatDuration(4 * 60_000)).toBe("4 min");
    expect(formatDuration(2 * 3_600_000)).toBe("2 h");
    expect(formatDuration(2 * 3_600_000 + 14 * 60_000)).toBe("2 h 14 min");
    expect(formatDuration(2 * 86_400_000 + 4 * 3_600_000)).toBe("2 d 4 h");
  });

  it("rejects a negative duration", () => {
    expect(() => formatDuration(-1)).toThrow(TypeError);
  });
});

describe("isWithinRelativeWindow", () => {
  const now = "2026-08-24T12:00:00+04:00";

  it("is true while formatRelative would still count", () => {
    expect(isWithinRelativeWindow("2026-08-26T12:00:00+04:00", { now })).toBe(true);
    expect(isWithinRelativeWindow("2026-08-20T12:00:00+04:00", { now })).toBe(true);
  });

  it("is false once formatRelative would print a date instead", () => {
    // The two must agree, or a caller writes "Closes in 7 Sep 2026".
    const far = "2026-09-07T12:00:00+04:00";
    expect(isWithinRelativeWindow(far, { now })).toBe(false);
    expect(formatRelative(far, { now })).toBe("7 Sep 2026");
  });

  it("turns over at exactly the documented threshold", () => {
    expect(isWithinRelativeWindow("2026-08-31T11:59:00+04:00", { now })).toBe(true);
    expect(isWithinRelativeWindow("2026-08-31T12:00:00+04:00", { now })).toBe(false);
  });

  it("takes a caller's own window", () => {
    expect(isWithinRelativeWindow("2026-09-07T12:00:00+04:00", { now, absoluteAfterDays: 30 })).toBe(true);
  });
});

describe("formatCountdown", () => {
  const now = "2026-08-24T12:00:00+04:00";

  it("drops the direction so a caller can write its own sentence", () => {
    expect(formatCountdown("2026-08-30T09:00:00+04:00", { now })).toBe("5 d 21 h");
    expect(formatCountdown("2026-08-24T10:00:00+04:00", { now })).toBe("2 h");
  });

  it("says the same thing in both directions", () => {
    // "Closes in 2 h" and "replied 2 h ago" share a number.
    expect(formatCountdown("2026-08-24T14:00:00+04:00", { now })).toBe("2 h");
    expect(formatCountdown("2026-08-24T10:00:00+04:00", { now })).toBe("2 h");
  });
});

describe("formatMonth", () => {
  /**
   * Board 1d asks for certificate validity to the month, and the reason is the
   * test: a precise expiry makes a page look wrong for the twenty-four hours
   * either side of it, and "valid until March 2027" is the fact a buyer uses.
   */
  it("renders a month and a year, and no day", () => {
    const value = formatMonth("2027-03-18T00:00:00Z");
    expect(value).toMatch(/Mar/);
    expect(value).toMatch(/2027/);
    expect(value).not.toMatch(/18/);
  });

  it("reads the date in Dubai, not the host's zone", () => {
    /*
     * 21:00 UTC on the last day of February is already March in Dubai. A
     * formatter using the host clock would print February here for four hours
     * every night, which on a certificate is the difference between valid and
     * expired.
     */
    expect(formatMonth("2027-02-28T21:00:00Z")).toMatch(/Mar/);
  });

  it("accepts a Date as readily as a string", () => {
    expect(formatMonth(new Date("2027-03-18T00:00:00Z"))).toBe(
      formatMonth("2027-03-18T00:00:00Z"),
    );
  });

  it("refuses a value that is not a date", () => {
    // Same contract as every other formatter here: a bad input is a throw, not
    // a quietly wrong month on somebody's certificate.
    expect(() => formatMonth("not a date")).toThrow(TypeError);
  });
});
