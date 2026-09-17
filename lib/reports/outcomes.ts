import "server-only";
import { prisma } from "@/lib/db/client";
import type { Prisma, PrismaClient } from "@/lib/db/generated/client";

/**
 * Board 4h — the outcomes rail, and it is the argument for the whole screen.
 *
 * *"58% of reports end with the seller correcting the listing."* Most reports
 * are a fix rather than a punishment, and a moderation queue that cannot say so
 * about itself is one that reads as an enforcement desk to everybody who opens
 * it — including the moderators working it.
 *
 * Every figure here is a query over a window. None is a constant, and there is
 * nowhere to write one: the board's `58 · 26 · 16` are design fixtures.
 *
 * ## Four buckets, not three
 *
 * The drawn rail is a closed set — 58 + 26 + 16 = 100 — with nowhere for the
 * second and third of three reports about one telephone number to land. `B6`
 * gives them `duplicate`, and the rail counts it: a duplicate is not *no action
 * needed*, because action was taken, once, on the report it duplicates.
 *
 * ## Why a dispute's two outcomes are counted here at all
 *
 * The queue decides both shapes, so a rail that reported on one of them would
 * be describing part of the morning. An upheld dispute removes a review, which
 * is the same thing as *report upheld, content removed*; a refused one leaves
 * it standing, which is *no action needed*. The mapping is stated on the rail
 * rather than left for somebody to infer from a number that does not add up.
 */

type Db = PrismaClient | Prisma.TransactionClient;

export const OUTCOME_WINDOW_DAYS = 90;

export type OutcomeBucket = "seller_corrected" | "upheld" | "no_action" | "duplicate";

export const OUTCOME_BUCKETS = [
  "seller_corrected",
  "upheld",
  "no_action",
  "duplicate",
] as const satisfies readonly OutcomeBucket[];

export interface OutcomesView {
  /** Decisions inside the window. Zero means nothing was decided, not 0%. */
  decided: number;
  counts: Record<OutcomeBucket, number>;
  /** Share of `decided`, 0..1. Absent when nothing was decided. */
  shares: Record<OutcomeBucket, number> | null;
  /** The median time from filed to decided, in milliseconds. Null when none. */
  medianMs: number | null;
  /** How many of the decisions came from a review dispute rather than a report. */
  fromDisputes: number;
  windowDays: number;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : Math.round((sorted[middle - 1]! + sorted[middle]!) / 2);
}

export async function reportOutcomes(
  now = new Date(),
  db: Db = prisma,
  windowDays = OUTCOME_WINDOW_DAYS,
): Promise<OutcomesView> {
  const since = new Date(now.getTime() - windowDays * 86_400_000);

  const [reports, disputes] = await Promise.all([
    db.supplierReport.findMany({
      where: { outcome: { not: null }, resolvedAt: { gte: since } },
      select: { outcome: true, createdAt: true, resolvedAt: true },
    }),
    db.reviewDispute.findMany({
      where: { outcome: { not: null }, resolvedAt: { gte: since } },
      select: { outcome: true, createdAt: true, resolvedAt: true },
    }),
  ]);

  const counts: Record<OutcomeBucket, number> = {
    seller_corrected: 0,
    upheld: 0,
    no_action: 0,
    duplicate: 0,
  };
  const durations: number[] = [];

  for (const row of reports) {
    if (!row.outcome || !row.resolvedAt) continue;
    counts[row.outcome] += 1;
    durations.push(row.resolvedAt.getTime() - row.createdAt.getTime());
  }
  for (const row of disputes) {
    if (!row.outcome || !row.resolvedAt) continue;
    // Upheld removes the review; refused leaves it standing.
    counts[row.outcome === "upheld" ? "upheld" : "no_action"] += 1;
    durations.push(row.resolvedAt.getTime() - row.createdAt.getTime());
  }

  const decided = OUTCOME_BUCKETS.reduce((sum, bucket) => sum + counts[bucket], 0);

  return {
    decided,
    counts,
    shares:
      decided === 0
        ? null
        : (Object.fromEntries(
            OUTCOME_BUCKETS.map((bucket) => [bucket, counts[bucket] / decided]),
          ) as Record<OutcomeBucket, number>),
    medianMs: median(durations),
    fromDisputes: disputes.filter((row) => row.outcome && row.resolvedAt).length,
    windowDays,
  };
}
