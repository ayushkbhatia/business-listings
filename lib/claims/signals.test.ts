import { describe, expect, it } from "vitest";
import { formatDuration } from "@/lib/format";
import { conflictClock, CONFLICT_SLA_HOURS } from "./clock";
import {
  assess,
  domainOf,
  emailDomain,
  looksLikeBranchOf,
  samePhone,
  scoreClaim,
  type ClaimFacts,
  type SourceRecord,
} from "./signals";

/**
 * Board 4c, as drawn: Cool Breeze Technical Services in Mussafah M-14, minted
 * from `ADDED-771204` by the January licence import, and two claims on it.
 */
const NOW = new Date("2026-08-22T18:02:00.000Z");

const SOURCE: SourceRecord = {
  legalName: "Cool Breeze Technical Services LLC",
  licenceNumber: "ADDED-771204",
  authority: "ADDED",
  address: { areaName: "Mussafah M-14", emirate: "abu_dhabi", addressLine: "Plot 22, Street 9" },
  phones: ["02 553 1190"],
  domain: "coolbreeze.ae",
};

const A: ClaimFacts = {
  id: "claim-a",
  route: "licence_upload",
  licenceNumber: "ADDED-771204",
  licenceExpiry: new Date("2027-03-01T00:00:00.000Z"),
  calledNumber: null,
  register: {
    tradeName: "Cool Breeze Technical Services LLC",
    areaName: "Mussafah M-14",
    emirate: "abu_dhabi",
    addressLine: "Plot 22, Street 9",
    phones: ["+971 2 553 1190"],
  },
  emailDomain: "coolbreeze.ae",
  call: { to: "public_record", confirmed: true },
};

const B: ClaimFacts = {
  id: "claim-b",
  route: "licence_upload",
  licenceNumber: "ADDED-802116",
  licenceExpiry: new Date("2026-12-01T00:00:00.000Z"),
  calledNumber: null,
  register: {
    tradeName: "Cool Breeze Air Cond. Maint.",
    areaName: "Mussafah M-14",
    emirate: "abu_dhabi",
    addressLine: "Plot 22, Street 9, Unit 4",
    phones: ["02 554 8830"],
  },
  emailDomain: "gmail.com",
  // Reached B on a number B supplied: contact, not ownership (B7).
  call: { to: "claimant_supplied", confirmed: true },
};

const outcomes = (claim: ReturnType<typeof scoreClaim>) =>
  Object.fromEntries(claim.signals.map((signal) => [signal.key, signal.outcome]));

describe("board 4c — both claims scored on the same rows", () => {
  it("scores A four exact matches and B none exact, two partial", () => {
    const a = scoreClaim(A, SOURCE, NOW);
    const b = scoreClaim(B, SOURCE, NOW);
    expect(outcomes(a)).toEqual({ trade_name: "match", address: "match", phone: "match", email_domain: "match" });
    expect(a.exactMatches).toBe(4);
    expect(outcomes(b)).toEqual({ trade_name: "partial", address: "partial", phone: "none", email_domain: "none" });
    expect(b.exactMatches).toBe(0);
  });

  it("computes holdsSourceLicence per claim — A minted the listing, B did not", () => {
    expect(scoreClaim(A, SOURCE, NOW).holdsSourceLicence).toBe(true);
    expect(scoreClaim(B, SOURCE, NOW).holdsSourceLicence).toBe(false);
    // The digits alone are the same licence.
    expect(scoreClaim({ ...A, licenceNumber: "771204" }, SOURCE, NOW).holdsSourceLicence).toBe(true);
  });

  it("tags A stronger and B partial, from the rows and never from a choice", () => {
    const assessment = assess([scoreClaim(A, SOURCE, NOW), scoreClaim(B, SOURCE, NOW)]);
    expect(assessment.strength.get("claim-a")).toBe("stronger");
    expect(assessment.strength.get("claim-b")).toBe("partial");
    expect(assessment.recommended).toBe("claim-a");
    expect(assessment.basis).toBe("source_licence");
  });

  it("scores free mail as no match, never as unknown (B6)", () => {
    const b = scoreClaim(B, SOURCE, NOW);
    expect(b.signals.find((signal) => signal.key === "email_domain")).toMatchObject({ outcome: "none", detail: "free_mail" });
  });

  it("says nothing is known, rather than a mismatch, when the register holds nothing for a licence", () => {
    const stranger = scoreClaim({ ...B, register: null, emailDomain: null }, SOURCE, NOW);
    expect(outcomes(stranger)).toEqual({ trade_name: "unknown", address: "unknown", phone: "unknown", email_domain: "unknown" });
  });

  it("treats a phone-route claim as having called the public record", () => {
    const phone = scoreClaim({ ...B, route: "phone_callback", calledNumber: "025531190", register: null }, SOURCE, NOW);
    expect(phone.signals.find((signal) => signal.key === "phone")).toMatchObject({ outcome: "match", detail: "public_record" });
  });
});

describe("criterion 5 — tags derive from the computed signals; a tie has no tag", () => {
  const neither = { ...SOURCE, licenceNumber: "ADDED-999999" };

  it("gives no claim a tag when they tie on exact matches and neither holds the source licence", () => {
    const left = scoreClaim({ ...A, call: null }, neither, NOW);
    const right = scoreClaim({ ...A, id: "claim-c", call: null }, neither, NOW);
    const assessment = assess([left, right]);
    expect(assessment.recommended).toBeNull();
    expect(assessment.strength.get("claim-a")).toBeNull();
    expect(assessment.strength.get("claim-c")).toBeNull();
  });

  it("breaks the tie with a call answered on the public-record number, and only that (Q1)", () => {
    const answered = scoreClaim({ ...A }, neither, NOW);
    const supplied = scoreClaim({ ...A, id: "claim-c", call: { to: "claimant_supplied", confirmed: true } }, neither, NOW);
    const assessment = assess([answered, supplied]);
    expect(assessment.recommended).toBe("claim-a");
    expect(assessment.basis).toBe("call");
  });

  it("lets the source licence outrank the count", () => {
    // B holds the source licence and matches nothing else; A matches everything else.
    const source = { ...SOURCE, licenceNumber: "ADDED-802116" };
    const assessment = assess([scoreClaim(A, source, NOW), scoreClaim(B, source, NOW)]);
    expect(assessment.recommended).toBe("claim-b");
    expect(assessment.strength.get("claim-a")).toBe("partial");
  });

  it("never recommends a lapsed licence: that card cannot be awarded", () => {
    const lapsed = scoreClaim({ ...A, licenceExpiry: new Date("2026-08-01T00:00:00.000Z") }, SOURCE, NOW);
    const assessment = assess([lapsed, scoreClaim(B, SOURCE, NOW)]);
    expect(lapsed.licenceLapsed).toBe(true);
    expect(assessment.recommended).not.toBe("claim-a");
  });

  it("holds for three claims, and nothing assumes two", () => {
    const third = scoreClaim({ ...B, id: "claim-c", register: null, emailDomain: null }, SOURCE, NOW);
    const assessment = assess([scoreClaim(A, SOURCE, NOW), scoreClaim(B, SOURCE, NOW), third]);
    expect(assessment.recommended).toBe("claim-a");
    expect(assessment.strength.get("claim-c")).toBe("none");
  });
});

describe("criterion 10 — age and overdue from the conflict's opening; overdue = age − SLA", () => {
  it("reads 3 d 6 h old and 1 d 6 h overdue for the drawn clock", () => {
    const clock = conflictClock({ openedAt: new Date("2026-08-19T12:02:00.000Z"), now: new Date("2026-08-22T18:02:00.000Z") });
    expect(formatDuration(clock.ageMs)).toBe("3 d 6 h");
    expect(formatDuration(clock.overdueMs)).toBe("1 d 6 h");
    expect(clock.ageMs - clock.overdueMs).toBe(CONFLICT_SLA_HOURS * 3_600_000);
    expect(clock.late).toBe(true);
  });

  it("is not late inside the window, and says how long is left", () => {
    const clock = conflictClock({ openedAt: new Date("2026-08-22T08:00:00.000Z"), now: new Date("2026-08-22T18:00:00.000Z") });
    expect(clock.late).toBe(false);
    expect(clock.overdueMs).toBe(0);
    expect(formatDuration(clock.remainingMs)).toBe("1 d 14 h");
  });

  it("pauses while escalated, and is never late on the queue then (Q5)", () => {
    const clock = conflictClock({
      openedAt: new Date("2026-08-19T12:02:00.000Z"),
      escalatedAt: new Date("2026-08-21T12:02:00.000Z"),
      now: new Date("2026-08-30T00:00:00.000Z"),
    });
    expect(clock.paused).toBe(true);
    expect(clock.late).toBe(false);
    expect(formatDuration(clock.ageMs)).toBe("2 d");
  });
});

describe("the small parsers", () => {
  it("reads domains from emails, URLs and bare hosts", () => {
    expect(emailDomain("Faisal@CoolBreeze.ae")).toBe("coolbreeze.ae");
    expect(emailDomain("not-an-email")).toBeNull();
    expect(domainOf("https://www.coolbreeze.ae/contact")).toBe("coolbreeze.ae");
    expect(domainOf("info@coolbreeze.ae")).toBe("coolbreeze.ae");
    expect(domainOf("")).toBeNull();
  });

  it("compares UAE numbers on the national number", () => {
    expect(samePhone("02 553 1190", "+971 2 553 1190")).toBe(true);
    expect(samePhone("00971 2 553 1190", "025531190")).toBe(true);
    expect(samePhone("02 553 1190", "02 554 8830")).toBe(false);
  });

  it("knows a branch licence from a sibling one (12b's hint)", () => {
    expect(looksLikeBranchOf("ADDED-771204-01", "ADDED-771204")).toBe(true);
    expect(looksLikeBranchOf("ADDED-802116", "ADDED-771204")).toBe(false);
  });
});
