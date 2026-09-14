import "server-only";
import { prisma } from "@/lib/db/client";
import { measureResponseTimesIn, type MeasurementResult } from "./measure-response-times";

/**
 * The response-time measurement job — the median, and since board 4f the
 * reply rate beside it.
 *
 * Reads `EnquiryRecipient.createdAt` and `firstReplyAt` — both stamped by the
 * services that do the work, never by a form — and writes
 * `Business.responseTimeMedianMs`, `replyRate` and `replySample`. Those columns are the only place the numbers
 * lives, no API path writes it, and no seller-facing form has a field for it.
 * Criterion 5 asks for exactly that, and the asking is the point: a claimed
 * reply time is worth nothing, which is why every other directory's is.
 *
 * Idempotent. Running it twice produces the same numbers, so it is safe to
 * retry, safe to run by hand, and safe to schedule more often than needed.
 *
 * The derivation itself is `measureResponseTimesIn`, which the seed also runs,
 * so a freshly seeded database already reads what this job would write.
 */

export type { MeasurementResult };

export async function measureResponseTimes(now: Date = new Date()): Promise<MeasurementResult> {
  return measureResponseTimesIn(prisma, now);
}
