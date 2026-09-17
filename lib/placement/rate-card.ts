import "server-only";
import { prisma } from "@/lib/db/client";
import "@/lib/audit/prisma-writer";
import { staffMutation } from "@/lib/audit/staff-mutation";
import { assertCan } from "@/lib/auth/can";
import type { Actor } from "@/lib/auth/roles";
import {
  BAND_COUNT,
  DEFAULT_BASE_PRICE_AED,
  DEFAULT_STEP_BPS,
  MAX_BAND,
  MIN_BAND,
  generateCard,
} from "./bands";

/**
 * Editing the sponsored-placement rate card. Board `11e`.
 *
 * The owner's instruction on 17 September: *"want the site owner to have the
 * ability to move these prices as we learn what sells and at what price,
 * independent of code pushes."* So the ten rungs and the two numbers that
 * generate them are rows, and this is what writes them.
 *
 * ## Two ways to change a price, and they do not fight
 *
 * **The curve** — a base and a step — regenerates every rung that nobody has
 * tuned by hand. **A rung** — one band's price — is set directly and marked as
 * an override, so the next curve change leaves it alone. Without the mark,
 * moving the base would silently undo every individual price somebody had set,
 * which is the shape of surprise a pricing screen must not have.
 *
 * Audited under its own action. A placement repricing is not a plan entitlement
 * change and filing it as one would hide a change to paid visibility inside a
 * list of cap edits.
 */

export type RateCardResult =
  | { ok: true; bandsChanged: number }
  | { ok: false; error: "out_of_range" | "nothing_changed"; message: string };

/** The ceiling the migration's CHECK also holds. */
const MAX_PRICE = 100_000;
/** A step of more than doubling a band is a typo, not a policy. */
const MAX_STEP_BPS = 10_000;

export interface CurveInput {
  actor: Actor;
  basePriceAed: number;
  stepBps: number;
  reason: string;
}

/** Set the base and the step, and regenerate every rung nobody has tuned. */
export async function setCurve(input: CurveInput): Promise<RateCardResult> {
  assertCan(input.actor, "plan.entitlements.write");

  if (
    !Number.isInteger(input.basePriceAed) ||
    input.basePriceAed < 1 ||
    input.basePriceAed > MAX_PRICE
  ) {
    return {
      ok: false,
      error: "out_of_range",
      message: `The floor is a whole number of dirhams from 1 to ${MAX_PRICE}, ex-VAT.`,
    };
  }
  if (!Number.isInteger(input.stepBps) || input.stepBps < 0 || input.stepBps > MAX_STEP_BPS) {
    return {
      ok: false,
      error: "out_of_range",
      message: "The step is a percentage from 0 to 100. Zero is a flat rate for every band.",
    };
  }

  const [before, overrides] = await Promise.all([
    prisma.placementPricing.findUnique({ where: { id: "current" } }),
    prisma.placementBand.findMany({
      where: { override: true },
      select: { band: true, monthlyPriceAed: true },
    }),
  ]);

  if (
    before &&
    before.basePriceAed === input.basePriceAed &&
    before.stepBps === input.stepBps
  ) {
    return { ok: false, error: "nothing_changed", message: "Those are the numbers it already has." };
  }

  const held = new Set(overrides.map((row) => row.band));
  const generated = generateCard(input.basePriceAed, input.stepBps).filter(
    (rung) => !held.has(rung.band),
  );

  await prisma.$transaction(async (tx) =>
    staffMutation(
      {
        actor: input.actor,
        capability: "plan.entitlements.write",
        subject: "PlacementPricing:current",
        reason: input.reason,
        action: "placement_priced",
        tx,
      },
      async () => {
        await tx.placementPricing.upsert({
          where: { id: "current" },
          create: {
            id: "current",
            basePriceAed: input.basePriceAed,
            stepBps: input.stepBps,
          },
          update: { basePriceAed: input.basePriceAed, stepBps: input.stepBps },
        });

        for (const rung of generated) {
          await tx.placementBand.upsert({
            where: { band: rung.band },
            create: { band: rung.band, monthlyPriceAed: rung.monthlyPriceAed },
            update: { monthlyPriceAed: rung.monthlyPriceAed, override: false },
          });
        }

        return {
          result: generated.length,
          before: {
            basePriceAed: before?.basePriceAed ?? DEFAULT_BASE_PRICE_AED,
            stepBps: before?.stepBps ?? DEFAULT_STEP_BPS,
          },
          after: {
            basePriceAed: input.basePriceAed,
            stepBps: input.stepBps,
            /*
               Named on the row, because a curve change that left four rungs
               alone is a different decision from one that moved all ten, and
               the log should not need the reader to work out which.
            */
            regenerated: generated.length,
            heldByOverride: [...held].sort((a, b) => a - b),
          },
          blastRadius: { count: generated.length, unit: "bands" as const },
        };
      },
    ),
  );

  return { ok: true, bandsChanged: generated.length };
}

export interface BandPriceInput {
  actor: Actor;
  band: number;
  monthlyPriceAed: number;
  reason: string;
}

/** Set one rung by hand, and hold it against the next curve change. */
export async function setBandPrice(input: BandPriceInput): Promise<RateCardResult> {
  assertCan(input.actor, "plan.entitlements.write");

  if (!Number.isInteger(input.band) || input.band < MIN_BAND || input.band > MAX_BAND) {
    return {
      ok: false,
      error: "out_of_range",
      message: `There are ${BAND_COUNT} bands, numbered ${MIN_BAND} to ${MAX_BAND}.`,
    };
  }
  if (
    !Number.isInteger(input.monthlyPriceAed) ||
    input.monthlyPriceAed < 1 ||
    input.monthlyPriceAed > MAX_PRICE
  ) {
    return {
      ok: false,
      error: "out_of_range",
      message: `A band price is a whole number of dirhams from 1 to ${MAX_PRICE}, ex-VAT.`,
    };
  }

  const before = await prisma.placementBand.findUnique({ where: { band: input.band } });
  if (before && before.monthlyPriceAed === input.monthlyPriceAed && before.override) {
    return { ok: false, error: "nothing_changed", message: "That is the price it already has." };
  }

  await prisma.$transaction(async (tx) =>
    staffMutation(
      {
        actor: input.actor,
        capability: "plan.entitlements.write",
        subject: `PlacementBand:${input.band}`,
        reason: input.reason,
        action: "placement_priced",
        tx,
      },
      async () => {
        await tx.placementBand.upsert({
          where: { band: input.band },
          create: {
            band: input.band,
            monthlyPriceAed: input.monthlyPriceAed,
            override: true,
          },
          update: { monthlyPriceAed: input.monthlyPriceAed, override: true },
        });

        return {
          result: 1,
          before: { monthlyPriceAed: before?.monthlyPriceAed ?? null },
          after: { monthlyPriceAed: input.monthlyPriceAed, override: true },
          blastRadius: null,
        };
      },
    ),
  );

  return { ok: true, bandsChanged: 1 };
}

/** How many scopes sit in each band, so the screen can price against reality. */
export async function bandOccupancy(): Promise<Map<number, number>> {
  const rows = await prisma.scopeDemandBand.groupBy({ by: ["band"], _count: { _all: true } });
  return new Map(rows.map((row) => [row.band, row._count._all]));
}
