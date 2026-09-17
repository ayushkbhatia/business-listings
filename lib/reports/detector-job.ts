import "server-only";
import { prisma } from "@/lib/db/client";
import { readDetectorRules } from "./detector-settings";
import { runReportDetectorsIn, type DetectorRun } from "./detectors";

/**
 * Board 4h — the nightly step, on the app's client and the stored thresholds.
 *
 * A thin wrapper, the same shape `lib/metrics/job.ts` has over
 * `measure-response-times.ts`: the derivation takes its client so the seed can
 * run the real thing rather than a copy of its output, and this is what reads
 * the settings and hands over the app's connection.
 */
export async function runReportDetectors(now = new Date()): Promise<DetectorRun> {
  return runReportDetectorsIn(prisma, await readDetectorRules(), now);
}

export type { DetectorRun } from "./detectors";
