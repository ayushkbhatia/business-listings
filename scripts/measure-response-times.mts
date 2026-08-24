/**
 * Run the response-time measurement by hand.
 *
 *   pnpm measure
 *
 * The same function the cron route calls. Useful after a seed, and useful for
 * seeing what the numbers actually are before trusting a schedule with them.
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"], quiet: true });

const { measureResponseTimes } = await import("../lib/metrics/job.js");

const result = await measureResponseTimes();
console.log(
  `measured ${result.businessesConsidered} businesses — ${result.updated} updated, ${result.cleared} cleared to unmeasured`,
);
process.exit(0);
