import { describe, expect, it } from "vitest";
import { mrrComposition, type CompositionAccount } from "./mrr-composition";

/**
 * D-MRR, board 4a — the owner's answer of 1 Oct 2026: MRR is `4g`'s ledger
 * figure, and what it is made of is printed and held equal to it.
 *
 * The export flagged 1,284 × 99 + 762 × 299 = 354,954 against an MRR of
 * 388,254 with nothing to say where 33,300 came from. These tests are the
 * handoff's "a test should fail if list price × mix doesn't equal the
 * subscription line" — made to pass by naming each difference rather than by
 * assuming there is none.
 */

const PLANS = [
  { id: "free", name: "Free", monthlyPriceAed: 0, annualMonthsCharged: null },
  { id: "basic", name: "Basic", monthlyPriceAed: 99, annualMonthsCharged: 10 },
  { id: "pro", name: "Pro", monthlyPriceAed: 299, annualMonthsCharged: 10 },
];

function accounts(planId: string, count: number, mrrFils: number): CompositionAccount[] {
  return Array.from({ length: count }, () => ({ planId, mrrFils }));
}

describe("list price × plan mix, and what the ledger adds to it", () => {
  it("is the handoff's 354,954 for its own mix, all monthly", () => {
    const book = [...accounts("basic", 1_284, 9_900), ...accounts("pro", 762, 29_900)];
    const composition = mrrComposition(book, PLANS);
    expect(composition.atListFils).toBe(354_954 * 100);
    expect(composition.ledgerFils).toBe(354_954 * 100);
    expect(composition.annual).toEqual({ accounts: 0, fils: 0 });
    expect(composition.other).toEqual({ accounts: 0, fils: 0 });
    expect(composition.plans.map((plan) => [plan.planId, plan.accounts, plan.atListFils])).toEqual([
      ["basic", 1_284, 127_116 * 100],
      ["pro", 762, 227_838 * 100],
    ]);
  });

  it("names an annual term and what it takes off", () => {
    // The seed's case: seven Basic monthly at 349, six Pro monthly and two Pro annual at 899.
    const plans = [
      { id: "basic", name: "Basic", monthlyPriceAed: 349, annualMonthsCharged: 10 },
      { id: "pro", name: "Pro", monthlyPriceAed: 899, annualMonthsCharged: 10 },
    ];
    const annualPro = Math.round((89_900 * 10) / 12);
    const book = [...accounts("basic", 7, 34_900), ...accounts("pro", 6, 89_900), ...accounts("pro", 2, annualPro)];
    const composition = mrrComposition(book, plans);
    expect(composition.atListFils).toBe(7 * 34_900 + 8 * 89_900);
    expect(composition.annual.accounts).toBe(2);
    expect(composition.annual.fils).toBe(2 * (annualPro - 89_900));
    expect(composition.other).toEqual({ accounts: 0, fils: 0 });
    expect(composition.atListFils + composition.annual.fils + composition.other.fils).toBe(composition.ledgerFils);
  });

  it("names a price held from before a list-price change, signed", () => {
    // Pro was 249 when this account signed; the list says 299 now.
    const book = [...accounts("pro", 1, 24_900), ...accounts("pro", 1, 29_900)];
    const composition = mrrComposition(book, PLANS);
    expect(composition.other).toEqual({ accounts: 1, fils: 24_900 - 29_900 });
    expect(composition.atListFils + composition.annual.fils + composition.other.fils).toBe(composition.ledgerFils);
  });

  it("files an account on a plan the table no longer holds as other, whole", () => {
    const composition = mrrComposition([{ planId: "legacy", mrrFils: 5_000 }], PLANS);
    expect(composition.plans).toEqual([]);
    expect(composition.other).toEqual({ accounts: 1, fils: 5_000 });
    expect(composition.ledgerFils).toBe(5_000);
  });

  it("adds up to the ledger to the fil, whatever the book", () => {
    const book: CompositionAccount[] = [
      ...accounts("basic", 3, 9_900),
      ...accounts("basic", 2, 8_250),
      ...accounts("pro", 4, 29_900),
      ...accounts("pro", 1, 19_900),
      { planId: null, mrrFils: 1_234 },
      { planId: "pro", mrrFils: 0 },
    ];
    const composition = mrrComposition(book, PLANS);
    const ledger = book.reduce((sum, account) => sum + Math.max(0, account.mrrFils), 0);
    expect(composition.ledgerFils).toBe(ledger);
    expect(composition.atListFils + composition.annual.fils + composition.other.fils).toBe(ledger);
  });
});
