import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { expectNoAxeViolations } from "../axe";

// The nudge posts through a server action; nothing here clicks it.
vi.mock("@/app/(public)/enquiry/nudge-action", () => ({ nudgeRecipient: vi.fn() }));

import { QuoteComparisonView } from "@/app/(public)/enquiry/[id]/compare/_quotes";
import type { ComparisonOutlook } from "@/lib/buyer-company/queue";
import type { QuoteComparisonData } from "@/lib/db/queries/quote-comparison";
import { buildComparison, type ComparedRecipient, type ComparedSupplier, type QuotedLine } from "@/lib/quote/comparison";

/**
 * Board `1n` — the comparison as rendered, against its build notes.
 *
 * What the model's tests cannot see: that the table is a real one with scoped
 * headers (non-negotiable 4), that every winner carries words as well as a
 * colour (`B2`), that every quoted row offers the same accept (`B4`), that a
 * company buyer's row says where accepting sends it (`B7`), and that the page
 * states its basis (`B6`).
 */

const NOW = new Date("2026-09-24T08:00:00Z");
const SENT = new Date("2026-09-22T05:00:00Z");
const at = (minutes: number) => new Date(SENT.getTime() + minutes * 60_000);

const supplier = (id: string, displayName: string): ComparedSupplier => ({
  businessId: id,
  slug: id,
  displayName,
  verificationTier: 2,
  verifiedAt: new Date("2026-06-01T00:00:00Z"),
  rating: id === "alwaha" ? { average: 4.8, count: 31 } : null,
  closed: false,
});

const line = (enquiryLineId: string, qty: number, unitPrice: string, leadTimeDays = 0): QuotedLine => ({
  enquiryLineId,
  qty,
  unitPrice,
  leadTimeDays,
});

function quoted(who: ComparedSupplier, minutes: number, lines: QuotedLine[]): ComparedRecipient {
  return {
    supplier: who,
    state: "quoted",
    deliveredAt: SENT,
    openedAt: at(10),
    buyerNudgedAt: null,
    repliedAt: at(minutes),
    declinedAt: null,
    declineReason: null,
    quote: {
      id: `q-${who.businessId}`,
      ref: `QT-8864-${who.businessId.toUpperCase()}R1`,
      revision: 1,
      status: "sent",
      sentAt: at(minutes),
      firstSentAt: at(minutes),
      expiresAt: new Date("2026-10-06T06:00:00Z"),
      againstRevision: 1,
      paymentTerms: "net_30",
      delivery: "included",
      lines,
    },
  };
}

const RECIPIENTS: ComparedRecipient[] = [
  quoted(supplier("alwaha", "Al Waha Industrial Supplies"), 100, [line("v", 40, "198.00"), line("c", 120, "46.00"), line("g", 120, "12.00")]),
  quoted(supplier("emirates", "Emirates Valve & Fitting Co."), 175, [line("v", 40, "183.00"), line("c", 120, "50.00")]),
  quoted(supplier("northern", "Northern Gulf Trading"), 370, [line("v", 40, "268.00", 12), line("c", 120, "41.00", 12), line("g", 120, "11.00", 12)]),
  {
    supplier: supplier("gulfcool", "Gulf Cool Technical Services"),
    state: "opened",
    deliveredAt: SENT,
    openedAt: new Date(NOW.getTime() - 2 * 86_400_000),
    buyerNudgedAt: null,
    repliedAt: null,
    declinedAt: null,
    declineReason: null,
    quote: null,
  },
];

function data(over: Partial<QuoteComparisonData["enquiry"]> = {}): QuoteComparisonData {
  const enquiry: QuoteComparisonData["enquiry"] = {
    id: "e1",
    ref: "ENQ-8864",
    requirement: "Chilled water riser — valves, couplings, gaskets. For the Marina Plaza riser.",
    createdAt: SENT,
    closesAt: new Date(NOW.getTime() + 3 * 86_400_000),
    neededBy: new Date(NOW.getTime() + 11 * 86_400_000),
    revision: 1,
    acceptedBusinessId: null,
    acceptedAt: null,
    buyerCompanyId: null,
    companyName: null,
    hasDeliveryAddress: false,
    ...over,
  };
  return {
    enquiry,
    input: {
      lines: [
        { id: "v", description: "Resilient seated gate valve, flanged", qty: 40, unit: "pcs", size: "DN100" },
        { id: "c", description: "Rigid grooved coupling", qty: 120, unit: "pcs", size: "DN100" },
        { id: "g", description: "EPDM gasket", qty: 120, unit: "pcs", size: "DN100" },
      ],
      recipients: RECIPIENTS,
      revision: 1,
      closesAt: enquiry.closesAt,
      neededBy: enquiry.neededBy,
      acceptedBusinessId: enquiry.acceptedBusinessId,
      acceptedAt: enquiry.acceptedAt,
    },
  };
}

function view(input = data(), outlook: ComparisonOutlook = { kind: "personal" }) {
  return render(
    <QuoteComparisonView
      data={input}
      model={buildComparison(input.input, NOW)}
      now={NOW}
      token={null}
      outlook={outlook}
      error={null}
      live={false}
      idPrefix="t1n"
    />,
  );
}

describe("board 1n, rendered", () => {
  it("is a real table: a scoped header per line, a row header per supplier", () => {
    view();
    const table = screen.getByRole("table", { name: /Quotes from 3 suppliers, priced line by line, excluding VAT/ });
    const heads = within(table).getAllByRole("columnheader");
    expect(heads).toHaveLength(7);
    for (const head of heads) expect(head.getAttribute("scope")).toBe("col");
    const rows = within(table).getAllByRole("rowheader");
    expect(rows.map((row) => row.getAttribute("scope"))).toEqual(["row", "row", "row", "row"]);
  });

  it("marks each line's winner with words, not colour alone (B2)", () => {
    view();
    const table = screen.getByRole("table");
    const marked = within(table).getAllByText("Lowest for this line");
    expect(marked).toHaveLength(3);
    const emirates = within(table).getByRole("rowheader", { name: /^Emirates Valve/ }).closest("tr")!;
    expect(within(emirates).getAllByText("Lowest for this line")).toHaveLength(1);
  });

  it("offers the same accept on every quoted row, named for what it does (B4)", () => {
    view();
    const accepts = screen.getAllByRole("button", { name: /^Accept .+'s quote QT-8864-\w+R1, AED [\d,]+$/ });
    expect(accepts).toHaveLength(3);
    expect(accepts.every((button) => button.textContent === "Accept")).toBe(true);
  });

  it("states its basis and computes the card from the marks (B1, B6)", () => {
    view();
    expect(screen.getByText(/All amounts in AED, excluding VAT\./)).toBeTruthy();
    expect(
      screen.getByText(
        "Splitting across Emirates Valve & Fitting Co. and Northern Gulf Trading would land at AED 13,560 — AED 1,320 under the best single quote, across 2 deliveries.",
      ),
    ).toBeTruthy();
  });

  it("says on a company buyer's row that accepting goes for approval, and to whom (B7)", () => {
    const outlook: ComparisonOutlook = {
      kind: "company",
      companyName: "Marina Facilities LLC",
      requirePoNumber: true,
      requireCostCode: false,
      quotes: new Map([
        ["q-alwaha", { required: true, approverNames: ["Rami Haddad"] }],
        ["q-emirates", { required: false, approverNames: [] }],
        ["q-northern", { required: true, approverNames: ["Rami Haddad"] }],
      ]),
    };
    view(data({ buyerCompanyId: "c1", companyName: "Marina Facilities LLC", hasDeliveryAddress: true }), outlook);
    expect(screen.getAllByRole("link", { name: /, for approval$/ })).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: /^Accept Emirates Valve/ })).toHaveLength(1);
    // B9: the release named as the query layer releases it.
    expect(screen.getByText(/So do Marina Facilities LLC's registered name, TRN, trade licence number and accounts email/)).toBeTruthy();
  });

  it("freezes as the record once a quote is accepted: no accept, no card, the others declined", () => {
    const accepted = data({ acceptedBusinessId: "alwaha", acceptedAt: new Date(NOW.getTime() - 3_600_000) });
    accepted.input = {
      ...accepted.input,
      recipients: RECIPIENTS.map((r) => (r.quote ? { ...r, quote: { ...r.quote, status: r.supplier.businessId === "alwaha" ? "accepted" : "lost" } } : r)),
    };
    view(accepted);
    expect(screen.queryAllByRole("button", { name: /^Accept / })).toHaveLength(0);
    expect(screen.queryByText(/^Splitting across/)).toBeNull();
    expect(screen.getByText(/^You accepted Al Waha Industrial Supplies's quote on /)).toBeTruthy();
    expect(screen.getAllByText("Declined")).toHaveLength(2);
  });

  it("is axe clean as drawn", async () => {
    const { container } = view();
    await expectNoAxeViolations(container);
  });
});
