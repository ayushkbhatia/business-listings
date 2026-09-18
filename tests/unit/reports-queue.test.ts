import { describe, expect, it } from "vitest";
import { collapseKey, collapses } from "@/lib/reports/collapse";
import {
  DEFAULT_DETECTOR_RULES,
  DETECTOR_BOUNDS,
  detectorProblem,
  parseDetectorRules,
} from "@/lib/reports/detector-rules";
import {
  FASTEST_REPORT_SLA_DAYS,
  REPORT_SLA_HOURS,
  SLOWEST_REPORT_SLA_DAYS,
  slaMsFor,
  slaStateOf,
  slaTone,
} from "@/lib/reports/sla";
import {
  FIELDS_FOR_KIND,
  isPublicReportKind,
  isReportType,
  PUBLIC_REPORT_KINDS,
  REPORT_TYPES,
  REVIEW_DISPUTE,
} from "@/lib/reports/taxonomy";
import { viewOf, type ReportEntry } from "@/lib/reports/view";

/**
 * Board 4h — the pure half of the queue.
 *
 * The three rules that would each be a defect in production: the taxonomy the
 * header and the chips are counted off (`B3`), the service level the age colour
 * is derived from (`B4`), and what collapses into one work item (`B6`).
 */

const HOUR = 3_600_000;

function entry(over: Partial<ReportEntry> = {}): ReportEntry {
  const filedAt = over.filedAt ?? new Date("2026-09-10T08:00:00.000Z");
  return {
    ref: over.ref ?? "report:one",
    id: over.id ?? "one",
    type: over.type ?? "wrong_details",
    businessId: over.businessId ?? "biz",
    businessName: over.businessName ?? "Al Marwan Industrial Supplies",
    businessSlug: over.businessSlug ?? "al-marwan",
    businessSuspended: over.businessSuspended ?? false,
    claim: over.claim ?? "The landline rings a different company.",
    evidence: over.evidence ?? null,
    detector: over.detector ?? null,
    reporter: over.reporter ?? { kind: "public", name: null },
    reports: over.reports ?? 1,
    duplicateIds: over.duplicateIds ?? [],
    priorsOnField: over.priorsOnField ?? 1,
    corroboration: over.corroboration ?? { sources: 1, listings: 1 },
    flagged: over.flagged ?? false,
    filedAt,
    waitingMs: over.waitingMs ?? 0,
    slaMs: over.slaMs ?? slaMsFor(over.type ?? "wrong_details"),
    sla: over.sla ?? "ok",
    assignee: over.assignee ?? null,
    escalatedAt: over.escalatedAt ?? null,
    reviewId: over.reviewId ?? null,
    href: over.href ?? "/admin/reports/one",
  };
}

describe("B3 — one taxonomy", () => {
  it("holds every report kind plus the review dispute, and nothing else", () => {
    // The header counts these, the chips filter on these, the TYPE column
    // prints these. The board's defect was three buckets over five types.
    expect(REPORT_TYPES).toContain(REVIEW_DISPUTE);
    expect(new Set(REPORT_TYPES).size).toBe(REPORT_TYPES.length);
    expect(isReportType("wrong_details")).toBe(true);
    expect(isReportType("not_a_type")).toBe(false);
  });

  it("counts every type off one array, so a chip cannot disagree with the header", () => {
    const view = viewOf(
      [
        entry({ ref: "report:a", id: "a", type: "wrong_details" }),
        entry({ ref: "report:b", id: "b", type: "closed" }),
        entry({ ref: "dispute:c", id: "c", type: REVIEW_DISPUTE }),
      ],
      {},
    );
    expect(view.total).toBe(3);
    expect(view.counts.wrong_details).toBe(1);
    expect(view.counts.closed).toBe(1);
    expect(view.counts.review_dispute).toBe(1);
    // Every type has an entry, so a chip is never `undefined`.
    for (const type of REPORT_TYPES) expect(view.counts[type]).toBeGreaterThanOrEqual(0);
    expect(REPORT_TYPES.reduce((sum, type) => sum + view.counts[type], 0)).toBe(view.total);
  });

  it("counts records separately from work items, because a collapse hides two people", () => {
    const view = viewOf([entry({ reports: 3, duplicateIds: ["b", "c"] })], {});
    expect(view.total).toBe(1);
    expect(view.records).toBe(3);
  });

  it("offers the public only the four kinds with no other producer", () => {
    expect([...PUBLIC_REPORT_KINDS].sort()).toEqual([
      "closed",
      "content",
      "wrong_details",
      "wrong_trade",
    ]);
    expect(isPublicReportKind("off_platform_payment")).toBe(false);
    expect(isPublicReportKind("accepted_quote")).toBe(false);
    // Every public kind offers at least one field, or the form could not submit.
    for (const kind of PUBLIC_REPORT_KINDS) {
      expect(FIELDS_FOR_KIND[kind].length, kind).toBeGreaterThan(0);
    }
  });
});

describe("B4 — the service level, and the colour derived from it", () => {
  it("states a clock for every type in the taxonomy", () => {
    for (const type of REPORT_TYPES) {
      expect(REPORT_SLA_HOURS[type], type).toBeGreaterThan(0);
    }
  });

  it("puts off-platform payment on the shortest clock and a review dispute on two days", () => {
    // The two that are promised elsewhere: 11c's rail says "about 2 working
    // days", and a buyer being asked to pay a stranger is measured in hours.
    expect(REPORT_SLA_HOURS.review_dispute).toBe(48);
    expect(REPORT_SLA_HOURS.off_platform_payment).toBe(24);
    expect(FASTEST_REPORT_SLA_DAYS).toBe(1);
    expect(SLOWEST_REPORT_SLA_DAYS).toBe(5);
  });

  it("does not render a six-hour fraud report red, which the board did", () => {
    /*
       The board draws `6 h` redder than `2 d 4 h`, and the spec's own flag says
       the clock behind that is *"nowhere written down"*. With one written down,
       the colour comes out differently and deliberately: six hours is a quarter
       of the off-platform window, and twenty-eight of a wrong-phone report's
       hundred and twenty. Urgency is in the service level — a day against five
       — and the colour says how much of it is left. `B4`: the age colour is
       derived from the SLA, never hand-set.
    */
    expect(slaStateOf(6 * HOUR, slaMsFor("off_platform_payment"))).toBe("ok");
    expect(slaStateOf(19 * HOUR, slaMsFor("off_platform_payment"))).toBe("due");
    expect(slaStateOf(30 * HOUR, slaMsFor("off_platform_payment"))).toBe("late");
    // The same twenty-eight hours reads healthy against a five-day window.
    expect(slaStateOf(28 * HOUR, slaMsFor("wrong_details"))).toBe("ok");
  });

  it("marks the last quarter of the window as due, not only what is already late", () => {
    const sla = slaMsFor("wrong_details");
    expect(slaStateOf(0, sla)).toBe("ok");
    expect(slaStateOf(sla * 0.74, sla)).toBe("ok");
    expect(slaStateOf(sla * 0.75, sla)).toBe("due");
    expect(slaStateOf(sla, sla)).toBe("late");
  });

  it("gives each state a tone, and the tone is never the only carrier", () => {
    expect(slaTone("late")).toBe("bad");
    expect(slaTone("due")).toBe("warn");
    expect(slaTone("ok")).toBe("neutral");
  });

  it("puts what is late first and then the oldest, whatever the filter", () => {
    const old = entry({ ref: "report:old", id: "old", filedAt: new Date("2026-09-01T00:00:00Z") });
    const late = entry({
      ref: "report:late",
      id: "late",
      sla: "late",
      filedAt: new Date("2026-09-12T00:00:00Z"),
    });
    const newer = entry({ ref: "report:new", id: "new", filedAt: new Date("2026-09-14T00:00:00Z") });
    const view = viewOf([newer, old, late], {});
    expect(view.rows.map((row) => row.ref)).toEqual(["report:late", "report:old", "report:new"]);
    expect(view.overSla).toBe(1);
  });
});

describe("B6 — what is one work item", () => {
  it("groups three reports of one field on one business", () => {
    const key = collapseKey("biz", { id: "a", kind: "wrong_details", subjectField: "phone" });
    expect(key).toBe("biz|wrong_details|phone");
    expect(collapseKey("biz", { id: "b", kind: "wrong_details", subjectField: "phone" })).toBe(key);
  });

  it("never groups a kind that is about one record, pointer or no pointer", () => {
    /*
       The pointer is nullable — `SetNull` when the enquiry goes — so a rule
       that read only the pointer would quietly start grouping the one shape it
       exists to keep apart.
    */
    expect(collapses({ id: "a", kind: "accepted_quote", subjectField: "accepted_quote" })).toBe(
      false,
    );
    expect(collapses({ id: "b", kind: "review_integrity", subjectField: "review" })).toBe(false);
  });

  it("never groups a report about one enquiry or one review", () => {
    /*
       Two buyers reporting one supplier after two different accepted quotes are
       two complaints about two trades. Grouping them would close one buyer's
       case on the evidence of another's.
    */
    expect(
      collapses({
        id: "a",
        kind: "accepted_quote",
        subjectField: "accepted_quote",
        enquiryId: "enq_1",
      }),
    ).toBe(false);
    expect(
      collapses({ id: "b", kind: "review_integrity", subjectField: "review", reviewId: "rev_1" }),
    ).toBe(false);
  });

  it("never groups a report with no field to group on", () => {
    expect(collapses({ id: "c", kind: "content", subjectField: null })).toBe(false);
  });

  it("counts the auto-detected share off the same array as everything else", () => {
    const view = viewOf(
      [
        entry({ ref: "report:a", id: "a", detector: "shared_phone" }),
        entry({ ref: "report:b", id: "b", detector: "licence_long_expired" }),
        entry({ ref: "report:c", id: "c" }),
        entry({ ref: "report:d", id: "d" }),
      ],
      {},
    );
    expect(view.autoDetected).toBe(2);
    expect(view.autoDetected / view.total).toBe(0.5);
  });
});

describe("B11 — the detector thresholds", () => {
  it("refuses a value outside its bounds rather than clamping it quietly", () => {
    expect(detectorProblem(DEFAULT_DETECTOR_RULES)).toBeNull();
    expect(
      detectorProblem({ ...DEFAULT_DETECTOR_RULES, sharedPhoneListings: 1 })?.field,
    ).toBe("sharedPhoneListings");
    expect(
      detectorProblem({ ...DEFAULT_DETECTOR_RULES, licenceExpiredDays: 20 })?.field,
    ).toBe("licenceExpiredDays");
    expect(
      detectorProblem({ ...DEFAULT_DETECTOR_RULES, sharedPhoneListings: 2.5 })?.field,
    ).toBe("sharedPhoneListings");
  });

  it("starts at two listings, because one firm's own branches are not a report", () => {
    expect(DETECTOR_BOUNDS.sharedPhoneListings.min).toBe(2);
  });

  it("reads a stored value back, filling what a previous version did not write", () => {
    const parsed = parseDetectorRules({ sharedPhoneListings: 5 });
    expect(parsed.sharedPhoneListings).toBe(5);
    expect(parsed.licenceExpiredDays).toBe(DEFAULT_DETECTOR_RULES.licenceExpiredDays);
    expect(parsed.sweeps.shared_phone).toBe(true);
  });

  it("falls back whole rather than sweeping on a value the screen cannot have written", () => {
    // Zero would report every listing in the directory on the first night.
    expect(parseDetectorRules({ sharedPhoneListings: 0 })).toEqual(DEFAULT_DETECTOR_RULES);
    expect(parseDetectorRules(null)).toEqual(DEFAULT_DETECTOR_RULES);
  });
});

describe("the filters", () => {
  it("narrows to one type without changing what the chips count", () => {
    const rows = [
      entry({ ref: "report:a", id: "a", type: "closed" }),
      entry({ ref: "report:b", id: "b", type: "wrong_details" }),
    ];
    const view = viewOf(rows, { type: "closed" });
    expect(view.rows).toHaveLength(1);
    expect(view.total).toBe(2);
    expect(view.counts.wrong_details).toBe(1);
  });

  it("narrows to one owner, and to what is escalated", () => {
    const mine = entry({ ref: "report:a", id: "a", assignee: { id: "me", name: "R Haddad" } });
    const escalated = entry({ ref: "report:b", id: "b", escalatedAt: new Date("2026-09-12") });
    const view = viewOf([mine, escalated], { assigneeId: "me" });
    expect(view.rows.map((row) => row.ref)).toEqual(["report:a"]);
    expect(viewOf([mine, escalated], { escalated: true }).rows.map((row) => row.ref)).toEqual([
      "report:b",
    ]);
  });
});
