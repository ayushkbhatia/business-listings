import { describe, expect, it } from "vitest";
import { accessLine, authorityLabel, constraintPhrases, reasonLine, ruleSentences, type RuleFacts } from "./words";
import { historyWords } from "./history-words";
import { commitmentFils } from "./value";

/**
 * Board `7b` `B2`/`B3` — the rule card is rendered from the settings, and
 * every routing rule that can hold an approval has its sentence.
 */

const BOARD: RuleFacts = {
  thresholdAed: 25_000,
  approverName: "Rami Haddad",
  unverifiedNeedsApproval: false,
  requirePoNumber: true,
  requireCostCode: false,
  hasProcurement: true,
  hasRequesters: true,
  approverHasNoCover: true,
};

describe("the rule card", () => {
  it("renders the board's rule from its settings, with the sentence the board left out", () => {
    const sentences = ruleSentences(BOARD);
    expect(sentences.lead).toBe("Quotes over AED 25,000 need approval from Rami Haddad before they are accepted.");
    expect(sentences.rest).toContain("Nobody approves their own request.");
    expect(sentences.rest).toContain("A PO number is required to accept a quote.");
    expect(sentences.rest.some((s) => s.startsWith("Procurement accept quotes up to their own monthly limit"))).toBe(true);
    expect(sentences.rest.some((s) => s.startsWith("A quote a requester wants accepted"))).toBe(true);
    expect(sentences.gap).toMatch(/^Nobody can approve Rami Haddad's own quotes/);
  });

  it("follows the settings when they move: no threshold, both references, an admin approves", () => {
    const sentences = ruleSentences({
      ...BOARD,
      thresholdAed: null,
      approverName: null,
      requireCostCode: true,
      unverifiedNeedsApproval: true,
      hasProcurement: false,
      hasRequesters: false,
      approverHasNoCover: false,
    });
    expect(sentences.lead).toBe("There is no company threshold. Each person accepts quotes within their own authority.");
    expect(sentences.rest).toContain("A PO number and a cost code are required to accept a quote.");
    expect(sentences.rest).toContain(
      "Quotes from suppliers without a verified trade licence need approval from an admin, at any value.",
    );
    expect(sentences.gap).toBeNull();
  });

  it("never says order, block or payment — the platform has none of the three", () => {
    const all = [BOARD, { ...BOARD, thresholdAed: null, unverifiedNeedsApproval: true, requireCostCode: true }]
      .flatMap((facts) => {
        const s = ruleSentences(facts);
        return [s.lead, ...s.rest, s.gap ?? ""];
      })
      .join(" ");
    expect(all).not.toMatch(/\border|\bblock|\bpayment/i);
  });
});

describe("the team table and the reasons", () => {
  it("states a limit with its period", () => {
    expect(authorityLabel("procurement", 25_000)).toBe("AED 25,000 a month");
    expect(authorityLabel("company_admin", null)).toBe("Unlimited");
    expect(authorityLabel("requester", null)).toBe("Cannot approve");
  });

  it("gives the approver the counter, not only the limit", () => {
    expect(
      reasonLine("over_limit", { thresholdAed: 25_000, raiserName: "Priya Menon", usedAed: "12400.00", limitAed: 25_000 }),
    ).toBe("Beyond Priya Menon's monthly limit: AED 12,400 of AED 25,000 already used");
  });
});

describe("delivery constraints", () => {
  it("reads the board's three addresses back in the board's words", () => {
    expect(accessLine({ accessPoint: "Loading bay", accessFrom: 420, accessUntil: 1020 })).toBe("Loading bay access 07:00–17:00");
    expect(accessLine({ accessPoint: null, accessFrom: null, accessUntil: 660 })).toBe("Deliveries before 11:00");
    expect(accessLine({ accessPoint: null, accessFrom: null, accessUntil: null })).toBeNull();
    expect(
      constraintPhrases({ emirate: "dubai", areaName: "Business Bay", accessPoint: null, accessFrom: null, accessUntil: null, loadLimit: "small_parcels" }),
    ).toEqual(["Business Bay, Dubai", "Small parcels only"]);
  });
});

describe("the history", () => {
  it("says what changed on the details, before and after", () => {
    const words = historyWords({
      kind: "details_changed",
      actorName: "Rami Haddad",
      before: { trn: null },
      after: { trn: "100448216900003" },
      note: null,
    });
    expect(words.sentence).toBe("Rami Haddad changed the company details.");
    expect(words.changes).toEqual(["TRN: none → 100 4482 1690 0003"]);
  });

  it("names the flag that moved", () => {
    const words = historyWords({ kind: "rule_changed", actorName: "Rami Haddad", before: { requirePoNumber: false }, after: { requirePoNumber: true }, note: null });
    expect(words.sentence).toBe("Rami Haddad turned on “Require a PO number”.");
  });

  it("quotes a query", () => {
    const words = historyWords({ kind: "approval_queried", actorName: "Rami Haddad", before: null, after: { quoteRef: "QT-8841-R2" }, note: "Is delivery included?" });
    expect(words).toEqual({ sentence: "Rami Haddad queried QT-8841-R2.", changes: [], quote: "Is delivery included?" });
  });
});

describe("what a quote commits", () => {
  it("totals lines in fils, and gives a proposal a total only on a fixed fee", () => {
    expect(commitmentFils({ lines: [{ qty: 3, unitPrice: "5208.00" }], proposal: null })).toBe(1_562_400n);
    expect(
      commitmentFils({ lines: [], proposal: { feeBasis: "fixed_fee", feeAed: "210000.00", mobilisationAed: "6000.00" } }),
    ).toBe(21_600_000n);
    expect(commitmentFils({ lines: [], proposal: { feeBasis: "per_month", feeAed: "18400.00", mobilisationAed: null } })).toBeNull();
  });
});
