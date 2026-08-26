import { can } from "@/lib/auth/can";
import type { Actor } from "@/lib/auth/roles";
import { capabilityForNavKey } from "@/components/structure/nav-config";
import type { ConsoleJob } from "./overview";

/**
 * Drop the metrics this reader may not open.
 *
 * Every metric links to the screen that fixes it, and the capability that gates
 * that screen is already declared once — in `ADMIN_NAV`. Reading it from there
 * rather than restating it here is what keeps the two from drifting: §07 puts
 * `revenue.read` with finance and gives ops lead a dash, so an ops lead's
 * overview showed a past-due count linking straight into a 404.
 *
 * A job whose metrics are all filtered away keeps its panel and loses its
 * numbers. The six jobs are what the platform has to do, not what the reader
 * has to do, and quietly dropping one would tell an ops lead the money looks
 * after itself.
 */
export function visibleTo(jobs: readonly ConsoleJob[], actor: Actor): ConsoleJob[] {
  return jobs.map((job) => ({
    ...job,
    metrics: job.metrics.filter((metric) => {
      const capability = capabilityForNavKey(metric.navKey);
      return !capability || can(actor, capability);
    }),
  }));
}
