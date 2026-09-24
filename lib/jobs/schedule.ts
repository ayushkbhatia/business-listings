/**
 * When the scheduled jobs run, for a screen that has to say.
 *
 * `vercel.json` is the schedule and this is its reading: board 12d's empty call
 * list states when the list builds next, and a screen cannot read a deploy
 * config at request time. `tests/unit/job-schedule.test.ts` parses `vercel.json`
 * and fails if the two part — for both crons, and for a third one added to the
 * file and not here.
 *
 * Standing item 9.5 made this the reading of *both* crons rather than one:
 * `/admin/jobs` says which runs are missing, and a run can only be missing
 * against a schedule. Both expressions fire once per fixed interval — every day
 * at one minute, every hour at one minute — so a run's place in the schedule
 * is plain arithmetic on an offset and an interval, and no cron parser is
 * needed or wanted.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** `/api/jobs/daily` at 20:23 UTC — 00:23 in Dubai. */
export const DAILY_JOB_UTC = { hour: 20, minute: 23 } as const;

/** `/api/jobs/sweep` at 42 minutes past every hour. */
export const SWEEP_JOB_MINUTE = 42;

/** The crons `vercel.json` registers, by the name of the route each one calls. */
export const JOB_CRONS = ["daily", "sweep"] as const;

export type JobCron = (typeof JOB_CRONS)[number];

export function isJobCron(value: string): value is JobCron {
  return (JOB_CRONS as readonly string[]).includes(value);
}

/**
 * How long after its slot a run may begin before the slot counts as missed.
 *
 * Not for imprecision: Vercel invokes a cron on this plan "within the minute
 * specified" (measured: the daily at 20:23:26 UTC, the sweep at :42:37). It is
 * for delivery, which Vercel calls best effort, and for a staff member reading
 * the screen in the minute a run is due. Half an hour says a run is missing
 * well before the next one is due, even on the hourly sweep. One value for both
 * crons, because `/admin/jobs` states it once.
 */
export const JOB_GRACE_MS = 30 * MINUTE;

export interface JobSchedule {
  cron: JobCron;
  path: `/api/jobs/${JobCron}`;
  /** The expression in `vercel.json`, character for character. */
  expression: string;
  /** Slot `k` begins at `offsetMs + k × intervalMs` after the epoch, in UTC. */
  intervalMs: number;
  offsetMs: number;
  /** `JOB_GRACE_MS`, carried on the schedule so the arithmetic reads one object. */
  graceMs: number;
}

export const JOB_SCHEDULES: Readonly<Record<JobCron, JobSchedule>> = {
  daily: {
    cron: "daily",
    path: "/api/jobs/daily",
    expression: `${DAILY_JOB_UTC.minute} ${DAILY_JOB_UTC.hour} * * *`,
    intervalMs: DAY,
    offsetMs: DAILY_JOB_UTC.hour * HOUR + DAILY_JOB_UTC.minute * MINUTE,
    graceMs: JOB_GRACE_MS,
  },
  sweep: {
    cron: "sweep",
    path: "/api/jobs/sweep",
    expression: `${SWEEP_JOB_MINUTE} * * * *`,
    intervalMs: HOUR,
    offsetMs: SWEEP_JOB_MINUTE * MINUTE,
    graceMs: JOB_GRACE_MS,
  },
};

/**
 * The index of the latest slot at or before `at`.
 *
 * A run belongs to the slot it started in, so a delivery a few seconds late and
 * a run somebody started by hand at noon both count for the slot before them —
 * the work that slot owed was done. Two runs in one slot are two runs, not a
 * miss, which is how Vercel's occasional duplicate delivery reads.
 */
export function slotIndex(schedule: JobSchedule, at: Date): number {
  return Math.floor((at.getTime() - schedule.offsetMs) / schedule.intervalMs);
}

/** When slot `index` begins. */
export function slotTime(schedule: JobSchedule, index: number): Date {
  return new Date(schedule.offsetMs + index * schedule.intervalMs);
}

/**
 * The newest slot a run should already have started for: the latest one whose
 * grace has run out by `now`. A slot after it is not late yet.
 */
export function dueSlotIndex(schedule: JobSchedule, now: Date): number {
  return slotIndex(schedule, new Date(now.getTime() - schedule.graceMs));
}

/** The first slot strictly after `now`. */
export function nextSlot(schedule: JobSchedule, now: Date): Date {
  return slotTime(schedule, slotIndex(schedule, now) + 1);
}

/** The next run of the daily job strictly after `now`. */
export function nextDailyRun(now: Date): Date {
  return nextSlot(JOB_SCHEDULES.daily, now);
}
