import { describe, expect, it } from "vitest";
import {
  bucketOf,
  closesOf,
  countBuckets,
  dubaiYearStart,
  expiryNoteOf,
  historyOf,
  INBOX_BUCKETS,
  needsYou,
  verbOf,
  type InboxFacts,
} from "./inbox-status";

const NOW = new Date("2026-09-14T08:00:00Z");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function enquiry(over: Partial<InboxFacts> & { ref?: string } = {}): InboxFacts & { ref: string } {
  return {
    ref: "ENQ-0000",
    createdAt: new Date(NOW.getTime() - 2 * DAY),
    closesAt: new Date(NOW.getTime() + 5 * DAY),
    sentTo: 5,
    quoted: 0,
    anyQuoteRead: false,
    accepted: false,
    nudgeable: 0,
    unanswered: 5,
    allDeclined: false,
    resentAsRef: null,
    ...over,
  };
}

/** The five rows board 10e draws, with the two it counts offscreen. */
const BOARD = [
  enquiry({ ref: "ENQ-8841", sentTo: 5, quoted: 4, closesAt: new Date(NOW.getTime() + 3 * DAY), unanswered: 1 }),
  enquiry({ ref: "ENQ-8802", sentTo: 7, quoted: 7, accepted: true, closesAt: new Date(NOW.getTime() - DAY) }),
  enquiry({ ref: "ENQ-8790", sentTo: 4, quoted: 2, closesAt: new Date(NOW.getTime() + 6 * DAY), unanswered: 2 }),
  enquiry({ ref: "ENQ-8744", sentTo: 6, quoted: 0, closesAt: new Date(NOW.getTime() + 4 * HOUR), nudgeable: 6, unanswered: 6 }),
  enquiry({ ref: "ENQ-8611", sentTo: 3, quoted: 3, closesAt: new Date(NOW.getTime() - 2 * DAY), unanswered: 0 }),
  enquiry({ ref: "ENQ-8590", sentTo: 4, quoted: 0, createdAt: new Date(NOW.getTime() - 3 * HOUR), unanswered: 4 }),
  enquiry({ ref: "ENQ-8522", sentTo: 3, quoted: 3, accepted: true }),
];

describe("the verb is derived from sent, quoted and the clock (B2)", () => {
  it("reads the five rows board 10e draws", () => {
    expect(BOARD.slice(0, 5).map((row) => verbOf(row, NOW))).toEqual([
      { kind: "compare", quoted: 4 },
      { kind: "accepted" },
      { kind: "partial", quoted: 2, sentTo: 4 },
      { kind: "nudge", sellers: 6 },
      { kind: "resend" },
    ]);
  });

  it("waits for the rest while there is time, and compares once everything is in", () => {
    const early = enquiry({ sentTo: 4, quoted: 2, closesAt: new Date(NOW.getTime() + 6 * DAY) });
    expect(verbOf(early, NOW).kind).toBe("partial");
    expect(verbOf({ ...early, quoted: 4 }, NOW).kind).toBe("compare");
    expect(verbOf({ ...early, closesAt: new Date(NOW.getTime() + 2 * DAY) }, NOW).kind).toBe("compare");
  });

  it("never offers to compare one quote", () => {
    expect(verbOf(enquiry({ sentTo: 1, quoted: 1 }), NOW)).toEqual({ kind: "view" });
    expect(verbOf(enquiry({ sentTo: 3, quoted: 1, closesAt: new Date(NOW.getTime() + HOUR) }), NOW).kind).toBe("partial");
  });

  it("offers a nudge only while a seller may still be nudged", () => {
    expect(verbOf(enquiry({ quoted: 0, nudgeable: 0 }), NOW)).toEqual({ kind: "awaiting" });
    expect(verbOf(enquiry({ quoted: 0, allDeclined: true, unanswered: 0 }), NOW)).toEqual({ kind: "declined" });
  });

  it("restates an open enquiry to expired the moment it closes", () => {
    const row = enquiry({ quoted: 2, closesAt: NOW });
    expect(bucketOf(row, NOW)).toBe("expired");
    expect(verbOf(row, new Date(NOW.getTime() - 1)).kind).not.toBe("resend");
  });

  it("points an expired row that was re-sent at the new one (B3)", () => {
    expect(verbOf(enquiry({ closesAt: new Date(NOW.getTime() - DAY), resentAsRef: "ENQ-9002" }), NOW)).toEqual({
      kind: "resent",
      ref: "ENQ-9002",
    });
  });

  it("keeps an accepted enquiry accepted after its close", () => {
    expect(bucketOf(enquiry({ accepted: true, closesAt: new Date(NOW.getTime() - 9 * DAY) }), NOW)).toBe("accepted");
    expect(closesOf(enquiry({ accepted: true }), NOW)).toEqual({ kind: "closed" });
  });
});

describe("every row is in exactly one chip, and the chips sum to the total (B1)", () => {
  it("counts the board the corrected way — Quotes in 2, Expired 1", () => {
    expect(countBuckets(BOARD, NOW)).toEqual({ all: 7, awaiting: 2, quotes_in: 2, accepted: 2, expired: 1 });
  });

  it("maps each row to one bucket, per row rather than per total", () => {
    for (const row of BOARD) {
      const hits = INBOX_BUCKETS.filter((bucket) => bucketOf(row, NOW) === bucket);
      expect(hits, row.ref).toHaveLength(1);
    }
    const counts = countBuckets(BOARD, NOW);
    expect(INBOX_BUCKETS.reduce((sum, bucket) => sum + counts[bucket], 0)).toBe(counts.all);
  });

  it("never files an expired row under Quotes in", () => {
    const expired = BOARD.find((row) => row.ref === "ENQ-8611")!;
    expect(bucketOf(expired, NOW)).toBe("expired");
  });
});

describe("the closes column", () => {
  it("is red under a day and amber inside three", () => {
    expect(closesOf(enquiry({ closesAt: new Date(NOW.getTime() + 4 * HOUR) }), NOW)).toMatchObject({ tone: "bad" });
    expect(closesOf(enquiry({ closesAt: new Date(NOW.getTime() + 3 * DAY) }), NOW)).toMatchObject({ tone: "warn" });
    expect(closesOf(enquiry({ closesAt: new Date(NOW.getTime() + 6 * DAY) }), NOW)).toMatchObject({ tone: "neutral" });
  });

  it("says why an expired enquiry died", () => {
    expect(expiryNoteOf(enquiry({ quoted: 3, anyQuoteRead: false }))).toBe("not_actioned");
    expect(expiryNoteOf(enquiry({ quoted: 0 }))).toBe("no_quotes");
    expect(expiryNoteOf(enquiry({ quoted: 3, anyQuoteRead: true }))).toBe("lapsed");
  });
});

describe("NEEDS YOU picks from the table (B4)", () => {
  it("names the two rows board 10e names, in that order", () => {
    const cards = needsYou(BOARD, NOW);
    expect(cards.map((card) => [card.kind, card.row.ref])).toEqual([
      ["compare", "ENQ-8841"],
      ["nudge", "ENQ-8744"],
    ]);
    expect(cards[1]).toMatchObject({ sellers: 6 });
  });

  it("fills with compare actions by close time when nothing needs a nudge", () => {
    const rows = [
      enquiry({ ref: "A", quoted: 2, closesAt: new Date(NOW.getTime() + 5 * DAY) }),
      enquiry({ ref: "B", quoted: 3, closesAt: new Date(NOW.getTime() + DAY) }),
      enquiry({ ref: "C", quoted: 1, closesAt: new Date(NOW.getTime() + 2 * DAY) }),
    ];
    expect(needsYou(rows, NOW).map((card) => card.row.ref)).toEqual(["B", "C"]);
  });

  it("is empty when nothing needs attention, rather than an all-clear card", () => {
    expect(needsYou([enquiry({ accepted: true }), enquiry({ closesAt: new Date(NOW.getTime() - DAY) })], NOW)).toEqual([]);
  });
});

describe("the buyer's own history (B8)", () => {
  const since = dubaiYearStart(NOW);

  it("starts the year at midnight in Dubai", () => {
    expect(since.toISOString()).toBe("2025-12-31T20:00:00.000Z");
  });

  it("takes the median over answered enquiries only", () => {
    const history = historyOf(
      [
        { createdAt: new Date("2026-03-01T08:00:00Z"), firstQuoteAt: new Date("2026-03-01T09:00:00Z"), acceptedBusinessId: "b1" },
        { createdAt: new Date("2026-04-01T08:00:00Z"), firstQuoteAt: new Date("2026-04-01T11:00:00Z"), acceptedBusinessId: "b1" },
        { createdAt: new Date("2026-05-01T08:00:00Z"), firstQuoteAt: null, acceptedBusinessId: null },
        { createdAt: new Date("2026-06-01T08:00:00Z"), firstQuoteAt: new Date("2026-06-01T10:00:00Z"), acceptedBusinessId: "b2" },
        // Last year: not in the window.
        { createdAt: new Date("2025-11-01T08:00:00Z"), firstQuoteAt: new Date("2025-11-01T08:10:00Z"), acceptedBusinessId: "b2" },
      ],
      since,
    );
    expect(history).toEqual({ sent: 4, medianFirstQuoteMs: 2 * HOUR, answered: 3, accepted: 3, repeatSuppliers: 1 });
  });

  it("has no median rather than a zero when nothing was answered", () => {
    expect(historyOf([{ createdAt: NOW, firstQuoteAt: null, acceptedBusinessId: null }], since).medianFirstQuoteMs).toBeNull();
  });
});
