import { monthlyValueFils, type TermPlan } from "./period";

/**
 * What MRR is made of — the owner's answer to D-MRR on board 4a, 1 Oct 2026.
 *
 * The export's flag: 1,284 Basic × 99 plus 762 Pro × 299 is 354,954, against
 * an MRR of 388,254, and nothing on either board said where 33,300 came from.
 * In this ledger the gap has causes that can be named, so this names them
 * rather than assuming list price × plan mix equals MRR:
 *
 *   - **At list price.** Every paying account at today's list price for its
 *     plan. This is what list price × plan mix computes.
 *   - **Annual terms.** An account paying the monthly value of an annual term —
 *     a year charged at `annualMonthsCharged` months — is worth less a month
 *     than its list price. The line is that difference, and it is negative.
 *   - **Other.** Anything else: an account whose ledger value is neither its
 *     plan's monthly list price nor its annual value, which is a price held
 *     from before a list-price change (board 12e edits prices, and no writer
 *     re-prices an existing subscription). Named with its count, never folded
 *     into the line above it.
 *
 * Each account adds its list price to the first line and its own difference to
 * one of the other two, so the three always sum to the ledger exactly — the
 * test asserts it to the fil, and asserts that a book of monthly accounts at
 * list price has nothing on the other two lines.
 *
 * Classified by value rather than by `Subscription.term`, which is today's term
 * and would mis-file a closed month whose account has since changed term. The
 * ledger's value for an account *is* the term it was on.
 *
 * Pure: the caller reads the ledger and the plan table.
 */

export interface CompositionAccount {
  /** The ledger's monthly value for the account, in fils. */
  mrrFils: number;
  planId: string | null;
}

export interface CompositionPlan extends TermPlan {
  id: string;
  name: string;
}

export interface CompositionPlanLine {
  planId: string;
  planName: string;
  accounts: number;
  /** The plan's monthly list price, in fils. */
  listPriceFils: number;
  /** `accounts × listPriceFils`. */
  atListFils: number;
}

export interface MrrComposition {
  plans: CompositionPlanLine[];
  /** List price × plan mix. */
  atListFils: number;
  /** Accounts on an annual term, and what that term takes off the list price. Never positive. */
  annual: { accounts: number; fils: number };
  /** Accounts at any other price, and the signed difference. */
  other: { accounts: number; fils: number };
  /** The ledger's MRR: `atListFils + annual.fils + other.fils`, exactly. */
  ledgerFils: number;
}

export function mrrComposition(
  accounts: readonly CompositionAccount[],
  plans: readonly CompositionPlan[],
): MrrComposition {
  const byId = new Map(plans.map((plan) => [plan.id, plan]));
  const lines = new Map<string, CompositionPlanLine>();
  const annual = { accounts: 0, fils: 0 };
  const other = { accounts: 0, fils: 0 };
  let atListFils = 0;
  let ledgerFils = 0;

  for (const account of accounts) {
    if (account.mrrFils <= 0) continue;
    ledgerFils += account.mrrFils;
    const plan = account.planId ? byId.get(account.planId) : undefined;
    if (!plan) {
      // A plan the table no longer holds has no list price to compare with.
      other.accounts += 1;
      other.fils += account.mrrFils;
      continue;
    }

    const list = monthlyValueFils(plan, "monthly");
    const line = lines.get(plan.id) ?? {
      planId: plan.id,
      planName: plan.name,
      accounts: 0,
      listPriceFils: list,
      atListFils: 0,
    };
    line.accounts += 1;
    line.atListFils += list;
    lines.set(plan.id, line);
    atListFils += list;

    if (account.mrrFils === list) continue;
    const annualValue = monthlyValueFils(plan, "annual");
    if (plan.annualMonthsCharged !== null && account.mrrFils === annualValue) {
      annual.accounts += 1;
      annual.fils += annualValue - list;
    } else {
      other.accounts += 1;
      other.fils += account.mrrFils - list;
    }
  }

  const order = new Map(plans.map((plan, index) => [plan.id, index]));
  return {
    plans: [...lines.values()].sort((a, b) => (order.get(a.planId) ?? 0) - (order.get(b.planId) ?? 0)),
    atListFils,
    annual,
    other,
    ledgerFils,
  };
}
