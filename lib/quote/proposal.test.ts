import { describe, expect, it } from "vitest";
import {
  PROPOSAL_TEXT_MAX,
  checkProposal,
  comparableFees,
  draftProposal,
  readAmount,
  readTermMonths,
  toProposalFigure,
  type ProposalInput,
} from "./proposal";

const typed: ProposalInput = {
  serviceId: "svc",
  fee: "18,400",
  mobilisation: "AED 6,000",
  termMonths: "24 months",
  validityDays: 30,
  paymentTerms: "",
  scope: "  Quarterly PPM across both towers.\r\n24/7 reactive line.  ",
  deliverable: "Monthly written report with photographs",
  deliveredWhere: "On site, both towers",
  exclusions: "Major plant replacement",
};

describe("readAmount", () => {
  it("reads what a seller types, commas and the currency included", () => {
    expect(readAmount("18,400")).toBe(1_840_000n);
    expect(readAmount("18400.5")).toBe(1_840_050n);
    expect(readAmount("AED 1,234,567.89")).toBe(123_456_789n);
    expect(readAmount("  ")).toBeNull();
  });

  it("refuses what is not an amount rather than reading a number out of it", () => {
    for (const text of ["18-20k", "eighteen thousand", "18,4", "1,23,456", "18.456", "-400"]) {
      expect(readAmount(text)).toBe("invalid");
    }
  });
});

describe("readTermMonths", () => {
  it("takes whole months from one to ten years", () => {
    expect(readTermMonths("24")).toBe(24);
    expect(readTermMonths("1 month")).toBe(1);
    expect(readTermMonths("")).toBeNull();
    expect(readTermMonths("0")).toBe("invalid");
    expect(readTermMonths("121")).toBe("invalid");
    expect(readTermMonths("2.5")).toBe("invalid");
  });
});

describe("checkProposal", () => {
  it("cleans the ends of the text and keeps the seller's words inside it", () => {
    const result = checkProposal(typed);
    expect(result).toEqual({
      ok: true,
      value: {
        feeAed: "18400.00",
        mobilisationAed: "6000.00",
        termMonths: 24,
        scope: "Quarterly PPM across both towers.\n24/7 reactive line.",
        deliverable: "Monthly written report with photographs",
        deliveredWhere: "On site, both towers",
        exclusions: "Major plant replacement",
      },
    });
  });

  it("keeps a stated nil mobilisation apart from an unstated one", () => {
    expect(checkProposal({ ...typed, mobilisation: "0" })).toMatchObject({ value: { mobilisationAed: "0.00" } });
    expect(checkProposal({ ...typed, mobilisation: "" })).toMatchObject({ value: { mobilisationAed: null } });
  });

  it("names every refusal at once, in field order", () => {
    const result = checkProposal({
      ...typed,
      fee: "0",
      mobilisation: "lots",
      termMonths: "forever",
      scope: "",
      deliverable: "x".repeat(201),
      exclusions: "x".repeat(PROPOSAL_TEXT_MAX + 1),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusals).toEqual([
      { field: "fee", code: "zero" },
      { field: "mobilisation", code: "not_amount" },
      { field: "term", code: "not_months" },
      { field: "scope", code: "required" },
      { field: "deliverable", code: "too_long" },
      { field: "exclusions", code: "too_long" },
    ]);
  });

  it("refuses an amount the column cannot hold", () => {
    expect(checkProposal({ ...typed, fee: "10000000000" })).toMatchObject({ ok: false, refusals: [{ field: "fee", code: "too_large" }] });
  });
});

describe("draftProposal", () => {
  it("keeps what reads and forgets what does not, without refusing", () => {
    expect(draftProposal({ ...typed, fee: "18,4", termMonths: "2 years", exclusions: "x".repeat(5000) })).toMatchObject({
      feeAed: null,
      mobilisationAed: "6000.00",
      termMonths: null,
    });
    expect(draftProposal({ ...typed, exclusions: "x".repeat(5000) }).exclusions).toHaveLength(PROPOSAL_TEXT_MAX);
  });
});

describe("toProposalFigure", () => {
  it("is null for a row nobody was sent — no fee, or no basis", () => {
    const row = { feeAed: "18400", feeBasis: "per_month", feeBasisLabel: "Per month", mobilisationAed: null, termMonths: 24 };
    expect(toProposalFigure(row)).toEqual({ ...row, mobilisationAed: null });
    expect(toProposalFigure({ ...row, feeAed: null })).toBeNull();
    expect(toProposalFigure({ ...row, feeBasis: null, feeBasisLabel: null })).toBeNull();
    expect(toProposalFigure(null)).toBeNull();
  });

  it("compares two fees only on the same basis", () => {
    const month = { feeAed: "18400", feeBasis: "per_month", feeBasisLabel: "Per month", mobilisationAed: null, termMonths: null };
    expect(comparableFees(month, { ...month, feeAed: "17900" })).toBe(true);
    expect(comparableFees(month, { ...month, feeBasis: "fixed_fee", feeBasisLabel: "Fixed fee" })).toBe(false);
  });
});
