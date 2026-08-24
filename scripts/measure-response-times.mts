/**
 * Run the measurement jobs by hand.
 *
 *   pnpm measure
 *
 * The same functions the cron route calls, in the same order. Useful after a
 * seed, and useful for seeing what the numbers actually are before trusting a
 * schedule with them.
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"], quiet: true });

const { measureResponseTimes } = await import("../lib/metrics/job.js");
const { measureProfileStrength } = await import("../lib/metrics/strength-job.js");

const times = await measureResponseTimes();
console.log(
  `response time: ${times.businessesConsidered} businesses — ${times.updated} updated, ${times.cleared} cleared to unmeasured`,
);

const strength = await measureProfileStrength();
console.log(
  `profile strength: ${strength.businessesConsidered} businesses — ${strength.updated} updated`,
);
process.exit(0);
