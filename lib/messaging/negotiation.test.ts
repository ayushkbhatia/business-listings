import { describe, expect, it } from "vitest";
import {
  acceptOffer,
  canWrite,
  compareRevision,
  dubaiDayKey,
  lastActivity,
  openingClause,
  railPreview,
  revisionPairs,
  threadState,
  timeline,
  type NegotiationLine,
  type NegotiationMessage,
  type NegotiationQuote,
  type RailFacts,
  type RequirementLine,
} from "./negotiation";

/*
   The board's own fixture, corrected at export. Every figure the handoff checked
   by hand is checked here by the code that renders it.
*/
const REQUIREMENT: RequirementLine[] = [
  { id: "valve", description: "Grooved butterfly valve DN100", qty: 40, sortOrder: 0 },
  { id: "coupling", description: "Rigid coupling", qty: 120, sortOrder: 1 },
  { id: "gasket", description: "Grooved gasket", qty: 120, sortOrder: 2 },
];

const line = (id: string, enquiryLineId: string | null, description: string, qty: number | null, unitPrice: string, sortOrder: number): NegotiationLine => ({
  id,
  enquiryLineId,
  description,
  qty,
  unitPrice,
  sortOrder,
});

const quote = (overrides: Partial<NegotiationQuote> & Pick<NegotiationQuote, "id" | "revision" | "lines">): NegotiationQuote => ({
  ref: `QT-8841-ALWR${overrides.revision}`,
  status: "sent",
  sentAt: new Date("2026-08-19T12:02:00Z"),
  expiresAt: new Date("2026-09-02T12:02:00Z"),
  validityDays: 14,
  note: null,
  proposal: null,
  ...overrides,
});

const R1 = quote({
  id: "r1",
  revision: 1,
  lines: [
    line("a1", "valve", "Butterfly valve DN100", 40, "198.00", 0),
    line("a2", "coupling", "Rigid coupling", 120, "46.00", 1),
    line("a3", "gasket", "Grooved gasket", 120, "12.00", 2),
  ],
});

const R2 = quote({
  id: "r2",
  revision: 2,
  sentAt: new Date("2026-08-21T05:14:00Z"),
  lines: [
    line("b1", "valve", "Butterfly valve DN100", 40, "191.00", 0),
    line("b2", "coupling", "Rigid coupling", 120, "46.00", 1),
    line("b3", "gasket", "Grooved gasket", 120, "12.00", 2),
  ],
});

describe("compareRevision", () => {
  it("sums r2 to 14,600.00 and r1 to 14,880.00 — not the 15,344 two boards shipped", () => {
    const r2 = compareRevision(R2, R1, REQUIREMENT);
    expect(r2.totalFils).toBe(1_460_000n);
    expect(r2.previousTotalFils).toBe(1_488_000n);
    // −AED 280: forty valves at seven dirhams.
    expect(r2.deltaFils).toBe(-28_000n);
  });

  it("maps every visible row to the total, per row (B3)", () => {
    const r2 = compareRevision(R2, R1, REQUIREMENT);
    expect(r2.lines).toHaveLength(3);
    expect(r2.lines.reduce((sum, row) => sum + row.lineFils, 0n)).toBe(r2.totalFils);
    expect(r2.lines.map((row) => row.lineFils)).toEqual([764_000n, 552_000n, 144_000n]);
  });

  it("strikes through only the figure that moved, by comparison rather than a stored diff (B2)", () => {
    const r2 = compareRevision(R2, R1, REQUIREMENT);
    expect(r2.lines.map((row) => [row.change, row.previousUnitFils])).toEqual([
      ["changed", 19_800n],
      ["same", null],
      ["same", null],
    ]);
  });

  it("names a requirement line the revision leaves unpriced, and keeps it out of the total", () => {
    const partial = quote({
      id: "ev",
      revision: 1,
      lines: [
        line("c1", "valve", "Butterfly valve DN100", 40, "189.00", 0),
        line("c2", "coupling", "Rigid coupling", 120, "47.50", 1),
      ],
    });
    const compared = compareRevision(partial, null, REQUIREMENT);
    expect(compared.notQuoted.map((row) => row.id)).toEqual(["gasket"]);
    expect(compared.totalFils).toBe(40n * 18_900n + 120n * 4_750n);
  });

  it("does not call a line unpriced when the revision links nothing to the requirement", () => {
    const unlinked = quote({ id: "u", revision: 1, lines: [line("d1", null, "Valve", 40, "190.00", 0)] });
    expect(compareRevision(unlinked, null, REQUIREMENT).notQuoted).toEqual([]);
  });

  it("marks a line added in a revision as new and one removed as dropped", () => {
    const r3 = quote({
      id: "r3",
      revision: 3,
      lines: [
        line("e1", "valve", "Butterfly valve DN100", 40, "191.00", 0),
        line("e2", null, "Delivery to site", null, "250.00", 1),
      ],
    });
    const compared = compareRevision(r3, R2, REQUIREMENT);
    expect(compared.lines.map((row) => row.change)).toEqual(["same", "new"]);
    expect(compared.dropped.map((row) => row.description)).toEqual(["Rigid coupling", "Grooved gasket"]);
    expect(compared.notQuoted.map((row) => row.id)).toEqual(["coupling", "gasket"]);
    // A line priced as a whole counts once.
    expect(compared.totalFils).toBe(764_000n + 25_000n);
  });

  it("shows a quantity that moved", () => {
    const moreValves = quote({ id: "r3q", revision: 3, lines: [line("f1", "valve", "Butterfly valve DN100", 48, "191.00", 0)] });
    const [row] = compareRevision(moreValves, R2, REQUIREMENT).lines;
    expect(row).toMatchObject({ change: "changed", previousQty: 40, previousUnitFils: null });
  });
});

describe("revisionPairs", () => {
  it("pairs each revision with the one it replaced", () => {
    expect(revisionPairs([R2, R1]).map((pair) => [pair.quote.id, pair.previous?.id ?? null])).toEqual([
      ["r1", null],
      ["r2", "r1"],
    ]);
  });

  it("does not compare a proposal on one basis with one on another", () => {
    const fixed = quote({ id: "p1", revision: 1, lines: [], proposal: { feeAed: "210000.00", feeBasis: "fixed_fee", feeBasisLabel: "Fixed fee" } });
    const monthly = quote({ id: "p2", revision: 2, lines: [], proposal: { feeAed: "18400.00", feeBasis: "per_month", feeBasisLabel: "Per month" } });
    expect(revisionPairs([fixed, monthly])[1]!.previous).toBeNull();
  });
});

describe("openingClause (B4)", () => {
  it("is the message's own first clause, never a paraphrase", () => {
    expect(openingClause("One drop makes it easier — 198 down to 191 on the valve, everything else the same. That is our floor on UL/FM stock.")).toBe(
      "One drop makes it easier…",
    );
  });

  it("leaves a whole short message whole, without an ellipsis", () => {
    expect(openingClause("Quote attached, valid 14 days.")).toBe("Quote attached, valid 14 days");
    expect(openingClause("Can you match it?")).toBe("Can you match it?");
  });

  it("stops at a sentence, a colon or a line break", () => {
    expect(openingClause("Gasket line is not something we stock. The rest stands.")).toBe("Gasket line is not something we stock…");
    expect(openingClause("Two things:\nfirst the valves")).toBe("Two things…");
  });

  it("cuts a long clause on a word boundary", () => {
    const text = openingClause("Northern Gulf are at 190 on the valve and have offered a two drop delivery at no charge");
    expect(text.endsWith("…")).toBe(true);
    expect(text.length).toBeLessThanOrEqual(49);
    expect(text).not.toMatch(/\s…$/);
  });

  it("is empty for an empty body", () => {
    expect(openingClause("   ")).toBe("");
  });
});

describe("the rail", () => {
  const base: RailFacts = {
    businessId: "aw",
    releasedTo: null,
    declinedAt: null,
    latestQuote: null,
    lastMessage: null,
    sellerHasWritten: false,
    requirement: REQUIREMENT,
  };

  it("keeps silence as a state (B9)", () => {
    expect(threadState(base)).toBe("no_reply");
    expect(railPreview(base)).toEqual({ kind: "none" });
    expect(lastActivity(base)).toBeNull();
  });

  it("reads the four things that happen to a fan-out", () => {
    expect(threadState({ ...base, latestQuote: R2, sellerHasWritten: true })).toBe("revised");
    expect(threadState({ ...base, latestQuote: R1, sellerHasWritten: true })).toBe("quoted");
    expect(
      threadState({ ...base, latestQuote: { ...R1, lines: R1.lines.slice(0, 2) }, sellerHasWritten: true }),
    ).toBe("partial");
    expect(threadState({ ...base, sellerHasWritten: true })).toBe("replied");
  });

  it("says who was chosen once somebody is", () => {
    expect(threadState({ ...base, releasedTo: "aw", latestQuote: R2 })).toBe("accepted");
    expect(threadState({ ...base, releasedTo: "ng", latestQuote: R2 })).toBe("not_chosen");
    expect(threadState({ ...base, declinedAt: new Date() })).toBe("declined");
  });

  it("previews the last message, or the revision when it is later", () => {
    const message = { body: "One drop makes it easier — 198 down to 191.", fromSeller: true, createdAt: new Date("2026-08-21T05:14:00Z"), attachments: 0 };
    expect(railPreview({ latestQuote: R1, lastMessage: message })).toEqual({ kind: "message", text: "One drop makes it easier…", fromMe: false });
    expect(railPreview({ latestQuote: { ...R2, sentAt: new Date("2026-08-21T06:00:00Z") }, lastMessage: message })).toEqual({
      kind: "quote",
      revision: 2,
      totalFils: 1_460_000n,
      proposal: null,
    });
    expect(railPreview({ latestQuote: null, lastMessage: { ...message, body: "", attachments: 2, fromSeller: false } })).toEqual({
      kind: "files",
      count: 2,
      fromMe: true,
    });
  });
});

describe("acceptOffer (B6)", () => {
  const now = new Date("2026-08-21T05:26:00Z");
  const input = {
    businessId: "aw",
    releasedTo: null,
    closesAt: new Date("2026-08-24T00:00:00Z"),
    supplierClosed: false,
    declined: false,
    latest: R2,
    recipientCount: 4,
    now,
  };

  it("offers the latest revision and counts the three it declines", () => {
    expect(acceptOffer(input)).toEqual({ kind: "offer", quote: R2, otherRecipients: 3 });
  });

  it("refuses for the reasons the service does", () => {
    expect(acceptOffer({ ...input, latest: null })).toEqual({ kind: "none" });
    expect(acceptOffer({ ...input, releasedTo: "aw" })).toMatchObject({ kind: "accepted_here" });
    expect(acceptOffer({ ...input, releasedTo: "ng" })).toEqual({ kind: "accepted_elsewhere" });
    expect(acceptOffer({ ...input, closesAt: now })).toMatchObject({ kind: "enquiry_closed" });
    expect(acceptOffer({ ...input, supplierClosed: true })).toEqual({ kind: "supplier_closed" });
    expect(acceptOffer({ ...input, latest: { ...R2, expiresAt: new Date(now.getTime() - 1) } })).toMatchObject({ kind: "expired" });
    expect(acceptOffer({ ...input, latest: { ...R2, status: "expired" } })).toMatchObject({ kind: "expired" });
    expect(acceptOffer({ ...input, latest: null, declined: true })).toEqual({ kind: "declined" });
  });

  it("writes where postMessage lets it: open, or closed for the accepted pair only", () => {
    const closed = { businessId: "aw", releasedTo: null, closesAt: new Date(now.getTime() - 1), supplierClosed: false, now };
    expect(canWrite({ ...closed, closesAt: input.closesAt })).toBe(true);
    expect(canWrite(closed)).toBe(false);
    expect(canWrite({ ...closed, releasedTo: "aw" })).toBe(true);
    expect(canWrite({ ...closed, closesAt: input.closesAt, supplierClosed: true })).toBe(false);
    // Accepted elsewhere: read-only while the window is still open.
    expect(canWrite({ ...closed, closesAt: input.closesAt, releasedTo: "ng" })).toBe(false);
  });
});

describe("timeline", () => {
  const message = (id: string, at: string, fromSeller: boolean, quoteRevisionId: string | null = null): NegotiationMessage => ({
    id,
    body: id,
    fromSeller,
    senderId: fromSeller ? "seat" : "buyer",
    createdAt: new Date(at),
    readAt: null,
    flagged: false,
    automatic: false,
    quoteRevisionId,
    attachments: [],
  });

  it("puts a revision sent without a message at the moment it was sent", () => {
    const entries = timeline(
      [message("ask", "2026-08-19T13:41:00Z", false), message("floor", "2026-08-21T05:14:00Z", true, "r2")],
      [R1, R2],
    );
    expect(entries.map((entry) => [entry.key, entry.quote?.id ?? null])).toEqual([
      ["q:r1", "r1"],
      ["m:ask", null],
      ["m:floor", "r2"],
    ]);
  });

  it("shows a revision once, on the first message that carries it", () => {
    const entries = timeline(
      [message("one", "2026-08-21T05:14:00Z", true, "r2"), message("two", "2026-08-21T05:15:00Z", true, "r2")],
      [R2],
    );
    expect(entries.map((entry) => entry.quote?.id ?? null)).toEqual(["r2", null]);
  });

  it("changes day on the Dubai calendar, not UTC", () => {
    // 21:30 UTC on the 20th is 01:30 on the 21st in Dubai.
    expect(dubaiDayKey(new Date("2026-08-20T21:30:00Z"))).toBe("2026-08-21");
  });
});
