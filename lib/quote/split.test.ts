import { describe, expect, it } from "vitest";
import {
  buildComparison,
  type ComparedRecipient,
  type ComparedSupplier,
  type ComparisonInput,
  type QuotedLine,
  type RequestedLine,
} from "./comparison";
import { filsToAed } from "./money";
import { cellChoice, cheapestAcceptableSplit, picksFromParts, planSplit, splitOffered, wholeChoice } from "./split";

/**
 * Board `1o`, D1–D7 as the owner confirmed them on 1 Oct 2026, against board
 * `1n`'s comparison: three lines, four quotes. Emirates and Northern let their
 * prices hold for part of a quote; Al Waha and Technopump quote all or nothing.
 */

const NOW = new Date("2026-09-24T08:00:00Z");
const SENT = new Date("2026-09-22T06:00:00Z");
const minutes = (n: number) => new Date(SENT.getTime() + n * 60_000);

const LINES: RequestedLine[] = [
  { id: "valve", description: "Resilient seated gate valve, flanged", qty: 40, unit: "pcs", size: "DN100" },
  { id: "coupling", description: "Rigid grooved coupling", qty: 120, unit: "pcs", size: "DN100" },
  { id: "gasket", description: "EPDM gasket", qty: 120, unit: "pcs", size: "DN100" },
];

function supplier(id: string, displayName: string): ComparedSupplier {
  return { businessId: id, slug: id, displayName, verificationTier: 2, verifiedAt: null, rating: null, closed: false };
}

const priced = (enquiryLineId: string | null, qty: number | null, unitPrice: string, leadTimeDays: number | null = 0): QuotedLine => ({
  enquiryLineId,
  qty,
  unitPrice,
  leadTimeDays,
  acceptedAt: null,
});

function quoted(who: ComparedSupplier, lines: QuotedLine[], at: number, allowsPartial: boolean): ComparedRecipient {
  return {
    supplier: who,
    state: "quoted",
    deliveredAt: SENT,
    openedAt: minutes(10),
    buyerNudgedAt: null,
    repliedAt: minutes(at),
    declinedAt: null,
    declineReason: null,
    quote: {
      id: `q-${who.businessId}`,
      ref: `QT-8864-${who.businessId.toUpperCase()}`,
      revision: 1,
      status: "sent",
      sentAt: minutes(at),
      firstSentAt: minutes(at),
      expiresAt: new Date("2026-10-06T06:00:00Z"),
      againstRevision: 1,
      paymentTerms: "net_30",
      delivery: "included",
      allowsPartial,
      lines,
    },
  };
}

const AL_WAHA = supplier("alwaha", "Al Waha Industrial Supplies");
const EMIRATES = supplier("emirates", "Emirates Valve & Fitting Co.");
const NORTHERN = supplier("northern", "Northern Gulf Trading");
const TECHNOPUMP = supplier("technopump", "Technopump Trading LLC");

type Partial4 = { alwaha?: boolean; emirates?: boolean; northern?: boolean; technopump?: boolean };

function board(partial: Partial4 = { emirates: true, northern: true }, over: Partial<ComparisonInput> = {}): ComparisonInput {
  return {
    lines: LINES,
    revision: 1,
    closesAt: new Date("2026-09-27T06:00:00Z"),
    neededBy: null,
    acceptedBusinessId: null,
    acceptedAt: null,
    recipients: [
      quoted(AL_WAHA, [priced("valve", 40, "198.00"), priced("coupling", 120, "46.00"), priced("gasket", 120, "12.00")], 100, !!partial.alwaha),
      quoted(EMIRATES, [priced("valve", 40, "183.00"), priced("coupling", 120, "50.00")], 175, !!partial.emirates),
      quoted(
        NORTHERN,
        [priced("valve", 40, "268.00", 12), priced("coupling", 120, "41.00", 12), priced("gasket", 120, "11.00", 12)],
        370,
        !!partial.northern,
      ),
      quoted(
        TECHNOPUMP,
        [priced("valve", 40, "236.00", 10), priced("coupling", 120, "48.00", 10), priced("gasket", 120, "13.00", 10)],
        560,
        !!partial.technopump,
      ),
    ],
    ...over,
  };
}

const model = (input: ComparisonInput = board()) => buildComparison(input, NOW);
const aed = (fils: bigint) => filsToAed(fils);
const pick = (lineId: string, who: string) => ({ lineId, quoteId: `q-${who}` });

describe("planSplit — the board's split, accepted (D2, D3)", () => {
  it("plans the 13,560 split: Emirates' valve, Northern's couplings and gaskets", () => {
    const planned = planSplit(model(), [pick("valve", "emirates"), pick("coupling", "northern"), pick("gasket", "northern")]);
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    const { plan } = planned;
    expect(aed(plan.totalFils)).toBe("13560.00");
    expect(plan.deliveries).toBe(2);
    expect(plan.single).toBe(false);
    expect(plan.unchosenLineIds).toEqual([]);
    expect(plan.parts.map((part) => [part.supplier.businessId, part.lineIds, part.whole, aed(part.totalFils)])).toEqual([
      ["emirates", ["valve"], false, "7320.00"],
      ["northern", ["coupling", "gasket"], false, "6240.00"],
    ]);
  });

  it("names the larger share as the main supplier — the one the decided marker carries", () => {
    const planned = planSplit(model(), [pick("valve", "emirates"), pick("coupling", "northern"), pick("gasket", "northern")]);
    expect(planned.ok && planned.plan.primaryBusinessId).toBe("emirates");
  });

  it("leaves a line nobody was chosen for unaccepted, and says which (D3)", () => {
    const planned = planSplit(model(), [pick("valve", "emirates"), pick("coupling", "northern")]);
    expect(planned.ok && planned.plan.unchosenLineIds).toEqual(["gasket"]);
  });

  it("reads one supplier's every priced line as the ordinary accept, not a split (AC7)", () => {
    const planned = planSplit(model(), [pick("valve", "alwaha"), pick("coupling", "alwaha"), pick("gasket", "alwaha")]);
    expect(planned.ok && planned.plan.single).toBe(true);
    expect(planned.ok && planned.plan.parts[0]!.whole).toBe(true);
  });

  it("takes an all-or-nothing quote whole beside another supplier's line (D1)", () => {
    // Emirates priced two lines; both from them is all of their quote.
    const input = board({ northern: true });
    const planned = planSplit(model(input), [pick("valve", "emirates"), pick("coupling", "emirates"), pick("gasket", "northern")]);
    expect(planned.ok).toBe(true);
    expect(planned.ok && planned.plan.parts[0]!.whole).toBe(true);
  });
});

describe("planSplit — what it refuses", () => {
  it("refuses part of a quote whose supplier did not opt in (D1)", () => {
    expect(planSplit(model(board({ emirates: true })), [pick("valve", "emirates"), pick("coupling", "northern"), pick("gasket", "northern")])).toEqual({
      ok: false,
      error: "all_or_nothing",
      lineId: "coupling",
    });
  });

  it("refuses one line twice (D2: one line, one supplier)", () => {
    expect(planSplit(model(), [pick("valve", "emirates"), pick("valve", "northern")])).toEqual({
      ok: false,
      error: "line_twice",
      lineId: "valve",
    });
  });

  it("refuses a line the supplier did not price", () => {
    expect(planSplit(model(), [pick("gasket", "emirates")])).toEqual({ ok: false, error: "not_quoted", lineId: "gasket" });
  });

  it("refuses a line priced at another quantity than the one asked (D2)", () => {
    const input = board();
    input.recipients[1]!.quote!.lines = [priced("valve", 30, "183.00"), priced("coupling", 120, "50.00")];
    expect(planSplit(model(input), [pick("valve", "emirates")])).toEqual({ ok: false, error: "other_quantity", lineId: "valve" });
  });

  it("refuses an empty selection, an unknown line and an unknown quote", () => {
    expect(planSplit(model(), [])).toEqual({ ok: false, error: "empty" });
    expect(planSplit(model(), [pick("hose", "emirates")])).toEqual({ ok: false, error: "unknown_line", lineId: "hose" });
    expect(planSplit(model(), [pick("valve", "nobody")])).toEqual({ ok: false, error: "unknown_quote", lineId: "valve" });
  });

  it("refuses once the enquiry is decided: no quote is open", () => {
    const decided = model(board(undefined, { acceptedBusinessId: "alwaha", acceptedAt: NOW }));
    expect(planSplit(decided, [pick("valve", "emirates")])).toMatchObject({ ok: false, error: "not_open" });
  });
});

describe("D7 — a line the supplier added goes with any part", () => {
  it("adds Northern's delivery charge to their part, and counts it", () => {
    const input = board();
    input.recipients[2]!.quote!.lines = [...input.recipients[2]!.quote!.lines, priced(null, null, "150.00")];
    const planned = planSplit(model(input), [pick("valve", "emirates"), pick("coupling", "northern"), pick("gasket", "northern")]);
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    const northern = planned.plan.parts.find((part) => part.supplier.businessId === "northern")!;
    expect(northern.extraLines).toBe(1);
    expect(aed(northern.extraFils)).toBe("150.00");
    expect(aed(northern.totalFils)).toBe("6390.00");
    expect(aed(planned.plan.totalFils)).toBe("13710.00");
  });
});

describe("cells and wholes", () => {
  it("says why a cell cannot be taken alone", () => {
    const rows = model().rows.filter((row) => row.kind === "quoted");
    const alwaha = rows.find((row) => row.supplier.businessId === "alwaha")!;
    const emirates = rows.find((row) => row.supplier.businessId === "emirates")!;
    expect(cellChoice(alwaha, 0)).toEqual({ ok: false, reason: "all_or_nothing" });
    expect(cellChoice(emirates, 0)).toEqual({ ok: true });
    expect(cellChoice(emirates, 2)).toEqual({ ok: false, reason: "not_quoted" });
    expect(wholeChoice(alwaha)).toEqual({ ok: true });
  });

  it("offers a split only where somebody opted in", () => {
    expect(splitOffered(model())).toBe(true);
    expect(splitOffered(model(board({})))).toBe(false);
  });
});

describe("cheapestAcceptableSplit — the card, within the rules", () => {
  it("finds the board's 13,560 when both suppliers in it opted in, 1,320 under Al Waha", () => {
    const best = cheapestAcceptableSplit(model());
    expect(best && aed(best.plan.totalFils)).toBe("13560.00");
    expect(best?.against?.supplier.businessId).toBe("alwaha");
    expect(best && aed(best.against!.savingFils)).toBe("1320.00");
    expect(best?.blockedLower).toEqual([]);
  });

  it("finds the cheapest split the rules allow when the cheapest cells are all-or-nothing: 14,280", () => {
    // Northern quotes all or nothing; Al Waha opted in. Its couplings and gaskets
    // are dearer than Northern's, but they are the cheapest that may be taken alone.
    const best = cheapestAcceptableSplit(model(board({ emirates: true, alwaha: true })));
    expect(best && aed(best.plan.totalFils)).toBe("14280.00");
    expect(best?.picks).toEqual([pick("valve", "emirates"), pick("coupling", "alwaha"), pick("gasket", "alwaha")]);
    expect(best && aed(best.against!.savingFils)).toBe("600.00");
    // The card says why the lower prices are not in it.
    expect(best?.blockedLower).toEqual([
      { lineId: "coupling", businessId: "northern" },
      { lineId: "gasket", businessId: "northern" },
    ]);
  });

  it("draws nothing when nobody opted in: every cover is one supplier's whole quote", () => {
    expect(cheapestAcceptableSplit(model(board({})))).toBeNull();
  });

  it("draws nothing once the enquiry is decided", () => {
    expect(cheapestAcceptableSplit(model(board(undefined, { acceptedBusinessId: "alwaha", acceptedAt: NOW })))).toBeNull();
  });
});

describe("picksFromParts — a request's parts, asked again (D5)", () => {
  it("expands a whole part to every line its quote priced, and keeps a part's own lines", () => {
    expect(
      picksFromParts(model(), [
        { quoteId: "q-emirates", enquiryLineIds: null },
        { quoteId: "q-northern", enquiryLineIds: ["gasket"] },
      ]),
    ).toEqual([pick("valve", "emirates"), pick("coupling", "emirates"), pick("gasket", "northern")]);
  });

  it("is null when a part's quote is no longer on the comparison", () => {
    expect(picksFromParts(model(), [{ quoteId: "q-gone", enquiryLineIds: null }])).toBeNull();
  });
});
