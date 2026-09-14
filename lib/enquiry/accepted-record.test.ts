import { describe, expect, it } from "vitest";
import { acceptedQuotePdf } from "@/lib/quote/record-pdf";
import { formatAED } from "@/lib/format";
import {
  chooseContactLocation,
  recordLines,
  windowExpired,
  type AcceptedRecord,
} from "./accepted-record";
import { leadTime, totalLabel, windowLine } from "./accepted-record-words";

/**
 * Board `7c` — the arithmetic and the words the page and the PDF share.
 *
 * The handoff's correction is the reason this file exists: *"The total did not
 * add up"* — 15,344.00 stated over lines summing to 14,600.00, on the one board
 * whose whole claim is that it is the record. `B2` says the total is computed at
 * render and never stored; `B7` says the PDF shows the same figures as the page.
 * Both are asserted here against the board's own three lines.
 */

const BOARD_LINES = [
  { id: "l1", description: "Grooved butterfly valve DN100, ductile iron", qty: 40, unitPrice: "191.00", leadTimeDays: 0, productId: "p1", sku: "AW-VLV-BF-100" },
  { id: "l2", description: "Grooved rigid coupling, 4 inch, painted", qty: 120, unitPrice: "46.00", leadTimeDays: 0, productId: "p2", sku: "AW-GRV-RC-100" },
  { id: "l3", description: "Grooved gasket, EPDM, 4 inch", qty: 120, unitPrice: "12.00", leadTimeDays: 2, productId: null, sku: null },
];

const NOW = new Date("2026-08-25T08:00:00Z");

function record(overrides: Partial<AcceptedRecord["quote"]> = {}): AcceptedRecord {
  const { lines, totalAed } = recordLines(BOARD_LINES);
  return {
    enquiryId: "e1",
    ref: "ENQ-8841",
    buyerReference: "PO-2026-0418",
    acceptedAt: new Date("2026-08-21T08:00:00Z"),
    isBrief: false,
    declinedCount: 3,
    quote: {
      id: "q1",
      ref: "QT-8841-R2",
      revision: 2,
      note: null,
      paymentTerms: "net_30",
      delivery: "included",
      validityDays: 14,
      sentAt: new Date("2026-08-21T06:00:00Z"),
      expiresAt: new Date("2026-09-04T06:00:00Z"),
      lines,
      totalAed,
      proposal: null,
      ...overrides,
    },
    supplier: {
      id: "b1",
      slug: "al-waha",
      displayName: "Al Waha Industrial Supplies",
      person: null,
      phone: "+97142345678",
      whatsapp: null,
      location: { type: "warehouse", addressLine: "Warehouse 14, JAFZA South", areaName: "Jebel Ali Free Zone", emirate: "dubai" },
    },
    commitments: [],
    review: { kind: "none" },
    report: { kind: "none" },
  };
}

describe("recordLines — the correction, B2", () => {
  it("sums the board's three lines to 14,600.00, not the 15,344.00 the board printed", () => {
    const { lines, totalAed } = recordLines(BOARD_LINES);
    expect(lines.map((line) => line.lineTotal)).toEqual(["7640.00", "5520.00", "1440.00"]);
    expect(totalAed).toBe("14600.00");
  });

  it("labels a hand-priced line and never borrows a SKU for it — B5", () => {
    const { lines } = recordLines([{ ...BOARD_LINES[2]!, sku: "LEAKED-SKU" }]);
    expect(lines[0]).toMatchObject({ manual: true, sku: null });
  });

  it("totals a line priced as a whole once, not per unit", () => {
    const { lines, totalAed } = recordLines([{ ...BOARD_LINES[0]!, qty: null, unitPrice: "18500.00" }]);
    expect(lines[0]!.lineTotal).toBe("18500.00");
    expect(totalAed).toBe("18500.00");
  });

  it("adds in fils, so a total of many small lines is exact", () => {
    const tiny = Array.from({ length: 30 }, (_, i) => ({ ...BOARD_LINES[2]!, id: `t${i}`, qty: 3, unitPrice: "0.10" }));
    expect(recordLines(tiny).totalAed).toBe("9.00");
  });
});

describe("chooseContactLocation — step 3.4's missing orderBy", () => {
  const at = (day: number) => new Date(`2026-01-${String(day).padStart(2, "0")}T00:00:00Z`);
  const locations = [
    { id: "c", type: "trade_counter", createdAt: at(1) },
    { id: "w", type: "warehouse", createdAt: at(3) },
    { id: "h", type: "head_office", createdAt: at(5) },
  ];

  it("names the branch of the seat the lead was routed to", () => {
    expect(chooseContactLocation(locations, "w")!.id).toBe("w");
  });

  it("falls back to the head office, then by age, whatever order the rows arrive in", () => {
    expect(chooseContactLocation(locations, null)!.id).toBe("h");
    expect(chooseContactLocation([...locations].reverse(), "not-published")!.id).toBe("h");
    const twins = [
      { id: "b", type: "warehouse", createdAt: at(2) },
      { id: "a", type: "warehouse", createdAt: at(2) },
    ];
    expect(chooseContactLocation(twins, null)!.id).toBe("a");
    expect(chooseContactLocation([...twins].reverse(), null)!.id).toBe("a");
  });

  it("is null with no published branch, which the page words as its own state", () => {
    expect(chooseContactLocation([], null)).toBeNull();
  });
});

describe("the words the page and the PDF share", () => {
  it("reads the price window as held, and as ended once it has passed", () => {
    expect(windowLine(record(), NOW)).toBe("Revision 2 · price held 14 days from 21 Aug 2026");
    const later = new Date("2026-09-10T00:00:00Z");
    expect(windowExpired(record().quote.expiresAt, later)).toBe(true);
    expect(windowLine(record(), later)).toBe("Revision 2 · price held 14 days from 21 Aug 2026, ended 4 Sep 2026");
  });

  it("adds the delivery half of the total label only when the quote stated it", () => {
    expect(totalLabel(record())).toBe("Total excl. VAT · delivery included");
    expect(totalLabel(record({ delivery: null }))).toBe("Total excl. VAT");
  });

  it("says ex-stock for zero days and not stated for none", () => {
    expect(leadTime(0)).toBe("Ex-stock");
    expect(leadTime(2)).toBe("2 days");
    expect(leadTime(null)).toBe("Not stated on the quote");
  });
});

/** Every string the PDF draws, in order. */
function pdfText(bytes: Buffer): string[] {
  return [...bytes.toString("latin1").matchAll(/\((.*?)\) Tj/g)].map((m) => m[1]!.replace(/\\267/g, "·"));
}

describe("acceptedQuotePdf — B7, the same figures as the page", () => {
  it("prints every line total and the total the page prints, from the same value", () => {
    const value = record();
    const text = pdfText(acceptedQuotePdf(value, NOW).bytes);
    for (const line of value.quote.lines) {
      expect(text).toContain(formatAED(line.lineTotal, { style: "quote" }));
    }
    expect(text).toContain(formatAED(value.quote.totalAed, { style: "quote" }));
    expect(text).toContain("14,600.00");
    expect(text).not.toContain("15,344.00");
  });

  it("names the supplier by displayName, the buyer's reference, and the terms", () => {
    const text = pdfText(acceptedQuotePdf(record(), NOW).bytes);
    expect(text).toContain("Al Waha Industrial Supplies");
    expect(text.some((op) => op.includes("PO-2026-0418"))).toBe(true);
    expect(text).toContain("30 days from invoice");
    expect(text).toContain("Total excl. VAT · delivery included");
  });

  it("says what the platform is not, on the document a buyer forwards", () => {
    const joined = pdfText(acceptedQuotePdf(record(), NOW).bytes).join(" ");
    expect(joined).toContain("takes no payment");
    expect(joined).not.toMatch(/\b(invoice from us|refund|purchase|order total)\b/i);
  });

  it("is deterministic: the same record renders the same bytes", () => {
    expect(acceptedQuotePdf(record(), NOW).bytes.equals(acceptedQuotePdf(record(), NOW).bytes)).toBe(true);
  });

  it("paginates a long quote rather than drawing lines off the sheet", () => {
    const { lines, totalAed } = recordLines(
      Array.from({ length: 70 }, (_, i) => ({ ...BOARD_LINES[i % 3]!, id: `x${i}`, description: `Line ${i + 1}` })),
    );
    const rendered = acceptedQuotePdf(record({ lines, totalAed }), NOW);
    expect(rendered.pages).toBeGreaterThan(1);
    const text = pdfText(rendered.bytes);
    expect(text).toContain("Line 70");
    expect(text).toContain(`PAGE ${rendered.pages} OF ${rendered.pages}`);
    // Every page object is in the file the foot claims.
    expect(rendered.bytes.toString("latin1")).toContain(`/Count ${rendered.pages}`);
  });
});
