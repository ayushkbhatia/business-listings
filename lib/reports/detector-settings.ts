import "server-only";
import { prisma } from "@/lib/db/client";
import "@/lib/audit/prisma-writer";
import { staffMutation } from "@/lib/audit/staff-mutation";
import { assertCan } from "@/lib/auth/can";
import type { Actor } from "@/lib/auth/roles";
import type { Prisma, PrismaClient } from "@/lib/db/generated/client";
import {
  DEFAULT_DETECTOR_RULES,
  DETECTOR_SETTING_KEY,
  detectorProblem,
  parseDetectorRules,
  type DetectorProblem,
  type DetectorRules,
} from "./detector-rules";

/**
 * Board 4h `B11` — reading and writing the detector thresholds.
 *
 * The write is audited with a written reason like every other staff state
 * change, and it is the whole of what `/admin/reports/detectors` can do. The
 * sweep itself never writes here; it only reads.
 */

type Db = PrismaClient | Prisma.TransactionClient;

export async function readDetectorRules(db: Db = prisma): Promise<DetectorRules> {
  const row = await db.platformSetting.findUnique({
    where: { key: DETECTOR_SETTING_KEY },
    select: { value: true },
  });
  return row ? parseDetectorRules(row.value) : DEFAULT_DETECTOR_RULES;
}

export type ApplyDetectorResult =
  | { ok: true; rules: DetectorRules }
  | { ok: false; problem: DetectorProblem };

export async function applyDetectorRules(input: {
  actor: Actor;
  rules: DetectorRules;
  reason: string;
}): Promise<ApplyDetectorResult> {
  assertCan(input.actor, "report.detectors");
  const problem = detectorProblem(input.rules);
  if (problem) return { ok: false, problem };

  await prisma.$transaction(async (tx) =>
    staffMutation(
      {
        actor: input.actor,
        capability: "report.detectors",
        /*
           No explicit action. `report.detectors` has one outcome, so
           `ACTION_FOR_CAPABILITY` names it — `report_detectors_tuned` — and
           naming it again here would be the second copy that eventually
           disagrees.
        */
        subject: `PlatformSetting:${DETECTOR_SETTING_KEY}`,
        reason: input.reason,
        tx,
      },
      async () => {
        const before = await readDetectorRules(tx);
        await tx.platformSetting.upsert({
          where: { key: DETECTOR_SETTING_KEY },
          create: {
            key: DETECTOR_SETTING_KEY,
            value: input.rules as unknown as Prisma.InputJsonValue,
            updatedById: input.actor.id,
          },
          update: {
            value: input.rules as unknown as Prisma.InputJsonValue,
            updatedById: input.actor.id,
          },
        });
        return { result: null, before, after: input.rules };
      },
    ),
  );

  return { ok: true, rules: input.rules };
}
