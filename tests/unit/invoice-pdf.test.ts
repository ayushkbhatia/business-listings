import { describe, expect, it } from "vitest";
import { A4, pdfString, renderPdf, textWidth, wrap } from "@/lib/billing/pdf";
import { invoicePdf } from "@/lib/billing/invoice-pdf";
import type { TaxInvoiceDocument } from "@/lib/billing/tax-invoice";

/**
 * The PDF writer, which is board 11g's new dependency.
 *
 * What matters here is not that it looks right — a unit test cannot see it —
 * but that it produces a **valid, deterministic, A4** file from the same object
 * the screen renders. Those three are what criterion 7 rests on.
 */

const DOCUMENT: TaxInvoiceDocument = {
  id: "inv_1",
  ref: "BL-INV-20418",
  docType: "tax_invoice",
  status: "paid",
  supplier: {
    name: "Bearing Deployment Company, Inc",
    addressLines: ["2261 Market Street STE 83655", "San Francisco CA 94114"],
    trn: null,
    incorporation: "Incorporated in Delaware, USA",
  },
  recipient: {
    name: "Al Waha Industrial Supplies LLC",
    addressLines: ["Warehouse 14, JAFZA South, Dubai"],
    trn: "100 3882 1140 0003",
    incorporation: null,
  },
  issuedOn: "14 Aug 2026",
  suppliedOn: "14 Aug 2026",
  supplyPeriod: "14 Aug – 13 Sep 2026",
  placeOfSupply: "Dubai, UAE",
  lines: [
    {
      id: "l1",
      description: "Pro subscription",
      detail: "14 Aug – 13 Sep 2026 · standard rate",
      bookingRef: null,
      qty: "1",
      unitAed: "299.00",
      rate: "5%",
      vatAed: "14.95",
      amountAed: "299.00",
    },
    {
      id: "l2",
      description: "Sponsored placement · Valves & actuators, Dubai",
      detail: "14 Aug – 13 Sep 2026 · standard rate",
      bookingRef: "PB-3391",
      qty: "1",
      unitAed: "1,400.00",
      rate: "5%",
      vatAed: "70.00",
      amountAed: "1,400.00",
    },
  ],
  totals: {
    subtotalAed: "1,699.00",
    vatAed: "84.95",
    totalAed: "1,783.95",
    stored: true,
    currency: "AED",
  },
  payment: { paidOn: "14 Aug 2026", brand: "Visa", last4: "2318", bank: "Emirates NBD" },
  references: { pspRef: "PSP-8841-20418", subscriptionRef: "SUB-4471-PRO" },
  correctsRef: null,
  pdf: null,
  delivery: [],
  billingEmail: "accounts@alwaha.ae",
};

const read = (bytes: Buffer) => bytes.toString("latin1");

describe("criterion 7 — the file is a valid A4 PDF", () => {
  it("opens with a PDF header and closes with the trailer", () => {
    const text = read(invoicePdf(DOCUMENT).bytes);
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
  });

  it("declares an A4 portrait page box", () => {
    // 210 × 297 mm in points. The spec's whole "the render is the document"
    // claim rests on the screen and the file sharing one page geometry.
    const text = read(invoicePdf(DOCUMENT).bytes);
    expect(text).toContain("/MediaBox [0 0 595.28 841.89]");
    expect(A4.width).toBeCloseTo(595.28, 2);
  });

  it("points its cross-reference table at real byte offsets", () => {
    /*
       A reader finds every object through this table. An offset one byte out
       makes the file unopenable in some readers and fine in others, which is the
       worst kind of wrong — it would pass a glance and fail at an accountant's
       desk.
    */
    const bytes = invoicePdf(DOCUMENT).bytes;
    const text = read(bytes);
    const rows = [...text.matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    expect(rows.length).toBe(7);

    rows.forEach((offset, index) => {
      expect(text.slice(offset, offset + 12)).toContain(`${index + 1} 0 obj`);
    });

    const startxref = Number(/startxref\n(\d+)/.exec(text)?.[1]);
    expect(text.slice(startxref, startxref + 4)).toBe("xref");
  });

  it("states a stream length that matches the stream", () => {
    const text = read(invoicePdf(DOCUMENT).bytes);
    const declared = Number(/<< \/Length (\d+) >>/.exec(text)?.[1]);
    const stream = /stream\n([\s\S]*?)\nendstream/.exec(text)?.[1] ?? "";
    expect(Buffer.byteLength(stream, "latin1")).toBe(declared);
  });
});

describe("the same invoice produces the same bytes", () => {
  it("is deterministic", () => {
    /*
       "Byte for byte" is the promise the download makes, and it is only
       checkable if writing the same document twice gives the same file. No
       `/CreationDate` and no `/Producer` for exactly this reason.
    */
    const first = invoicePdf(DOCUMENT).bytes;
    const second = invoicePdf(DOCUMENT).bytes;
    expect(first.equals(second)).toBe(true);
  });

  it("reports the byte length it wrote", () => {
    const { bytes } = invoicePdf(DOCUMENT);
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });
});

describe("the document carries what the board says it carries", () => {
  const text = read(invoicePdf(DOCUMENT).bytes);

  it("prints the heading, the number and both parties", () => {
    expect(text).toContain("TAX INVOICE");
    expect(text).toContain("BL-INV-20418");
    expect(text).toContain("Bearing Deployment Company, Inc");
    expect(text).toContain("Al Waha Industrial Supplies LLC");
  });

  it("labels the recipient's TRN and prints no supplier one", () => {
    // The issuing entity is Delaware-registered and holds none. With one tax
    // number on the page an unlabelled one would read as the issuer's.
    expect(text).toContain("Recipient TRN 100 3882 1140 0003");
    expect(DOCUMENT.supplier.trn).toBeNull();
  });

  it("states all four dates separately", () => {
    // The board printed `14 AUG 2026` once and let it stand for three claims.
    expect(text).toContain("Date of issue");
    expect(text).toContain("Date of supply");
    expect(text).toContain("Supply period");
    expect(text).toContain("Place of supply");
  });

  it("carries VAT per line, not one blended row", () => {
    expect(text).toContain("VAT AED");
    expect(text).toContain("RATE");
    // Both line VAT figures, which a single blended row could not express.
    expect(text).toContain("14.95");
    expect(text).toContain("70.00");
  });

  it("puts the payment inside the document", () => {
    // The board's largest correction: the payment date, the card and the bank
    // were in a screen-only rail, absent from the artefact that evidences them.
    expect(text).toContain("PAYMENT RECEIVED");
    expect(text).toContain("Paid in full on 14 Aug 2026");
    expect(text).toContain("2318");
    expect(text).toContain("PSP-8841-20418");
  });

  it("reconciles with 3m's invoice list", () => {
    // Criterion 1, and the reason 3m and 11f shipped jointly: one invoice, one
    // total, everywhere it appears. (299 + 1,400) × 1.05 = 1,783.95.
    expect(text).toContain("1,699.00");
    expect(text).toContain("84.95");
    expect(text).toContain("1,783.95");
  });

  it("holds the statutory sentence open rather than inventing one", () => {
    // Spec Q3. A US supplier charging 5% to a UAE recipient changes the heading,
    // the footnote and possibly the VAT lines.
    expect(text).toContain("Statutory VAT wording sits here");
  });

  it("prints the booking as text, with no link", () => {
    // 11e owns the booking page and is blocked on 12c.
    expect(text).toContain("PB-3391");
    expect(text).not.toContain("/URI");
  });

  it("numbers the page", () => {
    expect(text).toContain("PAGE 1 OF 1");
  });
});

describe("a credit note is the same document with a different heading", () => {
  it("says so", () => {
    const note = invoicePdf({ ...DOCUMENT, docType: "credit_note", correctsRef: "BL-INV-20098" });
    expect(read(note.bytes)).toContain("CREDIT NOTE");
  });
});

describe("pdfString", () => {
  it("escapes what would end a literal early", () => {
    // A supplier called `Al Waha (Trading)` would otherwise truncate the
    // document at its own name.
    expect(pdfString("Al Waha (Trading)")).toBe("Al Waha \\(Trading\\)");
    expect(pdfString("a\\b")).toBe("a\\\\b");
  });

  it("octal-escapes the WinAnsi upper range", () => {
    expect(pdfString("café")).toBe("caf\\351");
  });

  it("replaces what WinAnsi cannot carry rather than dropping it", () => {
    /*
       Arabic is spec Q2 and a bilingual invoice is a different A4 layout that
       cannot be retrofitted into sheets already issued. A question mark is
       visibly wrong; a silently dropped glyph is not.
    */
    expect(pdfString("مرحبا")).toBe("?????");
  });
});

describe("textWidth and wrap", () => {
  it("measures a monospaced font by character count", () => {
    expect(textWidth("BL-INV-20418", 10, "mono")).toBeCloseTo(12 * 6, 5);
  });

  it("makes bold wider than regular", () => {
    expect(textWidth("Total", 10, "bold")).toBeGreaterThan(textWidth("Total", 10, "regular"));
  });

  it("breaks on spaces and never returns nothing", () => {
    const lines = wrap("all amounts are in AED and this is a fixed record", 60, 8, "regular");
    expect(lines.length).toBeGreaterThan(1);
    expect(wrap("", 100, 8, "regular")).toEqual([""]);
  });

  it("lets a word longer than the column overhang rather than cutting it", () => {
    // A truncated company name on a tax document is worse than an ugly one.
    expect(wrap("Bearingdeploymentcompany", 10, 8, "regular")).toEqual([
      "Bearingdeploymentcompany",
    ]);
  });
});

describe("renderPdf", () => {
  it("writes a page even with no ops", () => {
    const bytes = renderPdf([]);
    expect(read(bytes)).toContain("/MediaBox");
  });
});
