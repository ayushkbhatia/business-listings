import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { expectNoAxeViolations } from "../axe";
import { AcceptedRecordView } from "@/app/(public)/enquiry/[id]/accepted/_record";
import type { AcceptedRecord } from "@/lib/enquiry/accepted-record";
import {
  agreedFacts,
  commitmentLines,
  isAcceptedProposal,
  paymentLine,
  siteLines,
} from "@/lib/enquiry/accepted-proposal-words";
import { t } from "@/lib/i18n";
import { acceptedQuotePdf } from "@/lib/quote/record-pdf";

/**
 * Board `7c-s` — the accepted proposal as rendered, against its acceptance
 * criteria.
 *
 * What the date rules' own tests cannot see: that no total renders in any form
 * (AC3), that nothing on the page reads as a line table or a progress state
 * (AC2, AC9), that the exclusions arrive verbatim and uneditable (AC1, AC8), that
 * the review waits for its cycle (B10), and that the PDF carries the page's own
 * fields (AC10).
 */

const LINKS = {
  pdf: "/enquiry/e1/accepted/pdf?t=tok",
  thread: "/enquiry/e1/thread/emirates-facilities-group?t=tok",
  review: "/review/new?enq=e1&t=tok",
  rebrief: { supplier: "/rfq/new?to=emirates-facilities-group", others: "/rfq/new?category=hard-fm&kind=services" },
};

const EXCLUDED =
  "Major plant replacement, refrigerant gas beyond 5 kg per annum, civil and builder's work.\nSpare parts above AED 500 quoted separately before proceeding.";

function fixture(overrides: Partial<AcceptedRecord> = {}): AcceptedRecord {
  return {
    enquiryId: "e1",
    ref: "ENQ-40812",
    buyerReference: "DP-FM-2026-14",
    acceptedAt: new Date("2026-09-12T08:00:00Z"),
    isBrief: true,
    declinedCount: 3,
    quote: {
      id: "q1",
      ref: "PR-40812-R1",
      revision: 1,
      note: null,
      paymentTerms: "in_arrears",
      delivery: null,
      validityDays: 30,
      sentAt: new Date("2026-09-09T06:00:00Z"),
      expiresAt: new Date("2026-10-09T06:00:00Z"),
      lines: [],
      totalAed: "0.00",
      proposal: {
        feeAed: "18400.00",
        feeBasis: "per_month",
        feeBasisLabel: "Per month",
        mobilisationAed: "6000.00",
        termMonths: 24,
        serviceName: "Planned and reactive MEP maintenance",
        turnaround: "4-hour attendance on reactive calls",
        scope: "Quarterly PPM visits across both towers.",
        deliverable: "Monthly written report with photographs",
        deliveredWhere: "On site, both towers",
        exclusions: EXCLUDED,
      },
    },
    work: {
      brief: {
        subcategoryName: "Hard FM & MEP maintenance",
        emirate: "dubai",
        areaName: "Business Bay",
        building: "Bay Square",
        engagementType: "ongoing_contract",
        cadence: "quarterly",
        startMode: "from_date",
        startsOn: new Date("2026-11-01T00:00:00Z"),
      },
      site: { building: "Bay Square", areaName: "Business Bay", emirate: "dubai" },
      turnaroundLabel: "Response time",
      tradeSlug: "hard-fm",
      serviceSlug: "planned-and-reactive-mep-maintenance",
    },
    supplier: {
      id: "b1",
      slug: "emirates-facilities-group",
      displayName: "Emirates Facilities Group",
      person: { name: "Hana Qasim", role: "Contracts lead", phone: "+971552184470" },
      phone: null,
      whatsapp: null,
      location: null,
    },
    commitments: [],
    review: { kind: "none" },
    report: { kind: "none" },
    ...overrides,
  };
}

const BEFORE_START = new Date("2026-09-14T08:00:00Z");
const RUNNING = new Date("2027-03-02T08:00:00Z");
const ENDING = new Date("2028-09-13T08:00:00Z");

function renderRecord(record: AcceptedRecord, now = BEFORE_START) {
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

describe("what was agreed — AC2 to AC5", () => {
  it("renders no line table, no quantity, no unit price and no zero total", () => {
    const { container } = renderRecord(fixture());
    expect(screen.queryByRole("table")).toBeNull();
    expect(container.textContent).not.toMatch(/0\.00|Qty|Line total|Unit price/);
  });

  it("prints no total in any voice: no sum of the fee over the term, with or without mobilisation — AC3", () => {
    const { container } = renderRecord(fixture());
    const text = container.textContent ?? "";
    // 18,400 × 12 · × 12 + 6,000 · × 24 · × 24 + 6,000
    for (const sum of ["220,800", "226,800", "441,600", "447,600"]) expect(text).not.toContain(sum);
    expect(text).not.toMatch(/\bTotal\b/);
    // …and says why, on the page.
    expect(screen.getByText(t("accepted_proposal.no_total.lead"))).toBeInTheDocument();
  });

  it("shows the term as a duration and both of its dates — AC4", () => {
    renderRecord(fixture());
    expect(screen.getByText("24 months · 1 Nov 2026 to 31 Oct 2028")).toBeInTheDocument();
  });

  it("renders the fee basis as read-only words from the service — AC5", () => {
    renderRecord(fixture());
    const card = screen.getByRole("heading", { name: t("accepted_proposal.agreed.title") }).closest("div.rounded-card, [class*='rounded-card']")!;
    const scope = within(card as HTMLElement);
    expect(scope.getByText("Per month")).toBeInTheDocument();
    expect(scope.getByText(t("accepted_proposal.basis.note"))).toBeInTheDocument();
    expect(scope.queryByRole("textbox")).toBeNull();
    expect(scope.queryByRole("combobox")).toBeNull();
    expect(scope.queryByRole("button")).toBeNull();
  });

  it("keeps an unstated mobilisation and payment visible and grey, never a zero", () => {
    const base = fixture();
    renderRecord(
      fixture({ quote: { ...base.quote, paymentTerms: null, proposal: { ...base.quote.proposal!, mobilisationAed: null } } }),
    );
    const muted = screen.getAllByText(t("accepted_proposal.not_stated"));
    expect(muted.length).toBeGreaterThanOrEqual(2);
    for (const node of muted) expect(node).toHaveClass("text-muted");
    expect(screen.queryByText(/AED 0\b/)).toBeNull();
  });

  it("drops term and cadence for a one-off job, and says when it starts", () => {
    const base = fixture();
    renderRecord(
      fixture({
        quote: { ...base.quote, proposal: { ...base.quote.proposal!, termMonths: null, feeBasisLabel: "Fixed fee" } },
        work: { ...base.work!, brief: { ...base.work!.brief!, engagementType: "one_off_job", cadence: null } },
      }),
    );
    expect(screen.queryByText(t("accepted.proposal.term"))).toBeNull();
    expect(screen.queryByText(t("accepted_proposal.cadence"))).toBeNull();
    expect(screen.getByText(t("accepted_proposal.start"))).toBeInTheDocument();
    expect(screen.queryByText(t("accepted_proposal.contract.eyebrow"))).toBeNull();
  });

  it("names where the work happens as the buyer's site, not the supplier's branch", () => {
    renderRecord(fixture());
    expect(screen.getByText(t("accepted_proposal.where.label"))).toBeInTheDocument();
    expect(screen.getByText("Your site · Bay Square")).toBeInTheDocument();
    expect(screen.getByText("Business Bay, Dubai")).toBeInTheDocument();
  });
});

describe("the exclusions — AC1 and AC8", () => {
  it("render verbatim, line breaks kept, with nothing that could edit them", () => {
    renderRecord(fixture());
    const quote = screen.getByText((_, node) => node?.tagName === "BLOCKQUOTE" && node.textContent === EXCLUDED);
    expect(quote).toHaveClass("whitespace-pre-line");
    const panel = quote.parentElement!;
    expect(within(panel).queryByRole("textbox")).toBeNull();
    expect(within(panel).queryByRole("button")).toBeNull();
  });

  it("say so when the supplier listed none", () => {
    const base = fixture();
    renderRecord(fixture({ quote: { ...base.quote, proposal: { ...base.quote.proposal!, exclusions: null } } }));
    expect(screen.getByText(t("accepted.proposal.excluded_none", { supplier: "Emirates Facilities Group" }))).toBeInTheDocument();
  });
});

describe("the rail — B6, B9, B10", () => {
  it("lists commitments from the proposal's fields, each labelled by its source — AC6", () => {
    renderRecord(fixture());
    expect(screen.getByText("4-hour attendance on reactive calls")).toBeInTheDocument();
    expect(screen.getByText("Response time · from their scope sheet")).toBeInTheDocument();
    expect(screen.getByText("1 Nov 2026 · from your brief")).toBeInTheDocument();
    expect(screen.getByText(t("accepted_proposal.commitments.note"))).toBeInTheDocument();
    // Thread extraction is the goods board's; nothing here says *Said … by*.
    expect(screen.queryByText(/^Said /)).toBeNull();
  });

  it("implies no tracking: no progress bar, no completion, no countdown to an SLA — AC9", () => {
    const { container } = renderRecord(fixture(), RUNNING);
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.queryByRole("meter")).toBeNull();
    expect(container.textContent).not.toMatch(/\b(completed|complete|delivered on|visits done|on track|overdue|SLA)\b/i);
  });

  it("holds the review until the first cycle, with the day and no button", () => {
    renderRecord(fixture(), BEFORE_START);
    expect(screen.getByText(t("accepted_proposal.review.after_quarter"))).toBeInTheDocument();
    expect(screen.getByText(/Reviews of this engagement open on 1 Feb 2027/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: t("accepted.review.write") })).toBeNull();
  });

  it("offers the review against the scope once the cycle has run", () => {
    renderRecord(fixture(), RUNNING);
    expect(screen.getByRole("link", { name: t("accepted.review.write") })).toHaveAttribute("href", LINKS.review);
    expect(screen.getByText(/did the work match what was agreed\?/)).toBeInTheDocument();
  });

  it("links to a written review rather than prompting again", () => {
    renderRecord(fixture({ review: { kind: "posted", postedAt: new Date("2027-02-10T08:00:00Z") } }), RUNNING);
    expect(screen.getByRole("link", { name: t("accepted.review.read") })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: t("accepted.review.write") })).toBeNull();
  });

  it("surfaces a term ending inside ninety days, and routes renewal to a new brief", () => {
    renderRecord(fixture(), ENDING);
    expect(screen.getByRole("heading", { name: "The term ends in 49 days" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Brief Emirates Facilities Group again" })).toHaveAttribute("href", LINKS.rebrief.supplier);
    expect(screen.getByRole("link", { name: t("accepted_proposal.rebrief.others") })).toHaveAttribute("href", LINKS.rebrief.others);
  });

  it("leads the rail with coming back once the term has started, and not before", () => {
    const first = (now: Date) => {
      const { container, unmount } = renderRecord(fixture(), now);
      const headings = [...container.querySelectorAll("h2")].map((h) => h.textContent);
      unmount();
      return headings;
    };
    const before = first(BEFORE_START);
    const after = first(RUNNING);
    const railStart = (headings: (string | null)[]) => headings.indexOf(t("accepted.commitments.title"));
    expect(before.indexOf(t("accepted_proposal.contract.eyebrow"))).toBeGreaterThan(railStart(before));
    expect(after.indexOf(t("accepted_proposal.contract.eyebrow"))).toBeLessThan(railStart(after));
  });
});

describe("accessibility", () => {
  it("has one h1, the supplier's displayName, and no axe violations", async () => {
    const { container } = renderRecord(fixture(), ENDING);
    const h1 = screen.getAllByRole("heading", { level: 1 });
    expect(h1).toHaveLength(1);
    expect(h1[0]).toHaveTextContent("Emirates Facilities Group");
    await expectNoAxeViolations(container);
  });
});

/* ── AC10 — the PDF carries the page's fields ─────────────────────────────── */

function pdfText(bytes: Buffer): string {
  return [...bytes.toString("latin1").matchAll(/\((.*?)\) Tj/g)]
    .map((m) => m[1]!.replace(/\\267/g, "·").replace(/\\222/g, "'").replace(/\\\(/g, "(").replace(/\\\)/g, ")"))
    .join(" ")
    .replace(/\s+/g, " ");
}

describe("the PDF — AC10, the same fields as the page", () => {
  it("prints every agreed term, the site, the payment, the commitments and the exclusions the page prints", () => {
    const record = fixture();
    if (!isAcceptedProposal(record)) throw new Error("fixture is a proposal");
    const text = pdfText(acceptedQuotePdf(record, BEFORE_START).bytes);

    for (const fact of agreedFacts(record)) expect(text).toContain(fact.value);
    for (const line of siteLines(record)) expect(text).toContain(line);
    expect(text).toContain(paymentLine(record).value);
    for (const line of commitmentLines(record)) {
      expect(text).toContain(line.text);
      expect(text).toContain(line.source.toUpperCase());
    }
    for (const paragraph of EXCLUDED.split("\n")) expect(text).toContain(paragraph);
    expect(text).toContain("Quarterly PPM visits across both towers.");
    expect(text).toContain("ACCEPTED PROPOSAL");
    expect(text).toContain(t("accepted_proposal.no_total.lead"));
  });

  it("carries no line table and no total either", () => {
    const record = fixture();
    const text = pdfText(acceptedQuotePdf(record, BEFORE_START).bytes);
    expect(text).not.toMatch(/LINE TOTAL|QTY|Total excl\. VAT|226,800|447,600/);
    expect(text).toContain("does not supervise the work");
  });
});
