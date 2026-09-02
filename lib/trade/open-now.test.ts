import { describe, expect, it } from "vitest";
import { dubaiNow, openNow } from "./open-now";
import type { RamadanHours, WeekHours } from "./hours";

/**
 * Board 1d criterion 7, at the layer that decides it.
 *
 * Every instant below is written in UTC and asserted in Asia/Dubai, which is
 * the whole point: the answer must not depend on where the page renders. A test
 * that built its dates from local time would pass on a laptop in Dubai and
 * prove nothing about the machine that serves the page.
 */

/** Sunday to Thursday, 08:00–18:00. A normal UAE trade counter. */
const COUNTER: WeekHours = {
  sun: [{ open: "08:00", close: "18:00" }],
  mon: [{ open: "08:00", close: "18:00" }],
  tue: [{ open: "08:00", close: "18:00" }],
  wed: [{ open: "08:00", close: "18:00" }],
  thu: [{ open: "08:00", close: "18:00" }],
  sat: [{ open: "09:00", close: "13:00" }],
};

// 2026-09-02 is a Wednesday. Dubai is UTC+4 year round, no daylight saving.
const wednesday = (utc: string) => new Date(`2026-09-02T${utc}Z`);

describe("dubaiNow", () => {
  it("reads the wall clock in Dubai, not the host's", () => {
    // 06:00 UTC is 10:00 in Dubai, still Wednesday.
    expect(dubaiNow(wednesday("06:00:00"))).toEqual({ day: "wed", minutes: 10 * 60 });
  });

  it("rolls the day over at Dubai midnight, not UTC midnight", () => {
    /*
     * 21:00 UTC Wednesday is 01:00 Thursday in Dubai. A host-clock reading
     * would still say Wednesday and would apply the wrong day's hours for four
     * hours every night.
     */
    expect(dubaiNow(wednesday("21:00:00"))).toEqual({ day: "thu", minutes: 60 });
  });

  it("reports midnight as zero minutes, not 1440", () => {
    // 20:00 UTC is 00:00 Thursday. Some ICU versions render that hour as 24.
    expect(dubaiNow(wednesday("20:00:00"))).toEqual({ day: "thu", minutes: 0 });
  });
});

describe("openNow", () => {
  it("says open, and until when", () => {
    // 10:00 Dubai, inside 08:00–18:00.
    expect(openNow(COUNTER, null, wednesday("06:00:00"))).toEqual({
      state: "open",
      until: "18:00",
      isRamadan: false,
    });
  });

  it("says closed before opening, with the time it opens", () => {
    // 07:00 Dubai.
    expect(openNow(COUNTER, null, wednesday("03:00:00"))).toMatchObject({
      state: "closed",
      opensAt: "08:00",
      opensDay: "wed",
    });
  });

  it("rolls to the next trading day after closing", () => {
    // 19:00 Dubai Wednesday — shut, and the next opening is Thursday.
    expect(openNow(COUNTER, null, wednesday("15:00:00"))).toMatchObject({
      state: "closed",
      opensAt: "08:00",
      opensDay: "thu",
    });
  });

  it("skips the days a supplier does not trade", () => {
    /*
     * Friday evening. This counter is shut Friday and open 09:00 Saturday, so
     * "tomorrow" is the right answer only because the search walks the week —
     * a supplier closed Friday *and* Saturday would need Sunday.
     */
    const friday = new Date("2026-09-04T15:00:00Z");
    expect(openNow(COUNTER, null, friday)).toMatchObject({
      state: "closed",
      opensAt: "09:00",
      opensDay: "sat",
    });
  });

  it("handles a shift that crosses midnight", () => {
    // A 24-hour depot: 22:00 to 06:00. At 01:00 Dubai it is open.
    const depot: WeekHours = { thu: [{ open: "22:00", close: "06:00" }] };
    expect(openNow(depot, null, wednesday("21:00:00"))).toMatchObject({
      state: "open",
      until: "06:00",
    });
  });

  it("applies Ramadan hours automatically inside the window", () => {
    /*
     * The switch being automatic is the feature — a seller who set reduced
     * hours in March should not have to remember to turn them on. 2027's window
     * opens 2027-02-07 in the table.
     */
    const ramadan: RamadanHours = { all: [{ open: "09:00", close: "15:00" }] };
    const inRamadan = new Date("2027-02-20T06:00:00Z"); // 10:00 Dubai
    const state = openNow(COUNTER, ramadan, inRamadan);
    expect(state).toMatchObject({ state: "open", until: "15:00", isRamadan: true });
  });

  it("does not apply Ramadan hours outside the window", () => {
    const ramadan: RamadanHours = { all: [{ open: "09:00", close: "15:00" }] };
    const state = openNow(COUNTER, ramadan, wednesday("06:00:00"));
    expect(state).toMatchObject({ state: "open", until: "18:00", isRamadan: false });
  });

  it("is unknown, never closed, when there are no hours on file", () => {
    /*
     * The rule that matters most here. Absent data is not evidence of a shut
     * door, and "Closed" on a supplier who never told us their hours is a fact
     * invented against them — the same reason an unpinned location is excluded
     * from the map rather than placed at a centroid.
     */
    expect(openNow(null, null)).toEqual({ state: "unknown" });
    expect(openNow({}, null)).toEqual({ state: "unknown" });
    expect(openNow({ sun: [] }, null)).toEqual({ state: "unknown" });
  });
});
