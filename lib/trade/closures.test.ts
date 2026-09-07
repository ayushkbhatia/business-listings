import { describe, expect, it } from "vitest";
import {
  JUMUAH_BREAK,
  keepsJumuah,
  ramadanNeedsConfirming,
  rulingFor,
  type BranchSchedule,
} from "./closures";
import type { RamadanCalendar, WeekHours } from "./hours";

/*
   A fixed calendar, so the tests describe the rule rather than the year the
   suite happens to run in. Ramadan 2027 as the platform publishes it.
*/
const CALENDAR: RamadanCalendar = { 2027: { from: "2027-02-07", to: "2027-03-08" } };

const WEEK: WeekHours = {
  sun: [],
  mon: [{ open: "08:00", close: "18:00" }],
  tue: [{ open: "08:00", close: "18:00" }],
  wed: [{ open: "08:00", close: "18:00" }],
  thu: [{ open: "08:00", close: "18:00" }],
  fri: [{ open: "08:00", close: "12:00" }, { open: "14:00", close: "18:00" }],
  sat: [{ open: "09:00", close: "14:00" }],
};

/** A Monday well outside Ramadan and every holiday below. */
const ORDINARY = new Date("2027-05-10T09:00:00Z");
/** A Monday inside the 2027 window. */
const IN_RAMADAN = new Date("2027-02-15T09:00:00Z");

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

function schedule(over: Partial<BranchSchedule> = {}): BranchSchedule {
  return {
    hours: WEEK,
    ramadanHours: { all: [{ open: "09:00", close: "15:00" }] },
    calendar: CALENDAR,
    ...over,
  };
}

describe("the order", () => {
  it("puts the standard week at the bottom", () => {
    const ruling = rulingFor(ORDINARY, schedule());
    expect(ruling.kind).toBe("standard");
    expect(ruling.shifts).toEqual([{ open: "08:00", close: "18:00" }]);
  });

  it("puts Ramadan above the standard week", () => {
    // The switch is automatic — a seller who set reduced hours in February
    // should not have to remember to turn them on.
    const ruling = rulingFor(IN_RAMADAN, schedule());
    expect(ruling.kind).toBe("ramadan");
    expect(ruling.shifts).toEqual([{ open: "09:00", close: "15:00" }]);
  });

  it("puts a holiday above Ramadan, and says the two collided", () => {
    /*
       Criterion 7, and board 3d's second correction. The board listed the last
       day of Ramadan hours and the first day of the Eid closure on one screen
       with no rule between them.
    */
    const eid = {
      id: "eid",
      name: "Eid Al Fitr",
      startsOn: day("2027-02-15"),
      endsOn: day("2027-02-18"),
      openFrom: null,
      openUntil: null,
    };
    const ruling = rulingFor(IN_RAMADAN, schedule({ holidays: [eid] }));

    expect(ruling).toMatchObject({
      kind: "holiday",
      name: "Eid Al Fitr",
      official: true,
      alsoRamadan: true,
      shifts: [],
    });
  });

  it("puts a temporary closure above everything, including a holiday", () => {
    const eid = {
      id: "eid",
      name: "Eid Al Fitr",
      startsOn: day("2027-02-15"),
      endsOn: day("2027-02-18"),
      openFrom: null,
      openUntil: null,
    };
    const ruling = rulingFor(
      IN_RAMADAN,
      schedule({
        holidays: [eid],
        temporaryClosure: {
          from: day("2027-02-10"),
          until: day("2027-02-20"),
          reason: "Roof repairs after the storm.",
        },
      }),
    );

    // The more specific and more recent statement of fact wins: if the seller
    // says the warehouse is shut, it is shut.
    expect(ruling).toMatchObject({ kind: "temporary_closure", shifts: [] });
    if (ruling.kind === "temporary_closure") {
      expect(ruling.reason).toContain("Roof repairs");
    }
  });

  it("prefers the seller's own date to an official one on the same day", () => {
    // Both are holidays; the seller's is the more specific statement about this
    // branch, and the rail marks it as theirs to maintain.
    const ruling = rulingFor(
      ORDINARY,
      schedule({
        holidays: [
          { id: "nd", name: "UAE National Day", startsOn: day("2027-05-10"), endsOn: day("2027-05-10"), openFrom: null, openUntil: null },
        ],
        closures: [
          { id: "own", reason: "Annual stock-take", startsOn: day("2027-05-10"), endsOn: day("2027-05-10"), openFrom: null, openUntil: null },
        ],
      }),
    );
    expect(ruling).toMatchObject({ kind: "holiday", name: "Annual stock-take", official: false });
  });
});

describe("a half day", () => {
  it("carries its hours rather than closing the branch", () => {
    // Criterion 8 and correction 6: the board rendered a `Half day` pill, a
    // date, and no times at all.
    const ruling = rulingFor(
      ORDINARY,
      schedule({
        holidays: [
          {
            id: "hijri",
            name: "Islamic New Year",
            startsOn: day("2027-05-10"),
            endsOn: day("2027-05-10"),
            openFrom: "08:00",
            openUntil: "12:00",
          },
        ],
      }),
    );
    expect(ruling.shifts).toEqual([{ open: "08:00", close: "12:00" }]);
  });
});

describe("dates are dates", () => {
  it("reads a DATE column's UTC midnight as the day it names", () => {
    /*
       Postgres hands a bare date back as midnight UTC, which formats to the
       *previous* day in Dubai. Read the wrong way, National Day would begin on
       the 1st and the whole calendar would sit a day early — the sort of wrong
       nobody notices until a buyer drives to a closed gate.
    */
    const holiday = {
      id: "nd",
      name: "UAE National Day",
      startsOn: day("2027-12-02"),
      endsOn: day("2027-12-03"),
      openFrom: null,
      openUntil: null,
    };
    // 23:00 UTC on the 1st is already the 2nd in Dubai.
    const eveningBefore = new Date("2027-12-01T23:30:00Z");
    expect(rulingFor(eveningBefore, schedule({ holidays: [holiday] })).kind).toBe("holiday");
    // And 19:00 UTC on the 3rd is still the 3rd there.
    expect(rulingFor(new Date("2027-12-03T19:00:00Z"), schedule({ holidays: [holiday] })).kind).toBe("holiday");
    // The 4th is not.
    expect(rulingFor(new Date("2027-12-04T09:00:00Z"), schedule({ holidays: [holiday] })).kind).toBe("standard");
  });
});

describe("ramadanNeedsConfirming", () => {
  const window = { year: 2027 };

  it("asks when the confirmation names another year", () => {
    expect(ramadanNeedsConfirming(2026, { all: [{ open: "09:00", close: "15:00" }] }, window)).toBe(true);
    expect(ramadanNeedsConfirming(null, { all: [{ open: "09:00", close: "15:00" }] }, window)).toBe(true);
  });

  it("stops asking once the year matches", () => {
    expect(ramadanNeedsConfirming(2027, { all: [{ open: "09:00", close: "15:00" }] }, window)).toBe(false);
  });

  it("does not nag a seller who has never stated Ramadan hours", () => {
    // There is nothing to re-confirm, and board 3a's card would be pointing at
    // a section they chose to leave alone.
    expect(ramadanNeedsConfirming(null, null, window)).toBe(false);
    expect(ramadanNeedsConfirming(null, {}, window)).toBe(false);
  });

  it("says nothing past the end of the calendar", () => {
    expect(ramadanNeedsConfirming(null, { all: [{ open: "09:00", close: "15:00" }] }, null)).toBe(false);
  });
});

describe("Jumu'ah", () => {
  it("recognises the break as a gap the seller kept, not a rule", () => {
    expect(keepsJumuah(WEEK.fri!)).toBe(true);
    expect(JUMUAH_BREAK).toEqual({ from: "12:00", to: "14:00" });
  });

  it("reports a Friday without it rather than enforcing one", () => {
    // It is not the platform's place to decide a business closes for prayer.
    expect(keepsJumuah([{ open: "08:00", close: "18:00" }])).toBe(false);
    expect(keepsJumuah([{ open: "08:00", close: "11:00" }, { open: "15:00", close: "18:00" }])).toBe(false);
  });
});

