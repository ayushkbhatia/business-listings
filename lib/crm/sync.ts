import "server-only";
import { prisma } from "@/lib/db/client";
import type { Prisma } from "@/lib/db/generated/client";
import { CHURN_RISK_BELOW } from "@/lib/accounts/health";
import { VERIFIED_TIER } from "@/lib/verification";
import { deriveSignals } from "./derive";
import { resumeFrom, type CrmSignalKey } from "./model";

/**
 * Board 12d — turning signals into tasks, and the only code that creates or
 * closes one.
 *
 * `tests/unit/crm-writers.test.ts` holds the tree to that: no other file calls
 * `crmTask.create`, `createMany` or `upsert`, and no other file sets `closedAt`
 * except the call logger, which closes on an outcome somebody heard. So a row
 * in the queue always has a signal behind it (B1), and a signal that clears
 * takes its row out by re-derivation rather than by a cleanup job (B2, B7).
 *
 * ## What a run does
 *
 *   - A business with a signal and an open task: the task takes the run's
 *     signal, value, facts and demand score. Its state, lock and call-back are
 *     people's work and are left alone. The one exception is a renewal: a
 *     churn-risk task whose renewal date moved is closed as `renewal_passed`
 *     and a new one opens, because a save call after the renewal is not a save.
 *   - A business with a signal and no open task: a task opens where the last
 *     conversation left it (`resumeFrom`) — or does not open at all, if the
 *     seller said no, the number was wrong or the business closed down inside
 *     the last ninety days.
 *   - An open task whose signal no longer derives: it closes as `won` when the
 *     thing the call was for happened, whoever made it happen, and as `cleared`
 *     with the reason otherwise. Never deleted: the week's numbers count these.
 */

const DAY_MS = 86_400_000;
/** A task won in the last fortnight does not reopen for the same business. */
const WON_QUIET_DAYS = 14;

export interface SyncResult {
  derived: number;
  created: number;
  updated: number;
  won: number;
  cleared: number;
  suppressed: number;
  runId: string;
}

type OpenTask = Prisma.CrmTaskGetPayload<{
  select: { id: true; businessId: true; signal: true; signalRef: true; signalFacts: true; state: true; lastOutcome: true };
}>;

export async function syncCrmTasks(now: Date = new Date(), triggeredById: string | null = null): Promise<SyncResult> {
  const startedAt = new Date();
  const signals = await deriveSignals(now);
  const bySignal = new Map(signals.map((signal) => [signal.businessId, signal]));

  const open = await prisma.crmTask.findMany({
    where: { closedAt: null },
    select: { id: true, businessId: true, signal: true, signalRef: true, signalFacts: true, state: true, lastOutcome: true },
  });
  const openBy = new Map(open.map((task) => [task.businessId, task]));

  let created = 0;
  let updated = 0;
  let won = 0;
  let cleared = 0;
  let suppressed = 0;

  // ── Close what no longer derives ─────────────────────────────────────────
  const renewalsPassed: OpenTask[] = [];
  const gone: OpenTask[] = [];
  const changed: OpenTask[] = [];
  for (const task of open) {
    const signal = bySignal.get(task.businessId);
    if (!signal) gone.push(task);
    else if (task.signal === "churn_risk" && signal.signal === "churn_risk" && signal.signalRef !== task.signalRef) {
      renewalsPassed.push(task);
    } else if (signal.signal !== task.signal) {
      changed.push(task);
    }
  }

  /*
     A task whose business now carries a different signal is asked the same
     question as one whose signal went: did the thing it was for happen? An
     unclaimed listing that was claimed and now sits at Free in a thin trade has
     been won, and carrying the task over to the new signal would lose the win
     and ring a seller who claimed yesterday. One that was not won carries over,
     with its lock and its call-back.
  */
  const verdicts = await closeVerdicts([...gone, ...changed], now);
  const closing = [...gone, ...changed.filter((task) => verdicts.get(task.id)!.won)];
  for (const task of closing) {
    const verdict = verdicts.get(task.id)!;
    await prisma.crmTask.update({
      where: { id: task.id },
      data: { state: verdict.won ? "won" : "cleared", closedAt: now, closeReason: verdict.reason, callBackAt: null },
    });
    openBy.delete(task.businessId);
    if (verdict.won) won += 1;
    else cleared += 1;
  }
  for (const task of renewalsPassed) {
    await prisma.crmTask.update({
      where: { id: task.id },
      data: { state: "cleared", closedAt: now, closeReason: "renewal_passed", callBackAt: null },
    });
    openBy.delete(task.businessId);
    cleared += 1;
  }

  // ── Open or refresh what derives ─────────────────────────────────────────
  const history = await lastConversations(
    signals.filter((signal) => !openBy.has(signal.businessId)).map((signal) => signal.businessId),
    now,
  );

  for (const signal of signals) {
    const task = openBy.get(signal.businessId);
    if (task) {
      await prisma.crmTask.update({
        where: { id: task.id },
        data: {
          signal: signal.signal,
          signalRef: signal.signalRef,
          signalValue: signal.signalValue,
          signalFacts: signal.facts as unknown as Prisma.InputJsonValue,
          demandScore: signal.demandScore,
          derivedAt: now,
        },
      });
      updated += 1;
      continue;
    }

    const past = history.get(signal.businessId);
    if (past?.recentlyWon) {
      suppressed += 1;
      continue;
    }
    const resume = resumeFrom(past?.lastCall ?? null, now);
    if (resume.kind === "suppress") {
      suppressed += 1;
      continue;
    }

    try {
      await prisma.crmTask.create({
        data: {
          businessId: signal.businessId,
          signal: signal.signal,
          signalRef: signal.signalRef,
          signalValue: signal.signalValue,
          signalFacts: signal.facts as unknown as Prisma.InputJsonValue,
          demandScore: signal.demandScore,
          derivedAt: now,
          ...(resume.kind === "state"
            ? {
                state: resume.state,
                callBackAt: resume.callBackAt,
                coolingUntil: resume.coolingUntil,
                lastTouchAt: resume.lastTouchAt,
                lastOutcome: resume.lastOutcome as never,
              }
            : {}),
        },
      });
      created += 1;
    } catch (error) {
      // A concurrent run opened this business's task first; the partial unique
      // index is what stopped the second, and the first is the one to keep.
      if ((error as { code?: string }).code !== "P2002") throw error;
    }
  }

  const run = await prisma.crmSyncRun.create({
    data: {
      startedAt,
      finishedAt: new Date(),
      derived: signals.length,
      created,
      updated,
      won,
      cleared,
      triggeredById,
    },
    select: { id: true },
  });

  return { derived: signals.length, created, updated, won, cleared, suppressed, runId: run.id };
}

/**
 * Why each task's signal stopped deriving, and whether that is the win.
 *
 * Read against the business as it is now, per signal:
 *
 *   - `held_page` and `unclaimed_demand` are won when the listing is verified
 *     or claimed — the point of the call, whoever made the call or none.
 *   - `cap_reached` is won when the account moved to a plan above the cap it hit.
 *   - `churn_risk` is won when the account still pays and replies above 4f's
 *     threshold; it is cleared when the subscription stopped paying.
 *   - Anything whose business was suspended, merged or closed is cleared.
 *   - Otherwise the demand went away — a held page published, a search started
 *     finding somebody — and the task is cleared as `signal_gone`.
 */
async function closeVerdicts(tasks: readonly OpenTask[], now: Date): Promise<Map<string, { won: boolean; reason: string }>> {
  if (tasks.length === 0) return new Map();
  const businesses = await prisma.business.findMany({
    where: { id: { in: tasks.map((task) => task.businessId) } },
    select: {
      id: true,
      claimStatus: true,
      planId: true,
      verificationTier: true,
      suspendedAt: true,
      mergedIntoId: true,
      closedAt: true,
      closureRequestedAt: true,
      replyRate: true,
      subscription: { select: { status: true, renewsAt: true, plan: { select: { monthlyPriceAed: true } } } },
    },
  });
  const byId = new Map(businesses.map((business) => [business.id, business]));
  const out = new Map<string, { won: boolean; reason: string }>();

  for (const task of tasks) {
    const business = byId.get(task.businessId);
    if (!business || business.suspendedAt || business.mergedIntoId || business.closedAt || business.closureRequestedAt) {
      out.set(task.id, { won: false, reason: "business_gone" });
      continue;
    }
    const facts = task.signalFacts as { claimed?: boolean; planId?: string | null };
    const paying =
      business.subscription !== null &&
      ["active", "past_due"].includes(business.subscription.status) &&
      Number(business.subscription.plan.monthlyPriceAed) > 0;
    if (task.signal === "churn_risk" && paying && business.subscription!.renewsAt.getTime() <= now.getTime()) {
      // The renewal went by with the account still under the threshold. A save
      // call after the renewal is not a save (States).
      out.set(task.id, { won: false, reason: "renewal_passed" });
      continue;
    }
    out.set(task.id, verdictFor(task.signal, business, paying, { claimed: facts.claimed ?? false, planId: facts.planId ?? null }));
  }
  return out;
}

function verdictFor(
  signal: CrmSignalKey,
  business: { claimStatus: string; planId: string | null; verificationTier: number; replyRate: number | null },
  paying: boolean,
  atDerivation: { claimed: boolean; planId: string | null },
): { won: boolean; reason: string } {
  switch (signal) {
    case "held_page":
      if (business.verificationTier >= VERIFIED_TIER) return { won: true, reason: "verified" };
      if (!atDerivation.claimed && business.claimStatus === "claimed") return { won: true, reason: "claimed" };
      return { won: false, reason: "signal_gone" };
    case "unclaimed_demand":
      return business.claimStatus === "claimed" ? { won: true, reason: "claimed" } : { won: false, reason: "signal_gone" };
    case "zero_result":
      return business.planId !== "free" && business.planId !== null ? { won: true, reason: "upgraded" } : { won: false, reason: "signal_gone" };
    case "cap_reached": {
      const rank = (plan: string | null) => (plan === "free" || plan === null ? 0 : plan === "basic" ? 1 : 2);
      return rank(business.planId) > rank(atDerivation.planId) ? { won: true, reason: "upgraded" } : { won: false, reason: "signal_gone" };
    }
    case "churn_risk":
      if (!paying) return { won: false, reason: "stopped_paying" };
      return business.replyRate !== null && business.replyRate >= CHURN_RISK_BELOW
        ? { won: true, reason: "recovered" }
        : { won: false, reason: "signal_gone" };
  }
}

/** The last call per business, and whether a task for it was won lately. */
async function lastConversations(
  businessIds: readonly string[],
  now: Date,
): Promise<Map<string, { lastCall: { kind: string; createdAt: Date; callBackAt: Date | null } | null; recentlyWon: boolean }>> {
  const out = new Map<string, { lastCall: { kind: string; createdAt: Date; callBackAt: Date | null } | null; recentlyWon: boolean }>();
  if (businessIds.length === 0) return out;

  const [calls, wins] = await Promise.all([
    prisma.callOutcome.findMany({
      where: { businessId: { in: [...businessIds] } },
      orderBy: [{ businessId: "asc" }, { createdAt: "desc" }, { id: "desc" }],
      distinct: ["businessId"],
      select: { businessId: true, kind: true, createdAt: true, callBackAt: true },
    }),
    prisma.crmTask.findMany({
      where: { businessId: { in: [...businessIds] }, state: "won", closedAt: { gte: new Date(now.getTime() - WON_QUIET_DAYS * DAY_MS) } },
      select: { businessId: true },
    }),
  ]);
  const won = new Set(wins.map((row) => row.businessId));
  for (const id of businessIds) out.set(id, { lastCall: null, recentlyWon: won.has(id) });
  for (const call of calls) out.set(call.businessId, { lastCall: call, recentlyWon: won.has(call.businessId) });
  return out;
}

export async function lastSyncRun() {
  return prisma.crmSyncRun.findFirst({
    orderBy: [{ finishedAt: "desc" }, { id: "desc" }],
    select: { id: true, startedAt: true, finishedAt: true, derived: true, created: true, won: true, cleared: true, triggeredById: true },
  });
}
