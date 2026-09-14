/**
 * When the scheduled jobs run, for a screen that has to say.
 *
 * `vercel.json` is the schedule and this is its reading: board 12d's empty call
 * list states when the list builds next, and a screen cannot read a deploy
 * config at request time. `tests/unit/job-schedule.test.ts` parses `vercel.json`
 * and fails if the two part.
 */

/** `/api/jobs/daily` at 20:23 UTC — 00:23 in Dubai. */
export const DAILY_JOB_UTC = { hour: 20, minute: 23 } as const;

/** The next run of the daily job strictly after `now`. */
export function nextDailyRun(now: Date): Date {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), DAILY_JOB_UTC.hour, DAILY_JOB_UTC.minute);
  return new Date(today > now.getTime() ? today : today + 86_400_000);
}
