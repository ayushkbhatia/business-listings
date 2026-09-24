import { describe, expect, it } from "vitest";
import {
  buildComparison,
  leadTone,
  readSort,
  winnersOf,
  type ComparedRecipient,
  type ComparedSupplier,
  type ComparisonInput,
  type QuotedLine,
  type QuotedRow,
  type RequestedLine,
} from "./comparison";
import { filsToAed } from "./money";

/**
 * Board `1n` as drawn and corrected at export: one RFQ, three lines, five
 * suppliers, four quotes. Every number the board states is asserted here, and
 * the one it got wrong — the cheapest-per-line card — is asserted at the value
 * the winners actually produce.
 */

const NOW = new Date("2026-09-24T08:00:00Z");
const SENT = new Date("2026-09-22T06:00:00Z");
const minutes = (n: number) => new Date(SENT.getTime() + n * 60_000);

const LINES: RequestedLine[] = [
  { id: "valve", description: "Resilient seated gate valve, flanged", qty: 40, unit: "pcs", size: "DN100" },
  { id: "coupling", description: "Rigid grooved coupling", qty: 120, unit: "pcs", size: "DN100" },
  { id: "gasket", description: "EPDM gasket", qty: 120, unit: "pcs", size: "DN100" },
];

function supplier(id: string, displayName: string, over: Partial<ComparedSupplier> = {}): ComparedSupplier {
  return { businessId: id, slug: id, displayName, verificationTier: 2, verifiedAt: null, rating: null, closed: false, ...over };
}

const priced = (enquiryLineId: string | null, qty: number | null, unitPrice: string, leadTimeDays: number | null = 0): QuotedLine => ({
  enquiryLineId,
  qty,
  unitPrice,
  leadTimeDays,
});

function quoted(
  who: ComparedSupplier,
  lines: QuotedLine[],
  firstQuoteMinutes: number,
  over: Partial<NonNullable<ComparedRecipient["quote"]>> = {},
): ComparedRecipient {
  return {
    supplier: who,
    state: "quoted",
    deliveredAt: SENT,
    openedAt: minutes(10),
    buyerNudgedAt: null,
    repliedAt: minutes(firstQuoteMinutes),
    declinedAt: null,
    declineReason: null,
    quote: {
      id: `q-${who.businessId}`,
      ref: `QT-8841-${who.businessId.toUpperCase()}`,
      revision: 1,
      status: "sent",
      sentAt: minutes(firstQuoteMinutes),
      firstSentAt: minutes(firstQuoteMinutes),
      expiresAt: new Date("2026-10-06T06:00:00Z"),
      againstRevision: 1,
      paymentTerms: "net_30",
      delivery: "included",
      lines,
      ...over,
    },
  };
}

const AL_WAHA = supplier("alwaha", "Al Waha Industrial Supplies", { rating: { average: 4.8, count: 31 } });
const EMIRATES = supplier("emirates", "Emirates Valve & Fitting Co.", { rating: { average: 4.6, count: 12 } });
const NORTHERN = supplier("northern", "Northern Gulf Trading", { rating: { average: 4.4, count: 9 } });
const TECHNOPUMP = supplier("technopump", "Technopump Trading LLC", { rating: { average: 4.4, count: 14 } });
const GULF_COOL = supplier("gulfcool", "Gulf Cool Technical Services");

const BOARD: ComparisonInput = {
  lines: LINES,
  revision: 1,
  closesAt: new Date("2026-09-27T06:00:00Z"),
  neededBy: new Date("2026-10-15T00:00:00Z"),
  acceptedBusinessId: null,
  acceptedAt: null,
  recipients: [
    quoted(AL_WAHA, [priced("valve", 40, "198.00"), priced("coupling", 120, "46.00"), priced("gasket", 120, "12.00")], 100),
    quoted(EMIRATES, [priced("valve", 40, "183.00"), priced("coupling", 120, "50.00")], 175),
    quoted(NORTHERN, [priced("valve", 40, "268.00", 12), priced("coupling", 120, "41.00", 12), priced("gasket", 120, "11.00", 12)], 370),
    quoted(TECHNOPUMP, [priced("valve", 40, "236.00", 10), priced("coupling", 120, "48.00", 10), priced("gasket", 120, "13.00", 10)], 560),
    {
      supplier: GULF_COOL,
      state: "opened",
      deliveredAt: SENT,
      openedAt: minutes(60),
      buyerNudgedAt: null,
      repliedAt: null,
      declinedAt: null,
      declineReason: null,
      quote: null,
    },
  ],
};

const aed = (fils: bigint) => filsToAed(fils);
const quotedRows = (model: ReturnType<typeof buildComparison>) => model.rows.filter((row): row is QuotedRow => row.kind === "quoted");
const row = (model: ReturnType<typeof buildComparison>, id: string) => quotedRows(model).find((r) => r.supplier.businessId === id)!;

describe("board 1n as drawn", () => {
  const model = buildComparison(BOARD, NOW);

  it("counts what the header states: three lines, five sent, four quoted", () => {
    expect(model.lines).toHaveLength(3);
    expect(model.sentTo).toBe(5);
    expect(model.quoted).toBe(4);
    expect(model.acceptable).toBe(4);
    expect(model.phase).toBe("open");
  });

  it("totals every row as the sum of its cells", () => {
    expect(aed(row(model, "alwaha").totalFils)).toBe("14880.00");
    expect(aed(row(model, "emirates").totalFils)).toBe("13320.00");
    expect(aed(row(model, "northern").totalFils)).toBe("16960.00");
    expect(aed(row(model, "technopump").totalFils)).toBe("16760.00");
    for (const r of quotedRows(model)) {
      const cells = r.cells.reduce((sum, cell) => (cell.kind === "priced" ? sum + cell.totalFils : sum), 0n);
      expect(cells).toBe(r.totalFils);
    }
  });

  it("prices each cell as the line total, and keeps the unit price beside it", () => {
    const valve = row(model, "alwaha").cells[0]!;
    expect(valve.kind).toBe("priced");
    if (valve.kind !== "priced") return;
    expect(aed(valve.totalFils)).toBe("7920.00");
    expect(aed(valve.unitFils!)).toBe("198.00");
    expect(valve.qty).toBe(40);
    expect(valve.comparable).toBe(true);
  });

  it("flags the only incomplete quote as 2 of 3 lines", () => {
    const emirates = row(model, "emirates");
    expect([emirates.quotedLines, emirates.totalLines]).toEqual([2, 3]);
    expect(emirates.complete).toBe(false);
    expect(emirates.cells[2]).toEqual({ kind: "not_quoted", lineId: "gasket" });
    for (const id of ["alwaha", "northern", "technopump"]) expect(row(model, id).complete).toBe(true);
  });

  it("marks every line's winner, the gasket column included (B2)", () => {
    expect(Object.fromEntries(winnersOf(model))).toEqual({ valve: "emirates", coupling: "northern", gasket: "northern" });
  });

  it("computes the cheapest-per-line card from the winners: AED 13,560 across two suppliers (B1, B3)", () => {
    const split = model.cheapest!;
    expect(split).not.toBeNull();
    expect(aed(split.totalFils)).toBe("13560.00");
    expect(split.suppliers.map((s) => s.displayName)).toEqual(["Emirates Valve & Fitting Co.", "Northern Gulf Trading"]);
    expect(split.deliveries).toBe(2);
  });

  it("states the saving against the best complete single quote: AED 1,320 under Al Waha's 14,880", () => {
    const against = model.cheapest!.against!;
    expect(against.supplier.businessId).toBe("alwaha");
    expect(aed(against.totalFils)).toBe("14880.00");
    expect(aed(against.savingFils)).toBe("1320.00");
  });

  it("does not reproduce the hand-assembled figure the board drew", () => {
    // 7,320 + 4,920 + Al Waha's 1,440 = 13,680 across three suppliers. The
    // gasket's winner is Northern Gulf at 1,320, which that card overpaid by 120.
    expect(aed(model.cheapest!.totalFils)).not.toBe("13680.00");
    expect(model.cheapest!.suppliers.map((s) => s.businessId)).not.toContain("alwaha");
  });

  it("measures quoted-in from delivery to the first quote", () => {
    expect(row(model, "alwaha").quotedInMs).toBe(100 * 60_000);
    expect(row(model, "technopump").quotedInMs).toBe(560 * 60_000);
  });

  it("reads the quote's lead time as its slowest line", () => {
    expect(row(model, "alwaha").leadTimeDays).toBe(0);
    expect(row(model, "northern").leadTimeDays).toBe(12);
  });

  it("keeps the supplier who opened it and has not quoted as a waiting row, after the quotes", () => {
    const last = model.rows.at(-1)!;
    expect(last.kind).toBe("waiting");
    if (last.kind !== "waiting") return;
    expect(last.supplier.businessId).toBe("gulfcool");
    expect(last.state).toBe("opened");
  });

  it("orders rows by arrival by default — never by price", () => {
    expect(quotedRows(model).map((r) => r.supplier.businessId)).toEqual(["alwaha", "emirates", "northern", "technopump"]);
  });
});

describe("sorting (flag 3, B5)", () => {
  it("sorts by total with every complete quote before the incomplete one", () => {
    const model = buildComparison(BOARD, NOW, "total");
    expect(quotedRows(model).map((r) => r.supplier.businessId)).toEqual(["alwaha", "technopump", "northern", "emirates"]);
  });

  it("sorts by lead time, stated before unstated, arrival breaking ties", () => {
    const model = buildComparison(BOARD, NOW, "lead");
    expect(quotedRows(model).map((r) => r.supplier.businessId)).toEqual(["alwaha", "emirates", "technopump", "northern"]);
  });

  it("moves nothing but the rows: winners and the card are the same under every sort", () => {
    const base = buildComparison(BOARD, NOW);
    for (const sort of ["total", "lead"] as const) {
      const sorted = buildComparison(BOARD, NOW, sort);
      expect(winnersOf(sorted)).toEqual(winnersOf(base));
      expect(sorted.cheapest?.totalFils).toBe(base.cheapest?.totalFils);
    }
  });

  it("reads an unknown sort as arrival", () => {
    expect(readSort("price")).toBe("received");
    expect(readSort(undefined)).toBe("received");
    expect(readSort("lead")).toBe("lead");
  });
});

describe("what may win a column", () => {
  it("does not let a quantity other than the one asked win, however low its total", () => {
    const input: ComparisonInput = {
      ...BOARD,
      recipients: [
        ...BOARD.recipients,
        quoted(supplier("short", "Short Supply"), [priced("valve", 30, "150.00")], 600),
      ],
    };
    const model = buildComparison(input, NOW);
    const short = row(model, "short").cells[0]!;
    expect(short.kind === "priced" && short.comparable).toBe(false);
    expect(winnersOf(model).get("valve")).toBe("emirates");
  });

  it("breaks a price tie on the shorter lead time, then on the earlier quote", () => {
    const tie = (id: string, lead: number | null, at: number) =>
      quoted(supplier(id, id), [priced("valve", 40, "180.00", lead), priced("coupling", 120, "40.00", lead), priced("gasket", 120, "10.00", lead)], at);
    const lead = buildComparison({ ...BOARD, recipients: [tie("slow", 9, 10), tie("quick", 2, 20)] }, NOW);
    expect(winnersOf(lead).get("valve")).toBe("quick");

    const early = buildComparison({ ...BOARD, recipients: [tie("later", 5, 50), tie("earlier", 5, 20)] }, NOW);
    expect(winnersOf(early).get("valve")).toBe("earlier");

    const stated = buildComparison({ ...BOARD, recipients: [tie("unstated", null, 10), tie("stated", 30, 40)] }, NOW);
    expect(winnersOf(stated).get("valve")).toBe("stated");
  });

  it("leaves an expired quote and a closed supplier out of the running", () => {
    const input: ComparisonInput = {
      ...BOARD,
      recipients: BOARD.recipients.map((r) =>
        r.supplier.businessId === "emirates"
          ? { ...r, quote: { ...r.quote!, expiresAt: new Date("2026-09-23T00:00:00Z") } }
          : r.supplier.businessId === "northern"
            ? { ...r, supplier: { ...r.supplier, closed: true } }
            : r,
      ),
    };
    const model = buildComparison(input, NOW);
    expect(row(model, "emirates").state).toBe("expired");
    expect(row(model, "northern").state).toBe("supplier_closed");
    expect(Object.fromEntries(winnersOf(model))).toEqual({ valve: "alwaha", coupling: "alwaha", gasket: "alwaha" });
    // One supplier wins every line: that is a quote, not a split.
    expect(model.cheapest).toBeNull();
    expect(model.acceptable).toBe(2);
  });

  it("draws no card when a line has no comparable price anywhere", () => {
    const input: ComparisonInput = {
      ...BOARD,
      recipients: BOARD.recipients.map((r) =>
        r.quote ? { ...r, quote: { ...r.quote, lines: r.quote.lines.filter((l) => l.enquiryLineId !== "gasket") } } : r,
      ),
    };
    expect(buildComparison(input, NOW).cheapest).toBeNull();
  });

  it("states a split with no saving line when no single supplier quoted every line", () => {
    const input: ComparisonInput = {
      ...BOARD,
      recipients: [
        quoted(EMIRATES, [priced("valve", 40, "183.00"), priced("coupling", 120, "50.00")], 175),
        quoted(NORTHERN, [priced("coupling", 120, "41.00", 12), priced("gasket", 120, "11.00", 12)], 370),
      ],
    };
    const split = buildComparison(input, NOW).cheapest!;
    expect(aed(split.totalFils)).toBe("13560.00");
    expect(split.against).toBeNull();
  });
});

describe("lines the buyer did not ask for", () => {
  it("counts a quote line with nothing to answer in the total, and on no column", () => {
    const input: ComparisonInput = {
      ...BOARD,
      recipients: [
        quoted(AL_WAHA, [priced("valve", 40, "198.00"), priced("coupling", 120, "46.00"), priced("gasket", 120, "12.00"), priced(null, 1, "350.00")], 100),
      ],
    };
    const alWaha = row(buildComparison(input, NOW), "alwaha");
    expect(aed(alWaha.totalFils)).toBe("15230.00");
    expect(aed(alWaha.linesFils)).toBe("14880.00");
    expect([alWaha.extraLines, aed(alWaha.extraFils)]).toEqual([1, "350.00"]);
  });

  it("adds the parts of a line priced in two, and compares the sum", () => {
    const input: ComparisonInput = {
      ...BOARD,
      recipients: [
        quoted(AL_WAHA, [priced("valve", 24, "198.00", 0), priced("valve", 16, "205.00", 14), priced("coupling", 120, "46.00"), priced("gasket", 120, "12.00")], 100),
      ],
    };
    const cell = row(buildComparison(input, NOW), "alwaha").cells[0]!;
    expect(cell.kind === "priced" && [cell.qty, cell.parts, cell.comparable, cell.leadTimeDays, cell.unitFils]).toEqual([40, 2, true, 14, null]);
  });
});

describe("after the decision", () => {
  it("freezes as the record once a quote is accepted: no winners, no card, nobody waiting", () => {
    const input: ComparisonInput = {
      ...BOARD,
      acceptedBusinessId: "alwaha",
      acceptedAt: minutes(900),
      recipients: BOARD.recipients.map((r) => ({
        ...r,
        quote: r.quote ? { ...r.quote, status: r.supplier.businessId === "alwaha" ? "accepted" : "lost" } : null,
        state: r.supplier.businessId === "alwaha" ? "quoted" : "declined",
      })),
    };
    const model = buildComparison(input, NOW);
    expect(model.phase).toBe("accepted");
    expect(row(model, "alwaha").state).toBe("accepted");
    expect(row(model, "emirates").state).toBe("declined");
    expect(winnersOf(model).size).toBe(0); // no marks on a record
    expect(model.cheapest).toBeNull();
    expect(model.rows.at(-1)!.kind).toBe("no_quote");
  });

  it("reads a closed enquiry as closed, with nothing acceptable", () => {
    const model = buildComparison(BOARD, new Date("2026-09-28T00:00:00Z"));
    expect(model.phase).toBe("closed");
    expect(model.acceptable).toBe(0);
    expect(model.cheapest).toBeNull();
  });

  it("names a supplier's own decline as theirs", () => {
    const input: ComparisonInput = {
      ...BOARD,
      recipients: [
        ...BOARD.recipients.slice(0, 4),
        { ...BOARD.recipients[4]!, state: "declined", declinedAt: minutes(300), declineReason: "No stock of EPDM gaskets" },
      ],
    };
    const last = buildComparison(input, NOW).rows.at(-1)!;
    expect(last.kind === "no_quote" && [last.declinedBySupplier, last.declineReason]).toEqual([true, "No stock of EPDM gaskets"]);
  });

  it("marks a quote priced against an earlier revision of the requirement", () => {
    const input: ComparisonInput = { ...BOARD, revision: 2 };
    expect(row(buildComparison(input, NOW), "alwaha").superseded).toBe(true);
  });
});

describe("lead time against the buyer's own date (flag 6)", () => {
  const needed = new Date("2026-10-04T20:00:00Z"); // 5 Oct in Dubai

  it("is on time when it lands on or before the needed-by day", () => {
    expect(leadTone(0, needed, NOW)).toBe("ok");
    expect(leadTone(11, needed, NOW)).toBe("ok");
    expect(leadTone(12, needed, NOW)).toBe("late");
  });

  it("claims nothing without a date or a lead time", () => {
    expect(leadTone(12, null, NOW)).toBe("none");
    expect(leadTone(null, needed, NOW)).toBe("none");
  });
});
