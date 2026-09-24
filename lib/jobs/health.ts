import {
  JOB_SCHEDULES,
  dueSlotIndex,
  slotIndex,
  slotTime,
  type JobCron,
  type JobSchedule,
} from "./schedule";

/**
 * Standing item 9.5 — what the run record says about each cron, worked out
 * rather than stored.
 *
 * Pure: `lib/jobs/report.ts` reads the rows, this decides what they mean, and
 * the unit suite holds it to the cases that matter — a nightly missing since
 * Tuesday, a run that never reached its end, a cron that has never run at all.
 * Nothing here is a constant standing in for a count. A missed run is counted
 * from the schedule and the runs that did happen, and one that did not happen
 * is shown as missing, never as a run that did nothing.
 */

/** How long the record is kept. Pruned by the daily run's `prunedJobRuns` step. */
export const JOB_RUN_KEEP_DAYS = 90;

/**
 * Past this age a run with no finish is one that stopped, not one still going.
 *
 * Longer than any function Vercel will run: 800 seconds is the ceiling on this
 * plan, and a job route that has not answered in fifteen minutes has been
 * stopped by the platform or has lost its last write. Either way the screen
 * says the same true thing — *no finish recorded* — and does not guess which.
 */
export const RUN_CEILING_MS = 15 * 60_000;

/** A run as the screen reads it: its own row and the steps it recorded. */
export interface RunDigest {
  id: string;
  cron: JobCron;
  startedAt: Date;
  finishedAt: Date | null;
  ok: boolean | null;
  schedule: string | null;
  planned: readonly string[];
  steps: readonly { name: string; ok: boolean }[];
}

/**
 * - `running` — started inside the ceiling, not finished.
 * - `unfinished` — started beyond it and never finished.
 * - `failed` — finished, and at least one step threw.
 * - `ok` — finished, and every step returned.
 */
export type RunState = "ok" | "failed" | "running" | "unfinished";

export function runState(run: Pick<RunDigest, "startedAt" | "finishedAt" | "ok">, now: Date): RunState {
  if (run.finishedAt === null) {
    return now.getTime() - run.startedAt.getTime() >= RUN_CEILING_MS ? "unfinished" : "running";
  }
  return run.ok === false ? "failed" : "ok";
}

export interface RunTally {
  planned: number;
  ok: number;
  failed: number;
  /** Planned and with no step row: not reached, still going, or a lost write. */
  unrecorded: number;
}

export function runTally(run: Pick<RunDigest, "planned" | "steps">): RunTally {
  const recorded = new Map(run.steps.map((step) => [step.name, step.ok]));
  let ok = 0;
  let failed = 0;
  for (const outcome of recorded.values()) {
    if (outcome) ok += 1;
    else failed += 1;
  }
  const unrecorded = run.planned.filter((name) => !recorded.has(name)).length;
  return { planned: Math.max(run.planned.length, recorded.size), ok, failed, unrecorded };
}

/** The names of the steps that threw, in the run's own order. */
export function failedSteps(run: Pick<RunDigest, "planned" | "steps">): string[] {
  const failed = new Set(run.steps.filter((step) => !step.ok).map((step) => step.name));
  const inOrder = run.planned.filter((name) => failed.has(name));
  // A failed step outside `planned` cannot happen through `runSteps`, but a row
  // is a row: it is listed rather than dropped.
  return [...inOrder, ...[...failed].filter((name) => !run.planned.includes(name))];
}

/** Scheduled slots nobody ran, as one span. */
export interface MissedSpan {
  count: number;
  first: Date;
  last: Date;
}

/**
 * The slots strictly after `afterIndex` and strictly before `beforeIndex`.
 *
 * `afterIndex` is the slot the older run covered (or the slot recording began
 * in); `beforeIndex` is the newer run's slot, or one past the newest due slot
 * when the newer boundary is now.
 */
export function missedBetween(schedule: JobSchedule, afterIndex: number, beforeIndex: number): MissedSpan | null {
  const count = beforeIndex - afterIndex - 1;
  if (count <= 0) return null;
  return {
    count,
    first: slotTime(schedule, afterIndex + 1),
    last: slotTime(schedule, beforeIndex - 1),
  };
}

/** Scheduled slots missed since `since`, up to the newest one that is due by `now`. */
export function missedSince(schedule: JobSchedule, since: Date, now: Date): MissedSpan | null {
  return missedBetween(schedule, slotIndex(schedule, since), dueSlotIndex(schedule, now) + 1);
}

export interface Refusal {
  at: Date;
  refusal: "no_secret" | "wrong_secret";
}

/**
 * One cron, as its summary row says it.
 *
 * - `no_record` — nothing at all has been recorded, for any cron. The cold
 *   start, and the one state that cannot tell a dead scheduler from a fresh
 *   deployment, so it claims neither.
 * - `never` — this cron has no run, although the record was live from `since`
 *   (the first row any cron wrote). Its slots since then are missed.
 * - `ran` — the latest run, what became of it, and the slots missed since.
 */
export type CronHealth =
  | { state: "no_record" }
  | { state: "never"; since: Date; missed: MissedSpan | null }
  | { state: "ran"; last: RunDigest; lastState: RunState; tally: RunTally; missed: MissedSpan | null };

export function cronHealth(input: {
  schedule: JobSchedule;
  last: RunDigest | null;
  /** The first row recorded for any cron, refused calls included. */
  recordingSince: Date | null;
  now: Date;
}): CronHealth {
  const { schedule, last, recordingSince, now } = input;
  if (!last) {
    if (!recordingSince) return { state: "no_record" };
    return { state: "never", since: recordingSince, missed: missedSince(schedule, recordingSince, now) };
  }
  return {
    state: "ran",
    last,
    lastState: runState(last, now),
    tally: runTally(last),
    missed: missedSince(schedule, last.startedAt, now),
  };
}

/**
 * Whether a cron wants somebody to look at it: a scheduled run is missing, or
 * the latest one failed a step or never finished.
 *
 * The count on the console's sidebar is this, summed. A cold start is not
 * counted — nothing can be missing from a record that has not begun — and a run
 * still going is not either, until it outlives the ceiling.
 */
export function needsAttention(health: CronHealth): boolean {
  switch (health.state) {
    case "no_record":
      return false;
    case "never":
      return health.missed !== null;
    case "ran":
      return health.missed !== null || health.lastState === "failed" || health.lastState === "unfinished";
  }
}

/**
 * The refusal worth putting beside a cron: the latest one, when nothing has run
 * since. A refusal older than the latest run has been answered by that run.
 */
export function standingRefusal(health: CronHealth, refusal: Refusal | null): Refusal | null {
  if (!refusal) return null;
  if (health.state === "ran" && health.last.startedAt >= refusal.at) return null;
  return refusal;
}

export type HistoryRow =
  | { kind: "run"; run: RunDigest; state: RunState; tally: RunTally; failed: string[] }
  | { kind: "missed"; span: MissedSpan };

/**
 * One page of a cron's history, newest first, with each gap the schedule
 * shows between two runs written in as a row of its own.
 *
 * `runs` is a page in `startedAt` order, newest first. `newerThanPage` is the
 * run just above this page — the cursor — or null on the first page, where the
 * boundary above the newest run is now. Each run carries the gap *above* it, so
 * a gap at a page break is drawn once, at the top of the page below it; the gap
 * beneath the oldest run in the record is never drawn, because nothing before
 * the record began can be missing from it.
 *
 * A cron with no run at all still has a history: every slot since the record
 * went live (`recordingSince`, the first row any cron wrote), missing.
 */
export function historyRows(input: {
  cron: JobCron;
  runs: readonly RunDigest[];
  newerThanPage: Date | null;
  recordingSince: Date | null;
  now: Date;
}): HistoryRow[] {
  const schedule = JOB_SCHEDULES[input.cron];
  const rows: HistoryRow[] = [];

  if (input.runs.length === 0) {
    const span =
      input.newerThanPage === null && input.recordingSince !== null
        ? missedSince(schedule, input.recordingSince, input.now)
        : null;
    return span ? [{ kind: "missed", span }] : [];
  }

  let boundary =
    input.newerThanPage === null
      ? dueSlotIndex(schedule, input.now) + 1
      : slotIndex(schedule, input.newerThanPage);

  for (const run of input.runs) {
    const covered = slotIndex(schedule, run.startedAt);
    const span = missedBetween(schedule, covered, boundary);
    if (span) rows.push({ kind: "missed", span });
    rows.push({
      kind: "run",
      run,
      state: runState(run, input.now),
      tally: runTally(run),
      failed: failedSteps(run),
    });
    // Two runs in one slot leave the boundary where it is.
    boundary = Math.min(boundary, covered);
  }
  return rows;
}

/** One step row on a run's own page. */
export type StepState = "ok" | "failed" | "in_progress" | "no_finish" | "not_reached" | "not_recorded";

export interface RecordedStep {
  name: string;
  position: number;
  startedAt: Date;
  finishedAt: Date;
  ok: boolean;
  error: string | null;
  result: unknown;
}

export interface StepRow {
  position: number;
  name: string;
  state: StepState;
  step: RecordedStep | null;
}

/**
 * Every step the run planned, in its order, whether or not it left a row.
 *
 * Unfilled data stays visible. A step with no row is drawn, and says which of
 * three things it is: the step a run that is still going is on (the first gap,
 * `in_progress`); the step a run that stopped was on when it stopped (the first
 * gap, `no_finish` — the step before it wrote its row, so this one had begun);
 * and every step after that, `not_reached`. On a run that finished, a step with
 * no row is a write that was lost, and is called that.
 */
export function stepRows(
  run: Pick<RunDigest, "planned" | "startedAt" | "finishedAt" | "ok">,
  recorded: readonly RecordedStep[],
  now: Date,
): StepRow[] {
  const byName = new Map(recorded.map((step) => [step.name, step]));
  const state = runState(run, now);
  let gapSeen = false;

  const rows: StepRow[] = run.planned.map((name, position) => {
    const step = byName.get(name) ?? null;
    if (step) return { position, name, state: step.ok ? "ok" : "failed", step };
    if (state === "ok" || state === "failed") return { position, name, state: "not_recorded", step: null };
    const first = !gapSeen;
    gapSeen = true;
    if (!first) return { position, name, state: "not_reached", step: null };
    return { position, name, state: state === "running" ? "in_progress" : "no_finish", step: null };
  });

  // A recorded step the plan does not name is still a record.
  const planned = new Set(run.planned);
  for (const step of recorded) {
    if (!planned.has(step.name)) {
      rows.push({ position: step.position, name: step.name, state: step.ok ? "ok" : "failed", step });
    }
  }
  return rows;
}
