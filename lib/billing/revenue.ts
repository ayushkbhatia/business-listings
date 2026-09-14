import "server-only";
import { prisma } from "@/lib/db/client";
import { monthlyValueFils } from "./period";

/**
 * Board 4g — revenue, read.
 *
 * ## What counts as MRR here
 *
 * `active` and `past_due`. Not `trialing`, which has taken no money and would
 * make the number a forecast; not `cancelled`, which is still serving out a
 * paid period but has told us it is leaving — the cancellation shows up as
 * churn on the day it ends, which is the day the money stops.
 *
 * Stated because every SaaS defines this differently and a number nobody can
 * reproduce is worse than no number.
 *
 * ## What is deliberately absent
 *
 * No GMV, no take rate, no commission, no transaction volume. CLAUDE.md is
 * explicit that the platform is never party to a transaction, and quoted value
 * is self-reported by sellers — putting it beside MRR on a revenue screen would
 * read as money we handled. Quoted value belongs on the marketplace-health
 * screen, labelled self-reported, and it is there.
 */

const COUNTS_AS_MRR = ["active", "past_due"] as const;

export interface MrrNow {
  /** Monthly recurring revenue, in fils. */
  mrrFils: number;
  /** Twelve times the above. Named so nobody reads it as booked. */
  annualisedFils: number;
  payingAccounts: number;
  /** Average revenue per paying account, in fils. Zero when nobody pays. */
  arpaFils: number;
  byPlan: { planId: string; planName: string; accounts: number; mrrFils: number }[];
}

export async function mrrNow(): Promise<MrrNow> {
  /*
     Grouped by plan **and term**, because the two are worth different amounts.

     This used to be headcount × list monthly price, which was right while every
     subscription was monthly and silently wrong the moment one was not: an
     annual account pays ten months for twelve and is therefore worth ten
     twelfths of the list price a month. `monthlyValueFils` is the one function
     that knows, and `recordMovement` uses it too — `reconcile()` compares the
     live sum against the ledger, so the two deriving a monthly figure
     differently is exactly how that check starts reporting a difference nobody
     can explain.

     The rows still collapse to one per plan below. Board 4g's table is a plan
     mix; splitting it by payment schedule would answer a question nobody asked
     and double every row.
  */
  const rows = await prisma.subscription.groupBy({
    by: ["planId", "term"],
    where: { status: { in: [...COUNTS_AS_MRR] } },
    _count: { _all: true },
  });

  const plans = await prisma.plan.findMany({
    select: {
      id: true,
      name: true,
      monthlyPriceAed: true,
      annualMonthsCharged: true,
      sortOrder: true,
    },
    orderBy: { sortOrder: "asc" },
  });

  const byPlan = plans
    .map((plan) => {
      const caps = {
        monthlyPriceAed: Number(plan.monthlyPriceAed),
        annualMonthsCharged: plan.annualMonthsCharged,
      };
      const mine = rows.filter((candidate) => candidate.planId === plan.id);
      const accounts = mine.reduce((sum, row) => sum + row._count._all, 0);
      const mrrFils = mine.reduce(
        (sum, row) => sum + row._count._all * monthlyValueFils(caps, row.term),
        0,
      );
      return { planId: plan.id, planName: plan.name, accounts, mrrFils };
    })
    // A free plan is not revenue, and a row of zeros on a revenue screen is
    // noise. Plans nobody is on are dropped for the same reason.
    .filter((plan) => plan.mrrFils > 0);

  const mrrFils = byPlan.reduce((sum, plan) => sum + plan.mrrFils, 0);
  const payingAccounts = byPlan.reduce((sum, plan) => sum + plan.accounts, 0);

  return {
    mrrFils,
    annualisedFils: mrrFils * 12,
    payingAccounts,
    arpaFils: payingAccounts === 0 ? 0 : Math.round(mrrFils / payingAccounts),
    byPlan,
  };
}

/*
   The twelve-month `waterfall()` that stood here is gone, and with it the one
   place its ratios were computed. Its net revenue retention was closing over
   opening — new business included — which is a growth rate wearing a retention
   label, and exactly the defect board 4g's handoff corrected on the design
   (104% where the lines made 98.6%). Board 4g reads one Dubai month at a time
   through `./revenue-board.ts`, and every ratio has one formula, in
   `./revenue-period.ts`.
*/

export interface Reconciliation {
  ledgerFils: number;
  liveFils: number;
  agrees: boolean;
  /** Ledger minus live. Zero, or somebody moved a plan behind the ledger. */
  differenceFils: number;
}

/**
 * Does the ledger still describe the subscription table?
 *
 * A metric nobody can check is a metric nobody should believe, and this
 * codebase has found several that were fabricated. So the revenue screen shows
 * this, and it shows it whether or not it agrees: a silent reconciliation is
 * the same as no reconciliation.
 *
 * They can legitimately disagree by exactly one thing — a plan whose price was
 * edited after the movements were written. That is why the price is not
 * editable from the entitlements form.
 */
export async function reconcile(): Promise<Reconciliation> {
  const [ledger, live] = await Promise.all([
    prisma.mrrMovement.aggregate({ _sum: { deltaFils: true } }),
    mrrNow(),
  ]);
  const ledgerFils = ledger._sum.deltaFils ?? 0;
  return {
    ledgerFils,
    liveFils: live.mrrFils,
    agrees: ledgerFils === live.mrrFils,
    differenceFils: ledgerFils - live.mrrFils,
  };
}

export interface MonthPoint {
  /** First instant of the month, UTC. */
  month: Date;
  closingFils: number;
  netFils: number;
}

/** Closing MRR month by month, for the sparkline the overview shows. */
export async function mrrByMonth(months: number, now = new Date()): Promise<MonthPoint[]> {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months + 1, 1));
  const [before, rows] = await Promise.all([
    prisma.mrrMovement.aggregate({
      where: { occurredAt: { lt: start } },
      _sum: { deltaFils: true },
    }),
    prisma.mrrMovement.findMany({
      where: { occurredAt: { gte: start } },
      select: { occurredAt: true, deltaFils: true },
      orderBy: { occurredAt: "asc" },
    }),
  ]);

  let running = before._sum.deltaFils ?? 0;
  const points: MonthPoint[] = [];
  for (let index = 0; index < months; index += 1) {
    const month = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + index, 1));
    const next = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + index + 1, 1));
    const net = rows
      .filter((row) => row.occurredAt >= month && row.occurredAt < next)
      .reduce((sum, row) => sum + row.deltaFils, 0);
    running += net;
    points.push({ month, closingFils: running, netFils: net });
  }
  return points;
}
