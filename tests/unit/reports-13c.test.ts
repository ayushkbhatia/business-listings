import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { reportSource, valueGroupKey } from "@/lib/reports/collapse";
import { AUTO_FLAG_AT, evidenceLine, isFlagged, licenceWords } from "@/lib/reports/evidence";
import {
  formatReference,
  isReference,
  newReference,
  parseReference,
  REFERENCE_PREFIX,
} from "@/lib/reports/reference";
import {
  CLAIM_DISPUTE_REASON,
  FIELDS_FOR_KIND,
  FIELDS_TAKING_CORRECTION,
  PUBLIC_REPORT_KINDS,
  PUBLIC_REPORT_REASONS,
  REPORT_SUBJECT_FIELDS,
  takesCorrection,
} from "@/lib/reports/taxonomy";
import { REPORT_SLA_HOURS } from "@/lib/reports/sla";
import { subjectValueKey, VALUED_FIELDS } from "@/lib/reports/value-key";
import { viewOf, type ReportEntry } from "@/lib/reports/view";
import { RATE_POLICIES } from "@/lib/rate-limit/policy";

/**
 * Board 13c — the pure half of *Report a listing*.
 *
 * The rules the export's two corrections turn on: what counts as the same value
 * (`B2`), what the licence clause says (`B3`), what a reference looks like
 * (`B4`), and what the threshold the modal's footer promises actually does.
 */

const DAY = 86_400_000;
const NOW = new Date("2026-09-17T08:00:00.000Z");

describe("B2 — the same value, however it was written", () => {
  it("reads one UAE landline three ways as one key", () => {
    const keys = ["+971 4 227 8890", "04-2278890", "00971 4 2278890", "(04) 227 8890"].map((phone) =>
      subjectValueKey("phone", phone),
    );
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toBe("42278890");
  });

  it("is the rule the shared-number detector groups on in SQL, and the migration backfills with", () => {
    // Two callers of one rule. If either moves, a buyer's report and the
    // sweep's finding about the same number sit in two groups.
    const detector = readFileSync("lib/reports/detectors.ts", "utf8");
    const rule = `regexp_replace(regexp_replace(l."phone", '[^0-9]', '', 'g'), '^(00)?(971)?0?', '')`;
    expect(detector).toContain(rule);
    const migration = readFileSync(
      "prisma/migrations/20261107090000_report_capture_13c/migration.sql",
      "utf8",
    );
    expect(migration).toContain(rule);
    // Mobiles are nine digits after the trunk zero, landlines eight.
    expect(subjectValueKey("phone", "050 123 4567")).toBe("501234567");
    expect(subjectValueKey("phone", "+971 50 123 4567")).toBe("501234567");
    // What the old *last nine digits* rule split in two.
    expect(subjectValueKey("phone", "+971 4 227 8890")).toBe(subjectValueKey("phone", "04 227 8890"));
  });

  it("refuses a number too short to be one", () => {
    expect(subjectValueKey("phone", "1234")).toBeNull();
  });

  it("reads a website as its host", () => {
    expect(subjectValueKey("website", "https://www.Example.ae/contact?x=1")).toBe("example.ae");
    expect(subjectValueKey("website", "example.ae")).toBe("example.ae");
    expect(subjectValueKey("website", "not a site")).toBeNull();
  });

  it("reads names and addresses without their punctuation", () => {
    expect(subjectValueKey("name", "Deira Bearing House L.L.C.")).toBe(
      subjectValueKey("name", "deira bearing house llc"),
    );
    expect(subjectValueKey("address", "Shop 4, Naif Road")).toBe(subjectValueKey("address", "shop 4 naif road"));
  });

  it("refuses a key everything would join", () => {
    // `LLC` on its own is three letters half the directory shares.
    expect(subjectValueKey("name", "L.L.C.")).toBeNull();
  });

  it("reads a licence number without its separators", () => {
    expect(subjectValueKey("licence", "CN-1234567")).toBe("CN1234567");
    expect(subjectValueKey("licence", "cn 1234567")).toBe("CN1234567");
  });

  it("has no value for a field that is not one", () => {
    for (const field of ["hours", "photo", "description", "category"] as const) {
      expect(subjectValueKey(field, "anything at all"), field).toBeNull();
      expect(VALUED_FIELDS as readonly string[]).not.toContain(field);
    }
    expect(subjectValueKey("phone", null)).toBeNull();
  });

  it("groups by kind, field and value, and only where there is a value", () => {
    expect(valueGroupKey({ kind: "wrong_details", subjectField: "phone", subjectValueKey: "042278890" })).toBe(
      "wrong_details|phone|042278890",
    );
    expect(valueGroupKey({ kind: "wrong_details", subjectField: "hours", subjectValueKey: null })).toBeNull();
    expect(valueGroupKey({ kind: "closed", subjectField: null, subjectValueKey: "X" })).toBeNull();
  });
});

describe("B8 — one source is one signal", () => {
  it("keys an account, a digest and a detector apart", () => {
    const account = reportSource({ id: "r1", reporterId: "u1", reporterKey: "k1" });
    const digest = reportSource({ id: "r2", reporterId: null, reporterKey: "k1" });
    const detector = reportSource({ id: "r3", reporterId: null, reporterKey: null });
    expect(new Set([account, digest, detector]).size).toBe(3);
    // The same browser twice is one source.
    expect(reportSource({ id: "r4", reporterId: null, reporterKey: "k1" })).toBe(digest);
  });

  it("counts one sweep's findings as one source, however many listings it filed on", () => {
    const findings = ["a", "b", "c"].map((id) =>
      reportSource({ id, reporterId: null, reporterKey: null, detector: "shared_phone" }),
    );
    expect(new Set(findings).size).toBe(1);
    expect(findings[0]).not.toBe(reportSource({ id: "d", reporterId: null, reporterKey: null }));
  });

  it("limits a listing as well as a source, and never makes a second witness wait", () => {
    expect(RATE_POLICIES.listing_report_subject.limit).toBeGreaterThan(AUTO_FLAG_AT);
    expect(RATE_POLICIES.listing_report_subject.cooldownMs).toBe(0);
    expect(RATE_POLICIES.listing_report.limit).toBeLessThan(RATE_POLICIES.listing_report_subject.limit);
  });
});

describe("B3 — what the licence record says", () => {
  const ago = (days: number) => new Date(NOW.getTime() - days * DAY);

  it("says how long ago a licence lapsed, in the unit a person uses", () => {
    expect(licenceWords(ago(425), NOW)).toBe("Licence expired 14 months ago");
    expect(licenceWords(ago(40), NOW)).toBe("Licence expired a month ago");
    expect(licenceWords(ago(9), NOW)).toBe("Licence expired 9 days ago");
    expect(licenceWords(ago(0), NOW)).toBe("Licence expired today");
  });

  it("says when a licence is about to lapse", () => {
    expect(licenceWords(ago(-1), NOW)).toBe("Licence expires tomorrow");
    expect(licenceWords(ago(-23), NOW)).toBe("Licence expires in 23 days");
  });

  it("says a date when there is nothing urgent", () => {
    expect(licenceWords(new Date("2027-03-12T00:00:00.000Z"), NOW)).toMatch(/^Licence valid to .*2027$/);
  });
});

describe("the evidence line", () => {
  const valid = new Date("2027-03-12T00:00:00.000Z");
  const lapsed = new Date(NOW.getTime() - 425 * DAY);

  it("always shows the check ran, even when there is nothing else to say", () => {
    expect(evidenceLine({ field: "hours", listings: 1, licenceExpiry: valid, now: NOW })).toMatch(
      /^Licence valid to /,
    );
  });

  it("leads with the spread and does not spend the line on a licence in good order", () => {
    expect(evidenceLine({ field: "phone", listings: 4, licenceExpiry: valid, now: NOW })).toBe(
      "Same number on 4 listings",
    );
  });

  it("keeps a lapsed licence beside the spread, because it is news", () => {
    expect(evidenceLine({ field: "licence", listings: 2, licenceExpiry: lapsed, now: NOW })).toBe(
      "Same licence number on 2 listings · Licence expired 14 months ago",
    );
  });

  it("never stores a count of people, which would be stale within the hour", () => {
    const line = evidenceLine({ field: "phone", listings: 1, licenceExpiry: valid, now: NOW }) ?? "";
    expect(line).not.toMatch(/separate reports/i);
  });

  it("is sentence case, because the screen upper-cases it", () => {
    const line = evidenceLine({ field: "phone", listings: 3, licenceExpiry: lapsed, now: NOW }) ?? "";
    expect(line).not.toBe(line.toUpperCase());
  });
});

describe("the three-report flag", () => {
  it("is three sources", () => {
    expect(AUTO_FLAG_AT).toBe(3);
    expect(isFlagged(2)).toBe(false);
    expect(isFlagged(3)).toBe(true);
  });

  const base: ReportEntry = {
    ref: "report:a",
    id: "a",
    type: "wrong_details",
    businessId: "b",
    businessName: "Deira Bearing House",
    businessSlug: "deira-bearing-house",
    businessSuspended: false,
    claim: null,
    evidence: null,
    detector: null,
    reporter: { kind: "public", name: null },
    reports: 1,
    duplicateIds: [],
    priorsOnField: 1,
    corroboration: { sources: 1, listings: 1 },
    flagged: false,
    filedAt: new Date("2026-09-10T08:00:00.000Z"),
    waitingMs: 0,
    slaMs: 1,
    sla: "ok",
    assignee: null,
    escalatedAt: null,
    reviewId: null,
    href: "/admin/reports/a",
  };

  it("moves a flagged row above older unflagged rows, and below a late one", () => {
    const view = viewOf(
      [
        { ...base, ref: "report:old", id: "old", filedAt: new Date("2026-09-01T00:00:00.000Z") },
        { ...base, ref: "report:flag", id: "flag", flagged: true, corroboration: { sources: 3, listings: 4 } },
        { ...base, ref: "report:late", id: "late", sla: "late", filedAt: new Date("2026-09-12T00:00:00.000Z") },
      ],
      {},
    );
    expect(view.rows.map((row) => row.id)).toEqual(["late", "flag", "old"]);
    expect(view.flagged).toBe(1);
  });

  it("filters to the flagged rows, and counts them off every row", () => {
    const view = viewOf(
      [
        { ...base, ref: "report:x", id: "x", flagged: true },
        { ...base, ref: "report:y", id: "y" },
      ],
      { flagged: true },
    );
    expect(view.rows.map((row) => row.id)).toEqual(["x"]);
    expect(view.flagged).toBe(1);
    expect(view.total).toBe(2);
  });
});

describe("B4 — the reference", () => {
  it("is forty bits in Crockford's alphabet, behind a prefix", () => {
    const reference = formatReference(new Uint8Array([0, 0, 0, 0, 0]));
    expect(reference).toBe(`${REFERENCE_PREFIX}00000000`);
    expect(formatReference(new Uint8Array([255, 255, 255, 255, 255]))).toBe(`${REFERENCE_PREFIX}ZZZZZZZZ`);
  });

  it("never uses I, L, O or U", () => {
    for (let index = 0; index < 200; index += 1) {
      const reference = newReference();
      expect(isReference(reference), reference).toBe(true);
      expect(reference.slice(REFERENCE_PREFIX.length)).not.toMatch(/[ILOU]/);
    }
  });

  it("refuses fewer than forty bits rather than padding", () => {
    expect(() => formatReference(new Uint8Array([1, 2, 3, 4]))).toThrow();
  });

  it("takes back what a person typed from an email", () => {
    expect(parseReference(" rp-4k2m9xqt ")).toBe("RP-4K2M9XQT");
    expect(parseReference("4K2M9XQT")).toBe("RP-4K2M9XQT");
    expect(parseReference("RP-4K2M 9XQT")).toBe("RP-4K2M9XQT");
    expect(parseReference("RP-4K2M9XQO")).toBeNull();
    expect(parseReference("hello")).toBeNull();
  });

  it("matches the database's floor, which uses md5 hex digits", () => {
    // `supplier_report_reference_shape` and the column default. Hex is a
    // subset of the alphabet, so a defaulted row is a valid reference.
    expect(isReference("RP-0A1B2C3D")).toBe(true);
    const migration = readFileSync(
      "prisma/migrations/20261107090000_report_capture_13c/migration.sql",
      "utf8",
    );
    expect(migration).toContain("^RP-[0-9ABCDEFGHJKMNPQRSTVWXYZ]{8}$");
  });
});

describe("the reasons the modal offers", () => {
  it("puts Permanently closed first, as the board draws it, and the claim door last", () => {
    expect(PUBLIC_REPORT_KINDS[0]).toBe("closed");
    expect(PUBLIC_REPORT_REASONS.at(-1)).toBe(CLAIM_DISPUTE_REASON);
    expect(PUBLIC_REPORT_KINDS as readonly string[]).not.toContain(CLAIM_DISPUTE_REASON);
  });

  it("files a closure against the licence record, where the expiry sweep files its finding", () => {
    expect(FIELDS_FOR_KIND.closed).toEqual(["licence"]);
    expect(readFileSync("lib/reports/detectors.ts", "utf8")).toContain(`subjectField: "licence"`);
    expect(REPORT_SUBJECT_FIELDS as readonly string[]).toContain("licence");
  });

  it("offers a correction only where one is a short value somebody could know", () => {
    expect(takesCorrection("phone")).toBe(true);
    expect(takesCorrection("photo")).toBe(false);
    expect(takesCorrection("licence")).toBe(false);
    for (const field of FIELDS_TAKING_CORRECTION) {
      expect(REPORT_SUBJECT_FIELDS as readonly string[]).toContain(field);
    }
  });

  it("B7 — skips no queue: every public kind runs on a routine clock", () => {
    for (const kind of PUBLIC_REPORT_KINDS) {
      expect(REPORT_SLA_HOURS[kind], kind).toBeGreaterThanOrEqual(REPORT_SLA_HOURS.off_platform_payment);
    }
  });
});
