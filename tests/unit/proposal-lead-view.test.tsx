import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { expectNoAxeViolations } from "../axe";
import { t } from "@/lib/i18n";

/**
 * Board `3j-s` — the lead for work and its composer, as rendered.
 *
 * What a function test cannot see: that no line table, quantity or unit price
 * renders (AC1), that the fee basis is a fact on the page rather than a control
 * (B1 — not a disabled select, no select at all), that *Ask a question first*
 * comes before *Decline* (B4), that an empty scale renders as absent and says
 * what to do (the board's own rule), and that a scope sheet with no basis blocks
 * the send and routes to the sheet (AC8).
 */

const saveProposalDraftAction = vi.fn(async () => ({ ok: true, savedAt: Date.now() }));
const sendProposalAction = vi.fn(async () => ({
  ok: false as const,
  error: "The proposal was not sent. Some fields need changing first.",
  refusals: [{ field: "fee" as const, code: "required" as const }],
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/app/(dashboard)/dashboard/leads/actions", () => ({ saveProposalDraftAction, sendProposalAction }));

const { ProposalComposer } = await import("@/app/(dashboard)/dashboard/leads/ProposalComposer");
const { ProposalLeadView } = await import("@/app/(dashboard)/dashboard/leads/_proposal-view");
type Model = import("@/app/(dashboard)/dashboard/leads/_proposal-view").ProposalLeadModel;
type Option = import("@/app/(dashboard)/dashboard/leads/ProposalComposer").ProposalServiceOption;

const SERVICE: Option = {
  id: "svc",
  name: "Planned and reactive MEP maintenance",
  draft: false,
  basis: "ok",
  feeBasisLabel: "Per month",
  editHref: "/dashboard/services/svc",
  seed: { scope: "Quarterly PPM", deliverable: "Monthly report", deliveredWhere: "On site", exclusions: "Major plant replacement" },
};

const MODEL: Model = {
  ref: "ENQ-8851",
  title: "Hard FM & MEP maintenance",
  replyChip: { tone: "neutral", label: "Reply due in 2 h" },
  othersLabel: "Also sent to 5 others",
  backHref: "/dashboard/leads",
  brief: {
    rows: [
      { key: "site", label: "Site", value: "Dubai · Bay Square, Business Bay" },
      { key: "engagement", label: "Engagement", value: "Ongoing contract · Quarterly" },
      { key: "scale", label: "Scale, in their words", value: t("proposal.brief_scale_none"), missing: true },
    ],
    requirement: "Two commercial towers, 12 and 14 floors.",
    attachments: [],
  },
  buyer: { name: "Mohammed", released: [] },
  state: { kind: "compose" },
  sent: [],
};

function composer(services: Option[] = [SERVICE]) {
  return (
    <ProposalComposer
      enquiryId="e1"
      services={services}
      initial={{
        serviceId: services[0]?.id ?? null,
        fee: "",
        mobilisation: "",
        termMonths: "",
        validityDays: 30,
        scope: SERVICE.seed.scope,
        deliverable: SERVICE.seed.deliverable,
        deliveredWhere: SERVICE.seed.deliveredWhere,
        exclusions: SERVICE.seed.exclusions,
      }}
      restoredAt={null}
      revision={1}
      others={5}
      lateSince={null}
    />
  );
}

function renderLead(options: { services?: Option[]; model?: Model } = {}) {
  return render(
    <ProposalLeadView
      model={options.model ?? MODEL}
      askHref="/dashboard/leads/e1/thread"
      askLabel={t("proposal.ask_first")}
      decline={<button type="button">{t("decline.action")}</button>}
      composer={composer(options.services)}
    />,
  );
}

describe("the lead for work", () => {
  it("renders no line table, no quantity and no unit price (AC1)", () => {
    renderLead();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByText(/unit price/i)).toBeNull();
    expect(screen.queryByText(/^qty$/i)).toBeNull();
  });

  it("states the fee basis as a fact, with no control that could change it (B1)", () => {
    renderLead();
    const basis = screen.getByText(t("proposal.basis_label"));
    expect(basis.tagName).toBe("DT");
    expect(basis.nextElementSibling).toHaveTextContent("Per month");
    // The only select on the page is the validity window.
    const selects = screen.getAllByRole("combobox");
    expect(selects).toHaveLength(1);
    expect(selects[0]).toHaveAccessibleName(t("proposal.validity_label"));
  });

  it("puts Ask a question first before Decline (B4)", () => {
    renderLead();
    const ask = screen.getByRole("link", { name: t("proposal.ask_first") });
    const decline = screen.getByRole("button", { name: t("decline.action") });
    expect(ask.compareDocumentPosition(decline) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("renders an empty scale as absent, grey, and says to ask", () => {
    renderLead();
    expect(screen.getByText(t("proposal.brief_scale_none"))).toHaveClass("text-muted");
  });

  it("says the honest recipient count, and what the buyer does not see", () => {
    renderLead();
    expect(screen.getByText("Also sent to 5 others")).toBeInTheDocument();
    expect(screen.getByText(/They do not see what the other 5 proposed/)).toBeInTheDocument();
  });

  it("blocks the send and routes to the scope sheet when the service has no basis (AC8)", () => {
    renderLead({ services: [{ ...SERVICE, basis: "no_basis", feeBasisLabel: null }] });
    expect(screen.getByRole("button", { name: t("proposal.send") })).toBeDisabled();
    expect(screen.getByRole("link", { name: t("proposal.blocked_action") })).toHaveAttribute("href", "/dashboard/services/svc");
    expect(screen.getByRole("textbox", { name: /^Fee/ })).toBeDisabled();
  });

  it("offers a choice of scope sheet only when there is more than one, and the basis follows it", () => {
    renderLead({ services: [SERVICE, { ...SERVICE, id: "svc2", name: "Chiller call-out", feeBasisLabel: "Per visit" }] });
    const pick = screen.getByLabelText(new RegExp(t("proposal.service_label")));
    fireEvent.change(pick, { target: { value: "svc2" } });
    expect(screen.getByText(t("proposal.basis_label")).nextElementSibling).toHaveTextContent("Per visit");
  });

  it("marks the field a refused send names, and clears the notice once it is fixed", async () => {
    renderLead();
    fireEvent.click(screen.getByRole("button", { name: t("proposal.send") }));
    const alert = await screen.findByText(/The proposal was not sent/);
    expect(alert).toBeInTheDocument();
    expect(screen.getByText(t("proposal.error.fee_required"))).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: /^Fee/ }), { target: { value: "18,400" } });
    await waitFor(() => expect(screen.queryByText(/The proposal was not sent/)).toBeNull());
  });

  it("has no axe violations", async () => {
    const { container } = renderLead();
    await expectNoAxeViolations(container);
  });

  it("shows a read-only outcome and the sent proposals as a real table", async () => {
    const { container } = render(
      <ProposalLeadView
        model={{
          ...MODEL,
          replyChip: null,
          state: { kind: "read_only", tone: "neutral", title: t("proposal.readonly.elsewhere_title"), body: t("proposal.readonly.elsewhere") },
          sent: [
            {
              id: "q1",
              ref: "QT-8851-EMIR1",
              sentLabel: "Sent 3 hours ago",
              fee: "AED 18,400 · Per month",
              term: "24 months",
              mobilisation: "AED 6,000 one-off",
              validUntil: "14 Oct 2026",
              status: "Lost",
            },
          ],
        }}
        askHref="/dashboard/leads/e1/thread"
        askLabel={t("lead.message_buyer")}
      />,
    );
    expect(screen.queryByRole("button", { name: t("proposal.send") })).toBeNull();
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("columnheader")).toHaveLength(6);
    expect(within(table).getByRole("rowheader")).toHaveTextContent("QT-8851-EMIR1");
    await expectNoAxeViolations(container);
  });
});
