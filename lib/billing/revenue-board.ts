import "server-only";
import { prisma } from "@/lib/db/client";
import type { Authority, CancelReason, Emirate } from "@/lib/db/generated/enums";
import { AUTHORITY_EMIRATE } from "@/lib/ingest/sources";
import { CHURN_RISK_BELOW } from "@/lib/accounts/health";
import { measureReplies, windowStart, type RateObservation } from "@/lib/metrics/response-time";
import { CANCEL_REASONS } from "./cancellation";
import type { MrrCause, MrrKind } from "./mrr";
import {
  causeOf,
  emptyLines,
  endingFils,
  lineOf,
  placementFils,
  previousPeriod,
  ratiosOf,
  type LedgerMonth,
  type Ratios,
  type ReplyFinding,
  type RevenuePeriod,
  type WaterfallLine,
} from "./revenue-period";

/**
 * Board 4g — one month of subscriptions and revenue, read from the ledger.
 *
 * Everything on the board is a query over `mrr_movement`, `subscription_change`,
 * `payment_attempt` and `placement_slot`, and nothing is stored as a metric. The
 * arithmetic lives in `./revenue-period.ts`; this file only fetches what it
 * needs and hands it over, so the formulas the cards print are the functions the
 * tests hold.
 *
 * ## An account's state at an instant
 *
 * `stateAt(T)` sums every movement before `T` per business and takes the plan
 * of the latest. It is the one read behind starting MRR, ending MRR, the paying
 * counts, revenue by emirate and the plan mix, which is what makes them add up
 * to one another: revenue by emirate sums to ending MRR because both are the
 * same rows grouped two ways, not two queries that happen to agree.
 */

// ── State at an instant ──────────────────────────────────────────────────────

interface AccountState {
  businessId: string;
  mrrFils: number;
  planId: string | null;
}

async function stateAt(instant: Date): Promise<AccountState[]> {
  const rows = await prisma.$queryRaw<{ business_id: string; mrr_fils: bigint; plan_id: string | null }[]>`
    SELECT m.business_id,
           SUM(m.delta_fils) AS mrr_fils,
           (ARRAY_AGG(m.to_plan_id ORDER BY m.occurred_at DESC, m.id DESC))[1] AS plan_id
    FROM mrr_movement m
    WHERE m.occurred_at < ${instant}
    GROUP BY m.business_id
    HAVING SUM(m.delta_fils) <> 0
  `;
  return rows.map((row) => ({ businessId: row.business_id, mrrFils: Number(row.mrr_fils), planId: row.plan_id }));
}

// ── One month ────────────────────────────────────────────────────────────────

export interface PeriodMovement {
  id: string;
  businessId: string;
  displayName: string;
  licenceEmirate: Emirate;
  kind: MrrKind;
  cause: MrrCause;
  line: WaterfallLine;
  fromPlanId: string | null;
  toPlanId: string | null;
  deltaFils: number;
  mrrAfterFils: number;
  occurredAt: Date;
  cancelReason: CancelReason | null;
  /** When the seller asked, for a movement that carried out a request. */
  requestedAt: Date | null;
}

export interface PeriodFigures {
  period: RevenuePeriod;
  month: LedgerMonth;
  endingFils: number;
  /**
   * The ledger summed to `to` directly, beside `endingFils`, which is starting
   * plus the lines. B1: the two are asserted equal by a test and not trusted —
   * a movement on no line, or on two, would part them.
   */
  ledgerEndingFils: number;
  ratios: Ratios;
  movements: PeriodMovement[];
  placement: { fils: number; slots: number };
  failedPayments: { accounts: number; atRiskFils: number };
  stateAtEnd: AccountState[];
}

export async function periodFigures(period: RevenuePeriod): Promise<PeriodFigures> {
  const [atStart, atEnd, rows, slots, failing] = await Promise.all([
    stateAt(period.from),
    stateAt(period.to),
    prisma.mrrMovement.findMany({
      where: { occurredAt: { gte: period.from, lt: period.to } },
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        businessId: true,
        kind: true,
        cause: true,
        fromPlanId: true,
        toPlanId: true,
        deltaFils: true,
        mrrAfterFils: true,
        occurredAt: true,
        note: true,
        business: { select: { displayName: true, licenceAuthority: true } },
        subscriptionChange: { select: { kind: true, cancelReason: true, createdAt: true } },
      },
    }),
    prisma.placementSlot.findMany({
      where: { startsOn: { lt: period.to }, OR: [{ endsOn: null }, { endsOn: { gt: period.from } }] },
      select: { monthlyPriceAed: true, startsOn: true, endsOn: true },
    }),
    failingAt(period.to),
  ]);

  const movements: PeriodMovement[] = rows.map((row) => {
    const facts = { kind: row.kind as MrrKind, cause: row.cause, fromPlanId: row.fromPlanId, toPlanId: row.toPlanId, note: row.note };
    const cancellation = row.subscriptionChange?.kind === "cancellation" ? row.subscriptionChange : null;
    return {
      id: row.id,
      businessId: row.businessId,
      displayName: row.business.displayName,
      licenceEmirate: AUTHORITY_EMIRATE[row.business.licenceAuthority as Authority],
      kind: facts.kind,
      cause: causeOf(facts),
      line: lineOf(facts),
      fromPlanId: row.fromPlanId,
      toPlanId: row.toPlanId,
      deltaFils: row.deltaFils,
      mrrAfterFils: row.mrrAfterFils,
      occurredAt: row.occurredAt,
      cancelReason: cancellation?.cancelReason ?? null,
      requestedAt: row.subscriptionChange?.createdAt ?? null,
    };
  });

  const lines = emptyLines();
  const cancelled = new Set<string>();
  const lapsed = new Set<string>();
  for (const movement of movements) {
    lines[movement.line] += movement.deltaFils;
    if (movement.line === "cancellations") cancelled.add(movement.businessId);
    if (movement.line === "lapsed") lapsed.add(movement.businessId);
  }

  const month: LedgerMonth = {
    startingFils: atStart.reduce((sum, row) => sum + row.mrrFils, 0),
    lines,
    payingAtStart: atStart.filter((row) => row.mrrFils > 0).length,
    payingAtEnd: atEnd.filter((row) => row.mrrFils > 0).length,
    cancelledAccounts: cancelled.size,
    lapsedAccounts: lapsed.size,
  };

  const paying = new Map(atEnd.map((row) => [row.businessId, row.mrrFils]));
  const atRisk = [...failing].filter((businessId) => (paying.get(businessId) ?? 0) > 0);

  return {
    period,
    month,
    endingFils: endingFils(month),
    ledgerEndingFils: atEnd.reduce((sum, row) => sum + row.mrrFils, 0),
    ratios: ratiosOf(month),
    movements,
    placement: {
      fils: slots.reduce((sum, slot) => sum + placementFils({ ...slot, monthlyPriceAed: Number(slot.monthlyPriceAed) }, period), 0),
      slots: slots.filter((slot) => placementFils({ ...slot, monthlyPriceAed: Number(slot.monthlyPriceAed) }, period) > 0).length,
    },
    failedPayments: {
      accounts: atRisk.length,
      atRiskFils: atRisk.reduce((sum, businessId) => sum + (paying.get(businessId) ?? 0), 0),
    },
    stateAtEnd: atEnd,
  };
}

/**
 * Businesses in dunning at an instant. B8.
 *
 * A subscription is failing at `T` when the last attempt to charge it before
 * `T` failed — which is a fact about the past that stays true, so a closed
 * month keeps reporting what was outstanding at its end after the card has
 * since gone through. A subscription past due now, with no attempt on record
 * before `T` to say otherwise, counts from `pastDueSince`: that is the
 * console-provider case, where nothing is charged and nothing is attempted.
 *
 * Counted as at risk, never as lost. The money stops, and the churn line moves,
 * only when the D14 drop writes its movement — the same rule `mrrNow` applies by
 * counting `past_due` as MRR.
 */
async function failingAt(instant: Date): Promise<Set<string>> {
  const [latest, pastDue] = await Promise.all([
    prisma.$queryRaw<{ business_id: string; succeeded: boolean }[]>`
      SELECT DISTINCT ON (a.subscription_id) s.business_id, a.succeeded
      FROM payment_attempt a
      JOIN subscription s ON s.id = a.subscription_id
      WHERE a.attempted_at < ${instant}
      ORDER BY a.subscription_id, a.attempted_at DESC, a.id DESC
    `,
    prisma.subscription.findMany({
      where: { status: "past_due", pastDueSince: { lt: instant } },
      select: { businessId: true },
    }),
  ]);

  const lastAttempt = new Map(latest.map((row) => [row.business_id, row.succeeded]));
  const failing = new Set(latest.filter((row) => !row.succeeded).map((row) => row.business_id));
  for (const row of pastDue) {
    if (lastAttempt.get(row.businessId) !== true) failing.add(row.businessId);
  }
  return failing;
}

// ── The board ────────────────────────────────────────────────────────────────

export interface ReasonRow {
  /** A `CancelReason`, or `not_recorded` for a cancellation from before 11h. */
  reason: CancelReason | "not_recorded";
  count: number;
}

export interface EmirateRow {
  emirate: Emirate;
  mrrFils: number;
  accounts: number;
}

export interface PlanRow {
  planId: string;
  planName: string;
  accounts: number;
  mrrFils: number;
}

export interface RevenueBoard {
  current: PeriodFigures;
  previous: PeriodFigures;
  /** Cancellations taking effect in the month. Equal to the sum of `reasons`. */
  cancellations: number;
  reasons: ReasonRow[];
  replyFinding: ReplyFinding;
  byEmirate: EmirateRow[];
  byPlan: PlanRow[];
  /** Accounts closed through board 11i in the month. Reported apart from churn — Q2. */
  closures: number;
}

const EMIRATE_ORDER: readonly Emirate[] = [
  "dubai",
  "abu_dhabi",
  "sharjah",
  "ajman",
  "umm_al_quwain",
  "ras_al_khaimah",
  "fujairah",
];

export async function revenueBoard(period: RevenuePeriod, now: Date = new Date()): Promise<RevenueBoard> {
  const [current, previous] = await Promise.all([periodFigures(period), periodFigures(previousPeriod(period, now))]);

  const cancellations = current.movements.filter((movement) => movement.line === "cancellations");

  /*
     B5: counted from the reason the seller gave in 11j, through the change the
     movement carried out. The six in the order 11j asks them, with the closing
     fork kept only where a row carries it — it cancels nothing since 11i, so it
     can only be a row from before that — and `not recorded` for cancellations
     nobody was asked about.
  */
  const counts = new Map<ReasonRow["reason"], number>();
  for (const movement of cancellations) {
    const key = movement.cancelReason ?? "not_recorded";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const reasons: ReasonRow[] = [...CANCEL_REASONS, "not_recorded" as const]
    .map((reason) => ({ reason, count: counts.get(reason) ?? 0 }))
    .filter((row) => row.count > 0 || (row.reason !== "business_closing" && row.reason !== "not_recorded"));

  const [replyFinding, plans, owners, closures] = await Promise.all([
    replyFindingFor(cancellations.filter((movement) => movement.cancelReason === "not_enough_enquiries")),
    prisma.plan.findMany({ select: { id: true, name: true, sortOrder: true }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }),
    prisma.business.findMany({
      where: { id: { in: current.stateAtEnd.filter((row) => row.mrrFils > 0).map((row) => row.businessId) } },
      select: { id: true, licenceAuthority: true },
    }),
    prisma.business.count({ where: { closedAt: { gte: period.from, lt: period.to } } }),
  ]);

  /*
     B9: the emirate on the trade licence. A firm covering seven emirates is
     revenue in the one that licensed it — which is also the head-office rule the
     VAT return uses, so the two finance screens split the country the same way.
  */
  const authority = new Map(owners.map((owner) => [owner.id, owner.licenceAuthority as Authority]));
  const emirates = new Map<Emirate, EmirateRow>(
    EMIRATE_ORDER.map((emirate) => [emirate, { emirate, mrrFils: 0, accounts: 0 }]),
  );
  const planTotals = new Map<string, { accounts: number; mrrFils: number }>();
  for (const row of current.stateAtEnd) {
    if (row.mrrFils <= 0) continue;
    const code = authority.get(row.businessId);
    if (code) {
      const entry = emirates.get(AUTHORITY_EMIRATE[code])!;
      entry.mrrFils += row.mrrFils;
      entry.accounts += 1;
    }
    const plan = planTotals.get(row.planId ?? "") ?? { accounts: 0, mrrFils: 0 };
    plan.accounts += 1;
    plan.mrrFils += row.mrrFils;
    planTotals.set(row.planId ?? "", plan);
  }

  return {
    current,
    previous,
    cancellations: cancellations.length,
    reasons,
    replyFinding,
    byEmirate: [...emirates.values()].sort(
      (a, b) => b.mrrFils - a.mrrFils || EMIRATE_ORDER.indexOf(a.emirate) - EMIRATE_ORDER.indexOf(b.emirate),
    ),
    byPlan: plans
      .filter((plan) => planTotals.has(plan.id))
      .map((plan) => ({ planId: plan.id, planName: plan.name, ...planTotals.get(plan.id)! })),
    closures,
  };
}

/**
 * B6 — did the sellers who said *not enough enquiries* have enquiries?
 *
 * Each is measured with `measureReplies`, the function behind `4f`'s reply rate
 * and the reply time buyers see, over the same 90-day window, against the same
 * 50% threshold — anchored at the moment they asked to cancel rather than today.
 * A seller who cancelled in August is judged on the enquiries they had when they
 * said it, and the August report still says the same thing in December.
 *
 * A seller with too few enquiries in that window to measure is counted as such,
 * never as a zero: that is the case where the reason may well be true.
 */
async function replyFindingFor(movements: readonly PeriodMovement[]): Promise<ReplyFinding> {
  const finding: ReplyFinding = { total: movements.length, below: 0, atOrAbove: 0, unmeasured: 0 };
  if (movements.length === 0) return finding;

  const anchors = movements.map((movement) => ({
    businessId: movement.businessId,
    // A cancellation carried out without a request row has no reason and never
    // reaches here; the fallback keeps the type honest.
    at: movement.requestedAt ?? movement.occurredAt,
  }));
  const earliest = new Date(Math.min(...anchors.map((anchor) => windowStart(anchor.at).getTime())));
  const latest = new Date(Math.max(...anchors.map((anchor) => anchor.at.getTime())));

  const recipients = await prisma.enquiryRecipient.findMany({
    where: {
      businessId: { in: [...new Set(anchors.map((anchor) => anchor.businessId))] },
      createdAt: { gte: earliest, lt: latest },
    },
    select: { businessId: true, createdAt: true, firstReplyAt: true, enquiry: { select: { closesAt: true } } },
  });

  for (const anchor of anchors) {
    const since = windowStart(anchor.at).getTime();
    const observations: RateObservation[] = recipients
      .filter(
        (row) =>
          row.businessId === anchor.businessId &&
          row.createdAt.getTime() >= since &&
          row.createdAt.getTime() < anchor.at.getTime(),
      )
      .map((row) => ({
        deliveredAt: row.createdAt,
        // A reply after they asked to leave was not a reply to the enquiries
        // they were judging the platform on.
        firstReplyAt: row.firstReplyAt && row.firstReplyAt.getTime() < anchor.at.getTime() ? row.firstReplyAt : null,
        closesAt: row.enquiry.closesAt,
      }));
    const { rate } = measureReplies(observations, anchor.at);
    if (rate === null) finding.unmeasured += 1;
    else if (rate < CHURN_RISK_BELOW) finding.below += 1;
    else finding.atOrAbove += 1;
  }

  return finding;
}
