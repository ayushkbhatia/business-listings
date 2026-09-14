import "server-only";
import { prisma } from "@/lib/db/client";
import "@/lib/audit/prisma-writer";
import { staffMutation } from "@/lib/audit/staff-mutation";
import { assertCan } from "@/lib/auth/can";
import type { Actor } from "@/lib/auth/roles";
import type { Prisma } from "@/lib/db/generated/client";
import { entriesFrom, loadPending, queueItemStates, readRules } from "./queue";
import { QUEUE_KINDS, RULES_SETTING_KEY, rulesProblem, type CheckRules, type QueueKind, type RulesProblem } from "./rules";

/**
 * Board 4b — `Tune auto-check rules →`, the lever that moves the 62%.
 *
 * *"Rule re-tuned: eligibility re-derived; the 62% figure and the bulk set both
 * move."* Because `allPassed` is computed and never stored (B2), there is
 * nothing to migrate when a rule moves: the preview runs the same checks against
 * the same pending rows under the proposed rules, and applying stores the rules
 * — the next read of the queue is the re-derivation.
 *
 * Q4 is left open on purpose. The preview says what a change does to the pass
 * rate and to the bulk set; it does not say whether a higher rate is better,
 * because a looser rule that raises it also lowers what the badge is worth.
 */

export interface PassFigures {
  total: number;
  passing: number;
  byKind: Record<QueueKind, { total: number; passing: number }>;
}

export interface RulesPreview {
  ok: true;
  current: CheckRules;
  proposed: CheckRules;
  now: PassFigures;
  after: PassFigures;
  /** Rows bulk approve could act on under the proposal and cannot now. */
  becomeEligible: number;
  /** Rows it can act on now and could not under the proposal. */
  becomeIneligible: number;
}

export type PreviewResult = RulesPreview | { ok: false; problem: RulesProblem };

function figures(entries: readonly { kind: QueueKind; allPassed: boolean }[]): PassFigures {
  const byKind = Object.fromEntries(QUEUE_KINDS.map((kind) => [kind, { total: 0, passing: 0 }])) as PassFigures["byKind"];
  let passing = 0;
  for (const entry of entries) {
    byKind[entry.kind].total += 1;
    if (entry.allPassed) {
      byKind[entry.kind].passing += 1;
      passing += 1;
    }
  }
  return { total: entries.length, passing, byKind };
}

export async function previewRules(input: { actor: Actor; rules: CheckRules }, now = new Date()): Promise<PreviewResult> {
  assertCan(input.actor, "queue.rules");
  const problem = rulesProblem(input.rules);
  if (problem) return { ok: false, problem };

  const [raws, current] = await Promise.all([loadPending(), readRules()]);
  const items = await queueItemStates(raws);
  const before = entriesFrom(raws, current, items, now);
  const after = entriesFrom(raws, input.rules, items, now);
  const eligibleNow = new Set(before.filter((entry) => entry.allPassed).map((entry) => entry.ref));
  const eligibleAfter = new Set(after.filter((entry) => entry.allPassed).map((entry) => entry.ref));

  return {
    ok: true,
    current,
    proposed: input.rules,
    now: figures(before),
    after: figures(after),
    becomeEligible: [...eligibleAfter].filter((ref) => !eligibleNow.has(ref)).length,
    becomeIneligible: [...eligibleNow].filter((ref) => !eligibleAfter.has(ref)).length,
  };
}

export type ApplyResult = { ok: true; rules: CheckRules } | { ok: false; problem: RulesProblem };

export async function applyRules(input: { actor: Actor; rules: CheckRules; reason: string }, now = new Date()): Promise<ApplyResult> {
  assertCan(input.actor, "queue.rules");
  const problem = rulesProblem(input.rules);
  if (problem) return { ok: false, problem };

  await prisma.$transaction(async (tx) =>
    staffMutation(
      {
        actor: input.actor,
        capability: "queue.rules",
        subject: `PlatformSetting:${RULES_SETTING_KEY}`,
        reason: input.reason,
        tx,
      },
      async () => {
        const current = await readRules(tx);
        await tx.platformSetting.upsert({
          where: { key: RULES_SETTING_KEY },
          create: { key: RULES_SETTING_KEY, value: input.rules as unknown as Prisma.InputJsonValue, updatedById: input.actor.id },
          update: { value: input.rules as unknown as Prisma.InputJsonValue, updatedById: input.actor.id },
        });
        return {
          result: null,
          before: current,
          after: { ...input.rules, at: now.toISOString() },
        };
      },
    ),
  );
  return { ok: true, rules: input.rules };
}
