import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { expectNoAxeViolations } from "../axe";
import { AcceptedRecordView } from "@/app/(public)/enquiry/[id]/accepted/_record";
import { recordLines, type AcceptedRecord } from "@/lib/enquiry/accepted-record";
import { t } from "@/lib/i18n";

/**
 * Board `7c` — the record as rendered, in the states the board documents.
 *
 * What a pure-function test cannot see: that the total a buyer reads is the sum
 * of the line totals they read (acceptance criterion 2, checked against the
 * markup as `CLAUDE.md` §4 asks), that nothing on the page implies delivery or
 * payment state (AC8), that the unanswered facts stay visible, and that the
 * table is a real table.
 */

const NOW = new Date("2026-08-25T08:00:00Z");

const LINKS = {
  pdf: "/enquiry/e1/accepted/pdf?t=tok",
  thread: "/enquiry/e1/thread/al-waha?t=tok",
  review: "/review/new?enq=e1&t=tok",
};

function fixture(overrides: Partial<AcceptedRecord> = {}): AcceptedRecord {
  const { lines, totalAed } = recordLines([
    { id: "l1", description: "Grooved butterfly valve DN100, ductile iron", qty: 40, unitPrice: "191.00", leadTimeDays: 0, productId: "p1", sku: "AW-VLV-BF-100" },
    { id: "l2", description: "Grooved rigid coupling, 4 inch, painted", qty: 120, unitPrice: "46.00", leadTimeDays: 0, productId: "p2", sku: "AW-GRV-RC-100" },
    { id: "l3", description: "Grooved gasket, EPDM, 4 inch", qty: 120, unitPrice: "12.00", leadTimeDays: 2, productId: null, sku: null },
  ]);
  return {
    enquiryId: "e1",
    ref: "ENQ-8841",
    buyerReference: "PO-2026-0418",
    costCode: null,
    delivery: null,
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
    },
    work: null,
    supplier: {
      id: "b1",
      slug: "al-waha",
      displayName: "Al Waha Industrial Supplies",
      person: { name: "Rajesh Nair", role: "Sales lead", phone: "+971557041120" },
      phone: "+97142345678",
      whatsapp: null,
      location: { type: "warehouse", addressLine: "Warehouse 14, JAFZA South", areaName: "Jebel Ali Free Zone", emirate: "dubai" },
    },
    commitments: [
      { messageId: "m1", text: "One drop, 40 valves and 120 couplings, on 4 Sep.", saidAt: new Date("2026-08-22T08:00:00Z") },
    ],
    review: { kind: "none" },
    report: { kind: "none" },
    ...overrides,
  };
}

function renderRecord(record: AcceptedRecord, now = NOW) {
  return render(
    <AcceptedRecordView
      record={record}
      now={now}
      links={LINKS}
      breadcrumb={null}
      referenceForm={<span>reference slot</span>}
      reportForm={<button type="button">{t("accepted.report.open")}</button>}
    />,
  );
}

/** "7,640.00" → 764000 fils. */
const fils = (text: string) => Math.round(Number(text.replace(/[^\d.]/g, "")) * 100);

describe("the typical state", () => {
  it("names the supplier by displayName in the one h1", () => {
    renderRecord(fixture());
    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent("Al Waha Industrial Supplies");
  });

  it("prints a total that is the sum of the line totals on the page — AC2", () => {
    renderRecord(fixture());
    const table = screen.getByRole("table");
    const rows = within(table).getAllByRole("row").slice(1, -1);
    expect(rows).toHaveLength(3);
    const lineTotals = rows.map((row) => fils(within(row).getAllByRole("cell")[2]!.textContent ?? ""));
    const totalRow = within(table).getAllByRole("row").at(-1)!;
    const total = fils(within(totalRow).getAllByRole("cell")[0]!.textContent ?? "");
    expect(lineTotals.reduce((a, b) => a + b, 0)).toBe(total);
    expect(total).toBe(1_460_000);
  });

  it("is a real table with column and row headers", () => {
    renderRecord(fixture());
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("columnheader")).toHaveLength(5);
    // Three lines and the total.
    expect(within(table).getAllByRole("rowheader")).toHaveLength(4);
  });

  it("labels the hand-priced line and shows the SKU of the catalogue ones — B5", () => {
    renderRecord(fixture());
    expect(screen.getByText(t("accepted.line.manual"))).toBeInTheDocument();
    expect(screen.getByText("AW-VLV-BF-100")).toBeInTheDocument();
  });

  it("says the others were declined, with the count", () => {
    renderRecord(fixture());
    expect(screen.getByText(t("accepted.released_declined", { count: 3 }))).toBeInTheDocument();
  });

  it("states the payment terms with the supplier invoicing, not us", () => {
    renderRecord(fixture());
    expect(screen.getByText(t("terms.net_30"))).toBeInTheDocument();
    expect(screen.getByText(t("accepted.payment.invoiced_by_them"))).toBeInTheDocument();
  });

  it("quotes the supplier's commitment and says it is unverified", () => {
    renderRecord(fixture());
    expect(screen.getByText("One drop, 40 valves and 120 couplings, on 4 Sep.")).toBeInTheDocument();
    expect(screen.getByText(t("accepted.commitments.note"))).toBeInTheDocument();
  });

  it("implies no delivery, fulfilment or payment state anywhere — AC8", () => {
    const { container } = renderRecord(fixture());
    expect(container.textContent).not.toMatch(/\b(delivered|in transit|dispatched|shipped|completed?|paid|refund|order total)\b/i);
  });

  it("makes no claim that reviews move ranking — the handoff's flag", () => {
    const { container } = renderRecord(fixture());
    expect(container.textContent).not.toMatch(/ranking/i);
  });

  it("offers the report control while there is no report", () => {
    renderRecord(fixture());
    expect(screen.getByRole("button", { name: t("accepted.report.open") })).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = renderRecord(fixture());
    await expectNoAxeViolations(container);
  });
});

describe("the other documented states", () => {
  it("single-supplier: no declined line", () => {
    renderRecord(fixture({ declinedCount: 0 }));
    expect(screen.getByText(t("accepted.released_only"))).toBeInTheDocument();
    expect(screen.queryByText(/declined for you/)).not.toBeInTheDocument();
  });

  it("window ended: the record stands and the held line reads as ended", () => {
    renderRecord(fixture(), new Date("2026-09-10T00:00:00Z"));
    expect(screen.getByText(t("accepted.expired_note"))).toBeInTheDocument();
    expect(screen.getByText(/ended 4 Sep 2026/)).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("nothing stated: payment and lead time stay visible as not stated", () => {
    const record = fixture();
    renderRecord({
      ...record,
      quote: {
        ...record.quote,
        paymentTerms: null,
        delivery: null,
        lines: record.quote.lines.map((line) => ({ ...line, leadTimeDays: null })),
      },
    });
    expect(screen.getAllByText(t("accepted.not_stated")).length).toBe(4);
    expect(screen.getByText(t("accepted.total"))).toBeInTheDocument();
  });

  it("no published branch and no phone: says so and points at the thread", () => {
    const record = fixture();
    renderRecord({ ...record, supplier: { ...record.supplier, person: null, phone: null, whatsapp: null, location: null } });
    expect(screen.getByText(t("accepted.where.none"))).toBeInTheDocument();
    expect(screen.getByRole("link", { name: t("accepted.contact.no_phone") })).toHaveAttribute("href", LINKS.thread);
  });

  it("review written: a link to it rather than a second prompt", () => {
    renderRecord(fixture({ review: { kind: "posted", postedAt: new Date("2026-08-30T08:00:00Z") } }));
    expect(screen.getByRole("link", { name: t("accepted.review.read") })).toHaveAttribute("href", LINKS.review);
    expect(screen.queryByRole("link", { name: t("accepted.review.write") })).not.toBeInTheDocument();
  });

  it("review window closed: the day it closed, and no button to a form that is not offered — board 10f", () => {
    // Accepted 21 Aug 2026; ninety days on is 19 Nov, so 20 Nov is closed.
    renderRecord(fixture(), new Date("2026-11-20T08:00:00Z"));
    expect(screen.queryByRole("link", { name: t("accepted.review.write") })).not.toBeInTheDocument();
    expect(screen.getByText(/Reviews of this quote closed on 19 Nov 2026/)).toBeInTheDocument();
  });

  it("problem reported: the case and its state, and no control offered again", () => {
    renderRecord(fixture({ report: { kind: "open", filedAt: new Date("2026-08-28T08:00:00Z") } }));
    expect(screen.getByText(/You reported this on 28 Aug 2026/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("accepted.report.open") })).not.toBeInTheDocument();
  });

  it("problem resolved: the named outcome and the reason", () => {
    renderRecord(
      fixture({
        report: {
          kind: "resolved",
          filedAt: new Date("2026-08-28T08:00:00Z"),
          outcome: "seller_corrected",
          reason: "Replacement couplings delivered and confirmed by the buyer in the thread.",
          resolvedAt: new Date("2026-09-02T08:00:00Z"),
        },
      }),
    );
    expect(screen.getByText(/the supplier corrected it/)).toBeInTheDocument();
    expect(screen.getByText(/Replacement couplings delivered/)).toBeInTheDocument();
  });

  it("a brief: rendered, and says where scope lives", () => {
    renderRecord(fixture({ isBrief: true }));
    expect(screen.getByText(t("accepted.brief_note"))).toBeInTheDocument();
  });
});

// An accepted proposal renders the board `7c-s` shape: `accepted-proposal-view.test.tsx`.
