import "server-only";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/client";
import { Prisma } from "@/lib/db/generated/client";
import { boundResult, errorText, type JsonValue } from "./outcome";
import type { JobCron } from "./schedule";

/**
 * The one writer of `job_run` and `job_run_step` — standing item 9.5.
 *
 * Reached from `lib/jobs/authorize.ts` alone: `runSteps` opens a run, records
 * each step as it settles and closes the run, and `authorizeJob` records a
 * call it refused. `pruneJobRuns` is the daily run's own retention step. No job
 * writes here for itself; `tests/unit/job-runs.test.ts` holds the tree to that.
 *
 * **Nothing here throws.** The record exists to say what a run did, and a
 * write that failed must never be the thing that stopped the run or hid its
 * outcome from the response. Each write catches its own failure, says so in
 * the function log, and leaves what it could not write on the ledger for the
 * close to try once more — so a pooler that drops one connection mid-run costs
 * a retry at the end, not the record.
 *
 * **Not an audit row.** A cron has no actor: `AuditEvent.actorId` is NOT NULL
 * because that log holds decisions, and CLAUDE.md non-negotiable 2 says the
 * same of the licence-expiry sweep. These rows record that something ran.
 */

export interface StepRecord {
  name: string;
  position: number;
  startedAt: Date;
  finishedAt: Date;
  ok: boolean;
  /** The stored message — already masked and bounded by `errorText`. */
  error: string | null;
  result: JsonValue | null;
}

/** A run in flight, as the writer knows it. */
export interface RunLedger {
  readonly id: string;
  readonly cron: JobCron;
  readonly startedAt: Date;
  readonly planned: readonly string[];
  readonly schedule: string | null;
  /** The run's row reached the database. */
  opened: boolean;
  /** Steps whose row did not, kept for the close to write. */
  readonly unwritten: StepRecord[];
}

/** A step's outcome as `runSteps` holds it, made into what the row stores. */
export function stepRecord(input: {
  name: string;
  position: number;
  startedAt: Date;
  finishedAt: Date;
  outcome: { ok: true; result: unknown } | { ok: false; message: string };
}): StepRecord {
  const { outcome, ...rest } = input;
  // The same guard as the run's finish: a clock stepped back mid-step still
  // makes a row the database accepts.
  const timing = { ...rest, finishedAt: notBefore(rest.finishedAt, rest.startedAt) };
  return outcome.ok
    ? { ...timing, ok: true, error: null, result: boundResult(outcome.result) }
    : { ...timing, ok: false, error: errorText(outcome.message), result: null };
}

function stepData(runId: string, step: StepRecord) {
  return {
    runId,
    name: step.name,
    position: step.position,
    startedAt: step.startedAt,
    finishedAt: step.finishedAt,
    ok: step.ok,
    error: step.error,
    // SQL NULL rather than JSON null: "returned nothing" is the absence of a result.
    result: step.result === null ? Prisma.DbNull : (step.result as Prisma.InputJsonValue),
  };
}

function runData(ledger: RunLedger) {
  return {
    id: ledger.id,
    cron: ledger.cron,
    startedAt: ledger.startedAt,
    authorised: true,
    schedule: ledger.schedule,
    planned: [...ledger.planned],
  };
}

/**
 * The run's row, written before its first step.
 *
 * Written first so that a function stopped half way — Vercel ends one at its
 * duration limit without a word — still leaves a row that says it began and,
 * through the steps it did record, how far it got.
 */
export async function openRun(
  cron: JobCron,
  planned: readonly string[],
  schedule: string | null,
  startedAt: Date = new Date(),
): Promise<RunLedger> {
  const ledger: RunLedger = { id: randomUUID(), cron, startedAt, planned, schedule, opened: false, unwritten: [] };
  try {
    await prisma.jobRun.create({ data: runData(ledger) });
    ledger.opened = true;
  } catch (error) {
    console.error(`[jobs] ${cron}: the run's start could not be recorded; its steps will be written at the end`, error);
  }
  return ledger;
}

/** One step, as it settles. A step that threw is written exactly like one that did not. */
export async function recordStep(ledger: RunLedger, step: StepRecord): Promise<void> {
  if (!ledger.opened) {
    // No row to hang it from yet. The close writes the run and then this.
    ledger.unwritten.push(step);
    return;
  }
  try {
    await prisma.jobRunStep.create({ data: stepData(ledger.id, step) });
  } catch (error) {
    console.error(`[jobs] ${ledger.cron}: step ${step.name} could not be recorded; retrying at the end`, error);
    ledger.unwritten.push(step);
  }
}

/**
 * The steps that did not land, all at once, and one at a time if that fails.
 *
 * A write the client saw fail may still have committed, so each insert skips a
 * row that is already there. One at a time on the second pass, because one bad
 * row fails a whole `INSERT`, and a single step that cannot be written should
 * cost that step's row and no other.
 */
async function writeUnwritten(ledger: RunLedger): Promise<void> {
  const pending = ledger.unwritten.splice(0);
  if (pending.length === 0) return;
  try {
    await prisma.jobRunStep.createMany({ data: pending.map((step) => stepData(ledger.id, step)), skipDuplicates: true });
    return;
  } catch (error) {
    console.error(`[jobs] ${ledger.cron}: ${pending.length} step row(s) failed together; writing them one at a time`, error);
  }
  for (const step of pending) {
    try {
      await prisma.jobRunStep.createMany({ data: [stepData(ledger.id, step)], skipDuplicates: true });
    } catch (error) {
      console.error(`[jobs] ${ledger.cron}: step ${step.name} could not be recorded`, error);
      ledger.unwritten.push(step);
    }
  }
}

/**
 * The finish and the verdict, and one more try at anything unwritten.
 *
 * In that order: the run's row if the start never landed, then the steps that
 * did not, then the finish. Each is its own attempt — a step row that cannot be
 * written must not also cost the run its finish, or a run that ended would read
 * as one that stopped. Only a run row that still cannot be written ends it
 * here: with no row, there is nothing for a step or a finish to belong to.
 */
export async function closeRun(ledger: RunLedger, ok: boolean, finishedAt: Date = new Date()): Promise<void> {
  if (!ledger.opened) {
    try {
      // An upsert, because a start the client saw fail may have committed.
      await prisma.jobRun.upsert({ where: { id: ledger.id }, create: runData(ledger), update: {} });
      ledger.opened = true;
    } catch (error) {
      console.error(`[jobs] ${ledger.cron}: the run could not be recorded at all`, error);
      return;
    }
  }

  await writeUnwritten(ledger);

  try {
    await prisma.jobRun.update({
      where: { id: ledger.id },
      // A wall clock stepped back by NTP mid-run must not make the finish a row
      // the database refuses.
      data: { finishedAt: notBefore(finishedAt, ledger.startedAt), ok },
    });
  } catch (error) {
    console.error(`[jobs] ${ledger.cron}: the run's finish could not be recorded`, error);
  }
}

function notBefore(at: Date, floor: Date): Date {
  return at.getTime() < floor.getTime() ? floor : at;
}

export type RefusalKind = "no_secret" | "wrong_secret";

/** The start of the UTC hour `at` falls in — a refusal's dedupe key. */
export function refusalHour(at: Date): Date {
  const hour = new Date(at);
  hour.setUTCMinutes(0, 0, 0);
  return hour;
}

/**
 * A call `authorizeJob` turned away, at most once per cron per hour.
 *
 * `ON CONFLICT DO NOTHING` on `(cron, refused_hour)`: the second refusal in an
 * hour costs an index probe and writes nothing, so a caller hammering the
 * endpoint cannot make this table grow faster than twenty-four rows a day.
 */
export async function recordRefusal(
  cron: JobCron,
  refusal: RefusalKind,
  schedule: string | null,
  at: Date = new Date(),
): Promise<void> {
  try {
    await prisma.jobRun.createMany({
      data: [
        {
          id: randomUUID(),
          cron,
          startedAt: at,
          finishedAt: at,
          authorised: false,
          refusal,
          refusedHour: refusalHour(at),
          schedule,
          planned: [],
        },
      ],
      skipDuplicates: true,
    });
  } catch (error) {
    console.error(`[jobs] ${cron}: a refused call could not be recorded`, error);
  }
}

/**
 * The retention sweep: runs older than the window, and their steps with them
 * (`ON DELETE CASCADE`).
 *
 * Unlike the writes above, this one throws. It runs as a step of the daily
 * run, and a step that fails is recorded as failed — which is exactly how a
 * retention sweep that stopped working should be found.
 */
export async function pruneJobRuns(olderThan: Date): Promise<number> {
  const { count } = await prisma.jobRun.deleteMany({ where: { startedAt: { lt: olderThan } } });
  return count;
}
