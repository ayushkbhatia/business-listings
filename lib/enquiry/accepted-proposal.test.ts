import { describe, expect, it } from "vitest";
import {
  anniversary,
  contractPhase,
  firstCycle,
  isOngoing,
  proposalCommitments,
  reviewOpen,
  reviewOpensOn,
  termDates,
  toContractFacts,
  type ContractFacts,
} from "./accepted-proposal";

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
/** Noon in Dubai on that calendar day. */
const noonDubai = (iso: string) => new Date(`${iso}T12:00:00+04:00`);

const brief = (over: Partial<NonNullable<ContractFacts["brief"]>> = {}): NonNullable<ContractFacts["brief"]> => ({
  engagementType: "ongoing_contract",
  cadence: "quarterly",
  startMode: "from_date",
  startsOn: day("2026-11-01"),
  ...over,
});

const contract = (over: Partial<ContractFacts> = {}): ContractFacts => ({
  acceptedAt: noonDubai("2026-09-12"),
  proposal: { termMonths: 24 },
  brief: brief(),
  ...over,
});

describe("anniversary", () => {
  it("keeps the calendar day", () => {
    expect(anniversary(day("2026-11-01"), 24)).toEqual(day("2028-11-01"));
    expect(anniversary(day("2026-11-15"), 3)).toEqual(day("2027-02-15"));
  });

  it("rolls a day the month does not have to the first of the next, never past it", () => {
    expect(anniversary(day("2027-01-31"), 1)).toEqual(day("2027-03-01"));
    expect(anniversary(day("2028-02-29"), 12)).toEqual(day("2029-03-01"));
    expect(anniversary(day("2028-01-31"), 1)).toEqual(day("2028-03-01"));
  });
});

describe("termDates — B4, a term with both its duration and its dates", () => {
  it("runs from the brief's start date to the day before its anniversary", () => {
    expect(termDates(contract())).toEqual({ start: day("2026-11-01"), end: day("2028-10-31") });
  });

  it("ends a one-month term from 31 Jan on 28 Feb", () => {
    expect(termDates(contract({ proposal: { termMonths: 1 }, brief: brief({ startsOn: day("2027-01-31") }) }))?.end).toEqual(
      day("2027-02-28"),
    );
  });

  it("has no dates without a start anybody wrote down, and does not borrow acceptance for one", () => {
    expect(termDates(contract({ brief: brief({ startMode: "asap", startsOn: null }) }))).toBeNull();
    expect(termDates(contract({ brief: null }))).toBeNull();
  });

  it("has no dates without a term", () => {
    expect(termDates(contract({ proposal: { termMonths: null } }))).toBeNull();
  });
});

describe("contractPhase — read off the calendar, never off the work", () => {
  it("is not started before the first day", () => {
    expect(contractPhase(contract(), noonDubai("2026-10-30"))).toMatchObject({ kind: "not_started", daysToStart: 2 });
  });

  it("is running on the first day, and until the last ninety", () => {
    expect(contractPhase(contract(), noonDubai("2026-11-01"))).toMatchObject({ kind: "running" });
  });

  it("is ending inside ninety days, counting the last day itself", () => {
    // 2 Aug to 31 Oct is 91 days with both ends counted; 3 Aug is the first of the last 90.
    expect(contractPhase(contract(), noonDubai("2028-08-02"))).toMatchObject({ kind: "running" });
    expect(contractPhase(contract(), noonDubai("2028-08-03"))).toMatchObject({ kind: "ending", daysLeft: 90 });
    expect(contractPhase(contract(), noonDubai("2028-10-31"))).toMatchObject({ kind: "ending", daysLeft: 1 });
  });

  it("has ended the day after the last", () => {
    expect(contractPhase(contract(), noonDubai("2028-11-01"))).toMatchObject({ kind: "ended" });
  });

  it("counts days in Dubai, so a buyer reading at 1am is not a day ahead or behind", () => {
    // 00:30 on 1 Nov in Dubai is 20:30 on 31 Oct in UTC — the term has started.
    expect(contractPhase(contract(), new Date("2026-11-01T00:30:00+04:00"))).toMatchObject({ kind: "running" });
  });

  it("is undated without a start date", () => {
    expect(contractPhase(contract({ brief: brief({ startMode: "asap", startsOn: null }) }), noonDubai("2027-01-01"))).toEqual({
      kind: "undated",
    });
  });
});

describe("reviewOpensOn — B10, nothing to review on day one", () => {
  it("opens a goods quote at acceptance, as 7c always had it", () => {
    expect(reviewOpensOn(contract({ proposal: null }))).toEqual(day("2026-09-12"));
  });

  it("opens an ongoing engagement a quarter after the brief's start", () => {
    expect(reviewOpensOn(contract())).toEqual(day("2027-02-01"));
  });

  it("opens a monthly engagement a month after its start", () => {
    expect(reviewOpensOn(contract({ brief: brief({ cadence: "monthly" }) }))).toEqual(day("2026-12-01"));
  });

  it("caps an annual cadence at a quarter rather than a year", () => {
    expect(firstCycle("annually")).toEqual({ months: 3, unit: "quarter" });
    expect(reviewOpensOn(contract({ brief: brief({ cadence: "annually" }) }))).toEqual(day("2027-02-01"));
  });

  it("counts from acceptance when the start was as soon as possible, or already past", () => {
    expect(reviewOpensOn(contract({ brief: brief({ startMode: "asap", startsOn: null }) }))).toEqual(day("2026-12-12"));
    expect(reviewOpensOn(contract({ brief: brief({ startsOn: day("2026-01-01") }) }))).toEqual(day("2026-12-12"));
  });

  it("opens a one-off job on its start date, or at acceptance", () => {
    const oneOff = brief({ engagementType: "one_off_job", cadence: null });
    expect(reviewOpensOn(contract({ proposal: { termMonths: null }, brief: oneOff }))).toEqual(day("2026-11-01"));
    expect(
      reviewOpensOn(contract({ proposal: { termMonths: null }, brief: { ...oneOff, startMode: "asap", startsOn: null } })),
    ).toEqual(day("2026-09-12"));
  });

  it("treats a stated term as an engagement even with no brief", () => {
    expect(isOngoing(contract({ brief: null }))).toBe(true);
    expect(reviewOpensOn(contract({ brief: null }))).toEqual(day("2026-12-12"));
    expect(reviewOpensOn(contract({ brief: null, proposal: { termMonths: null } }))).toEqual(day("2026-09-12"));
  });

  it("is open from the start of that day in Dubai", () => {
    expect(reviewOpen(contract(), new Date("2027-01-31T23:59:00+04:00"))).toBe(false);
    expect(reviewOpen(contract(), new Date("2027-02-01T00:01:00+04:00"))).toBe(true);
  });

  it("has nothing to count from without an acceptance date, and reads as open", () => {
    expect(reviewOpensOn(contract({ acceptedAt: null }))).toBeNull();
    expect(reviewOpen(contract({ acceptedAt: null }), noonDubai("2026-09-13"))).toBe(true);
  });
});

describe("proposalCommitments — B6, the proposal's fields, each with its source", () => {
  const proposal = {
    mobilisationAed: "6000.00",
    turnaround: "4-hour attendance on reactive calls",
    deliverable: "Monthly written report",
    deliveredWhere: "On site",
  };

  it("lists what was stated, in the rail's order, labelled by where it came from", () => {
    expect(proposalCommitments({ proposal, brief: brief() }).map((c) => [c.kind, c.source])).toEqual([
      ["start", "brief"],
      ["mobilisation", "proposal"],
      ["cadence", "brief"],
      ["turnaround", "scope_sheet"],
      ["deliverable", "deliverable"],
      ["delivered_where", "proposal"],
    ]);
  });

  it("leaves out what was not stated, and a nil mobilisation, rather than listing Not stated", () => {
    const bare = proposalCommitments({
      proposal: { mobilisationAed: "0.00", turnaround: null, deliverable: null, deliveredWhere: null },
      brief: brief({ startMode: "asap", startsOn: null, cadence: null }),
    });
    expect(bare).toEqual([]);
  });

  it("names no engineer, because no field holds one", () => {
    const kinds = proposalCommitments({ proposal, brief: brief() }).map((c) => c.kind);
    expect(kinds).not.toContain("engineer");
  });
});

describe("toContractFacts", () => {
  const row = {
    contactReleasedAt: noonDubai("2026-09-12"),
    contactReleasedToBusinessId: "efg",
    serviceBrief: brief(),
    quotes: [
      { businessId: "other", acceptedAt: noonDubai("2026-09-01"), proposal: { termMonths: 6, feeAed: "1" } },
      { businessId: "efg", acceptedAt: noonDubai("2026-09-12"), proposal: { termMonths: 24, feeAed: "18400" } },
    ],
  };

  it("reads the accepted quote of the business contact was released to", () => {
    expect(toContractFacts(row)).toEqual({ acceptedAt: noonDubai("2026-09-12"), proposal: { termMonths: 24 }, brief: brief() });
  });

  it("reads a goods quote, and a proposal row with no fee, as no proposal", () => {
    expect(toContractFacts({ ...row, quotes: [{ businessId: "efg", acceptedAt: null, proposal: null }] }).proposal).toBeNull();
    expect(
      toContractFacts({ ...row, quotes: [{ businessId: "efg", acceptedAt: null, proposal: { termMonths: 3, feeAed: null } }] }).proposal,
    ).toBeNull();
  });
});
