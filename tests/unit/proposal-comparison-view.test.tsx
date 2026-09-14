import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { expectNoAxeViolations } from "../axe";
import { ProposalComparisonView } from "@/app/(public)/enquiry/[id]/compare/_proposals";
import type { ComparisonColumn, ProposalComparison } from "@/lib/db/queries/proposal-comparison";
import { t } from "@/lib/i18n";

/**
 * Board `1n-s` — the comparison as rendered, against its acceptance criteria.
 *
 * What the footing tests cannot see: that the figure printed is the figure
 * computed, that the working sits in the same cell (B2), that the rows are in
 * the order the page's own instruction depends on (AC10), and that no word on
 * the page ranks a column (AC7).
 */

const NOW = new Date("2026-09-14T08:00:00Z");
const SENT = new Date("2026-09-09T06:00:00Z");

function column(id: string, name: string, proposal: Partial<ComparisonColumn["proposal"]>, extra: Partial<ComparisonColumn> = {}): ComparisonColumn {
  return {
    businessId: id,
    slug: id,
    displayName: name,
    licenceVerified: true,
    credentials: [],
    quote: { id: `q-${id}`, ref: `QT-${id}`, revision: 1, status: "sent", sentAt: SENT, expiresAt: new Date("2026-10-09T06:00:00Z"), paymentTerms: null },
    arrivedAt: SENT,
    repliedInMs: 41 * 60_000,
    state: "open",
    ...extra,
    proposal: {
      feeAed: "18400",
      feeBasis: "per_month",
      feeBasisLabel: "Per month",
      mobilisationAed: null,
      termMonths: null,
      serviceName: "Hard FM",
      scope: "Planned maintenance.",
      turnaround: null,
      deliverable: null,
      deliveredWhere: null,
      exclusions: null,
      ...proposal,
    },
  };
}

const EFG = column("efg", "Emirates Facilities Group", { mobilisationAed: "6000", termMonths: 24, exclusions: "Major plant replacement" });
const SHIRAWI = column("alsh", "Al Shirawi Facilities", { feeAed: "5100", feeBasis: "per_visit", feeBasisLabel: "Per visit", termMonths: 12 });
const KHANSAHEB = column("khan", "Khansaheb Facilities", { feeAed: "5.40", feeBasis: "per_sqft_yr", feeBasisLabel: "Per sq ft / yr", termMonths: 12 });

const COMPARISON: ProposalComparison = {
  enquiryId: "e1",
  ref: "ENQ-40812",
  requirement: "Two commercial towers.",
  createdAt: SENT,
  closesAt: new Date("2026-09-23T06:00:00Z"),
  scale: "12 floors, 3 chillers, about 40,000 sq ft",
  brief: {
    subcategoryName: "Hard FM & MEP maintenance",
    emirate: "dubai",
    areaName: null,
    building: "Business Bay",
    engagementType: "ongoing_contract",
    cadence: "quarterly",
    startMode: "asap",
    startsOn: null,
  },
  subcategoryName: "Hard FM & MEP maintenance",
  turnaroundLabel: "Response time",
  engagementType: "ongoing_contract",
  cadence: "quarterly",
  acceptedBusinessId: null,
  recipientCount: 6,
  columns: [EFG, SHIRAWI, KHANSAHEB],
  declined: [{ businessId: "d", displayName: "Northern Cooling Services", declineReason: "Outside our area" }],
  waiting: [
    { businessId: "w1", displayName: "Gulf Towers Maintenance", declineReason: null },
    { businessId: "w2", displayName: "Sand and Steel Services", declineReason: null },
  ],
  firstProposalInMs: 41 * 60_000,
};

async function noop() {}

function view(comparison: ProposalComparison = COMPARISON, figures = { areaSqFt: null as number | null, visitsPerYear: null as number | null }) {
  return render(
    <ProposalComparisonView comparison={comparison} now={NOW} token="tok" figures={figures} error={null} acceptAction={noop} />,
  );
}

const rowNamed = (name: RegExp) => screen.getAllByRole("row").find((row) => within(row).queryByRole("rowheader", { name }))!;

describe("the comparison", () => {
  it("shows each figure in its own unit, unmodified (AC1)", () => {
    view();
    const asProposed = rowNamed(/As proposed/i);
    expect(asProposed).toHaveTextContent("AED 18,400");
    expect(asProposed).toHaveTextContent("Per visit");
    expect(asProposed).toHaveTextContent("AED 5.40");
  });

  it("labels the twelve-month row as ours and shows the operation in each cell (AC2, AC3, AC4)", () => {
    view();
    const row = rowNamed(/Over 12 months/i);
    expect(within(row).getByRole("rowheader")).toHaveTextContent(t("compare_proposals.row.twelve_months_note"));
    const cells = within(row).getAllByRole("cell");
    expect(cells[0]).toHaveTextContent("AED 226,800");
    expect(cells[0]).toHaveTextContent("× 12 months, plus AED 6,000 mobilisation");
    expect(cells[1]).toHaveTextContent("AED 20,400");
    expect(cells[1]).toHaveTextContent("× 4 visits, from your brief's quarterly cadence");
  });

  it("gives no number for a per-unit basis with no figure, and names the words it will not read (AC5, AC6)", () => {
    view();
    const cell = within(rowNamed(/Over 12 months/i)).getAllByRole("cell")[2]!;
    expect(cell).not.toHaveTextContent(/AED/);
    expect(cell).toHaveTextContent(/Not worked out/);
    expect(screen.getByText(/Your brief gave the scale in words: “12 floors, 3 chillers, about 40,000 sq ft”/)).toBeInTheDocument();
  });

  it("works the column on the buyer's area and marks it", () => {
    view(COMPARISON, { areaSqFt: 40_000, visitsPerYear: null });
    const cell = within(rowNamed(/Over 12 months/i)).getAllByRole("cell")[2]!;
    expect(cell).toHaveTextContent("AED 216,000");
    expect(cell).toHaveTextContent(t("compare_proposals.uses_your_figure"));
  });

  it("ranks, badges and recommends nothing (AC7)", () => {
    const { container } = view();
    expect(container.textContent).not.toMatch(/lowest|cheapest|best value|recommended|fastest/i);
  });

  it("counts and names the suppliers who have not replied, and says who declined (AC8)", () => {
    view();
    expect(screen.getByText(/3 of 6 replied/i)).toBeInTheDocument();
    expect(screen.getByText(/Not replied yet: Gulf Towers Maintenance, Sand and Steel Services/)).toBeInTheDocument();
    expect(screen.getByText(/Northern Cooling Services declined: “Outside our area”/)).toBeInTheDocument();
  });

  it("renders the term and the exclusions above the accept controls (B4, AC10)", () => {
    view();
    const rows = screen.getAllByRole("row");
    const index = (name: RegExp) => rows.findIndex((row) => within(row).queryByRole("rowheader", { name }));
    const accept = rows.findIndex((row) => within(row).queryAllByRole("button").length > 0);
    expect(index(/^Term$/i)).toBeGreaterThan(0);
    expect(index(/Excluded/i)).toBeLessThan(accept);
    expect(within(rowNamed(/^Term$/i)).getAllByRole("cell")[0]).toHaveTextContent("24 months");
  });

  it("makes only the first accept primary, and names every accept by its supplier", () => {
    view();
    const buttons = screen.getAllByRole("button", { name: /Accept the proposal from/ });
    expect(buttons).toHaveLength(3);
    expect(buttons[0]).toHaveTextContent(t("compare_proposals.accept_primary"));
    expect(buttons[1]).toHaveTextContent(t("compare_proposals.accept"));
  });

  it("suppresses the twelve-month row when every proposal shares a basis", () => {
    view({ ...COMPARISON, columns: [EFG, column("b2", "Khansaheb Facilities", { feeAed: "19250" })] });
    expect(screen.queryByRole("rowheader", { name: /Over 12 months/i })).toBeNull();
    expect(screen.getByText(/nothing to convert/)).toBeInTheDocument();
  });

  it("keeps an expired proposal visible and not acceptable (Q4)", () => {
    view({ ...COMPARISON, columns: [EFG, { ...SHIRAWI, state: "expired", quote: { ...SHIRAWI.quote, expiresAt: new Date("2026-09-12T06:00:00Z") } }] });
    expect(screen.getAllByRole("button", { name: /Accept the proposal from/ })).toHaveLength(1);
    expect(screen.getByText(/Past validity — ended/)).toBeInTheDocument();
  });

  it("freezes as the record once accepted", () => {
    view({ ...COMPARISON, acceptedBusinessId: "efg", waiting: [], columns: [{ ...EFG, state: "accepted" }, { ...SHIRAWI, state: "declined" }] });
    expect(screen.queryAllByRole("button", { name: /Accept/ })).toHaveLength(0);
    expect(screen.getByRole("link", { name: t("compare_proposals.open_record") })).toHaveAttribute("href", "/enquiry/e1/accepted?t=tok");
    expect(screen.queryByLabelText(/Area of the site/)).toBeNull();
  });

  it("is the brief and who it went to when nobody has replied", () => {
    view({ ...COMPARISON, columns: [], firstProposalInMs: null });
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByRole("heading", { name: t("compare_proposals.none_title") })).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = view();
    await expectNoAxeViolations(container);
  });
});
