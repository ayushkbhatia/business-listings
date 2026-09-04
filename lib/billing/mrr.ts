import "server-only";
import type { Prisma, PrismaClient } from "@/lib/db/generated/client";
import { FILS_PER_AED } from "./proration";

/**
 * Writing an MRR movement.
 *
 * Board 4g wants a waterfall — new, expansion, contraction, churn — and there
 * is nowhere to read one from. `Subscription` holds the plan an account is on
 * now; the plan it left is gone the moment the row is updated. So every place
 * that changes what an account pays a month records the change as it makes it,
 * inside the same transaction, and the waterfall is a `GROUP BY` over events
 * rather than a reconstruction.
 *
 * Five callers, and that is the whole list:
 *
 *   1. `changePlan`               — a signup, an upgrade or a downgrade.
 *   2. `changeTerm`               — monthly to annual, or back.
 *   3. `applyEndedCancellations`  — a cancellation reaching its end date.
 *   4. `runDunning`               — the D14 drop to Free.
 *   5. the seed                   — backfill, so the screens have a history.
 *
 * A sixth would be a bug: anything else that moves a plan is moving it behind
 * the ledger's back, and the reconciliation test would catch it.
 *
 * `changeTerm` is the newest and the least obvious. The plan does not move, so
 * for a long time there was nothing to record — but an annual subscription pays
 * ten months for twelve and is therefore worth less a month than the same plan
 * paid monthly. Switching to it is a real contraction, and a waterfall that
 * omitted it would drift from the live sum by exactly the discount.
 *
 * **`runRenewals` is deliberately not on this list.** A renewal changes nothing
 * about what an account pays a month; `classify` returns null on the zero delta
 * and `mrr_movement_sign_matches_kind` would refuse the row anyway.
 */

export type MrrKind = "new_business" | "expansion" | "contraction" | "churn" | "reactivation";

/** A client or a transaction. Movements are written inside the caller's. */
type Db = PrismaClient | Prisma.TransactionClient;

export interface MovementInput {
  businessId: string;
  fromPlanId: string | null;
  toPlanId: string;
  /** Monthly price before, in fils. Zero for an account that paid nothing. */
  beforeFils: number;
  /** Monthly price after, in fils. */
  afterFils: number;
  occurredAt: Date;
  note?: string;
}

export function aedToFils(aed: number): number {
  return Math.round(aed * FILS_PER_AED);
}

/**
 * Which kind a change is.
 *
 * The only interesting call is new versus reactivation, and it needs history:
 * an account paying for the first time is new, and one that churned and came
 * back is a reactivation. Counting a returning seller as new inflates the
 * number the whole screen exists to tell the truth about.
 */
export function classify(
  beforeFils: number,
  afterFils: number,
  hasChurnedBefore: boolean,
): MrrKind | null {
  if (afterFils === beforeFils) return null;
  if (afterFils === 0) return "churn";
  if (beforeFils === 0) return hasChurnedBefore ? "reactivation" : "new_business";
  return afterFils > beforeFils ? "expansion" : "contraction";
}

/**
 * Record one movement, if there was one.
 *
 * Returns null when the price did not change — a seller moving between two
 * plans that cost the same is a plan change and not a revenue event, and a
 * zero-delta row would fail `mrr_movement_sign_matches_kind` anyway.
 */
export async function recordMovement(db: Db, input: MovementInput) {
  const hasChurnedBefore =
    input.beforeFils === 0 &&
    (await db.mrrMovement.count({ where: { businessId: input.businessId, kind: "churn" } })) > 0;

  const kind = classify(input.beforeFils, input.afterFils, hasChurnedBefore);
  if (!kind) return null;

  return db.mrrMovement.create({
    data: {
      businessId: input.businessId,
      kind,
      fromPlanId: input.fromPlanId,
      toPlanId: input.toPlanId,
      deltaFils: input.afterFils - input.beforeFils,
      mrrAfterFils: input.afterFils,
      occurredAt: input.occurredAt,
      note: input.note ?? null,
    },
  });
}
