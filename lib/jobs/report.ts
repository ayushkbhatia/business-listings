import "server-only";
import { prisma } from "@/lib/db/client";
import {
  JOB_RUN_KEEP_DAYS,
  cronHealth,
  historyRows,
  needsAttention,
  standingRefusal,
  stepRows,
  type CronHealth,
  type HistoryRow,
  type Refusal,
  type RunDigest,
  type StepRow,
} from "./health";
import { JOB_CRONS, JOB_SCHEDULES, isJobCron, nextSlot, type JobCron, type JobSchedule } from "./schedule";

/**
 * Standing item 9.5 — the reads behind `/admin/jobs` and its sidebar count.
 *
 * Reports, not editors: nothing here writes, and there is nothing on the
 * screen to press. Every figure is a query over `job_run` and `job_run_step`,
 * or arithmetic on the schedule in `lib/jobs/schedule.ts` — a missed run is
 * counted from the slots with nobody in them, never kept as a number.
 */

const DAY_MS = 86_400_000;
export const HISTORY_PAGE_SIZE = 50;
/** How many refused calls the screen lists before it only counts them. */
export const REFUSALS_SHOWN = 10;

const RUN_SELECT = {
  id: true,
  cron: true,
  startedAt: true,
  finishedAt: true,
  ok: true,
  schedule: true,
  planned: true,
  steps: { select: { name: true, ok: true } },
} as const;

type RunRow = {
  id: string;
  cron: string;
  startedAt: Date;
  finishedAt: Date | null;
  ok: boolean | null;
  schedule: string | null;
  planned: string[];
  steps: { name: string; ok: boolean }[];
};

/** Every read here filters on `cron`, so the row's own column is the one asked for. */
function digest(row: RunRow, cron: JobCron): RunDigest {
  return { ...row, cron };
}

function latestRun(cron: JobCron) {
  return prisma.jobRun.findFirst({
    where: { cron, authorised: true },
    orderBy: [{ startedAt: "desc" }, { id: "desc" }],
    select: RUN_SELECT,
  });
}

function latestRefusal(cron: JobCron) {
  return prisma.jobRun.findFirst({
    where: { cron, authorised: false },
    orderBy: [{ startedAt: "desc" }, { id: "desc" }],
    select: { startedAt: true, refusal: true },
  });
}

/** The first row recorded for any cron — when the record went live, as far as it can say. */
function firstRecorded() {
  return prisma.jobRun.findFirst({
    orderBy: [{ startedAt: "asc" }, { id: "asc" }],
    select: { startedAt: true },
  });
}

function asRefusal(row: { startedAt: Date; refusal: string | null } | null): Refusal | null {
  if (!row || (row.refusal !== "no_secret" && row.refusal !== "wrong_secret")) return null;
  return { at: row.startedAt, refusal: row.refusal };
}

export interface CronSummary {
  schedule: JobSchedule;
  health: CronHealth;
  attention: boolean;
  next: Date;
  /** The latest refusal, when no run has happened since it. */
  refusal: Refusal | null;
}

export interface JobsOverview {
  crons: CronSummary[];
  /** The first row the record holds, or null when it holds none. */
  recordingSince: Date | null;
}

export async function jobsOverview(now: Date = new Date()): Promise<JobsOverview> {
  const [latest, refusals, first] = await Promise.all([
    Promise.all(JOB_CRONS.map(latestRun)),
    Promise.all(JOB_CRONS.map(latestRefusal)),
    firstRecorded(),
  ]);
  const recordingSince = first?.startedAt ?? null;

  return {
    recordingSince,
    crons: JOB_CRONS.map((cron, index) => {
      const schedule = JOB_SCHEDULES[cron];
      const row = latest[index] ?? null;
      const health = cronHealth({ schedule, last: row ? digest(row, cron) : null, recordingSince, now });
      return {
        schedule,
        health,
        attention: needsAttention(health),
        next: nextSlot(schedule, now),
        refusal: standingRefusal(health, asRefusal(refusals[index] ?? null)),
      };
    }),
  };
}

/**
 * The sidebar's count: crons with a missing run, or whose latest run failed a
 * step or never finished. Three indexed reads on every console page, which is
 * the cost of the one number that makes a stopped nightly visible on a screen
 * nobody opened to look for it.
 */
export async function jobsNeedingAttention(now: Date = new Date()): Promise<number> {
  const [latest, first] = await Promise.all([Promise.all(JOB_CRONS.map(latestRun)), firstRecorded()]);
  const recordingSince = first?.startedAt ?? null;
  return JOB_CRONS.filter((cron, index) => {
    const row = latest[index] ?? null;
    return needsAttention(
      cronHealth({ schedule: JOB_SCHEDULES[cron], last: row ? digest(row, cron) : null, recordingSince, now }),
    );
  }).length;
}

export function parseRunCursor(raw: string | null | undefined): { startedAt: Date; id: string } | null {
  if (!raw) return null;
  const [at, id] = raw.split("|");
  const startedAt = new Date(at ?? "");
  return id && !Number.isNaN(startedAt.getTime()) ? { startedAt, id } : null;
}

export interface RunHistory {
  rows: HistoryRow[];
  /** Authorised runs of this cron the record holds, for "50 of 2,160". */
  total: number;
  /** Runs on this page, for the same line. Missing rows are not runs. */
  shown: number;
  nextCursor: string | null;
}

/**
 * A cron's runs, newest first, fifty at a time on a keyset cursor, with the
 * gaps between them.
 *
 * Keyset rather than offset for the reason the delivery log gives: the sweep
 * adds a row an hour, and an offset page shifts under somebody reading it.
 */
export async function runHistory(
  cron: JobCron,
  cursorRaw: string | null,
  recordingSince: Date | null,
  now: Date = new Date(),
): Promise<RunHistory> {
  const cursor = parseRunCursor(cursorRaw);
  const where = { cron, authorised: true };

  const [rows, total] = await Promise.all([
    prisma.jobRun.findMany({
      where: cursor
        ? {
            ...where,
            OR: [
              { startedAt: { lt: cursor.startedAt } },
              { startedAt: cursor.startedAt, id: { lt: cursor.id } },
            ],
          }
        : where,
      orderBy: [{ startedAt: "desc" }, { id: "desc" }],
      take: HISTORY_PAGE_SIZE + 1,
      select: RUN_SELECT,
    }),
    prisma.jobRun.count({ where }),
  ]);

  const page = rows.slice(0, HISTORY_PAGE_SIZE).map((row) => digest(row, cron));
  const last = page.at(-1);
  const history = historyRows({ cron, runs: page, newerThanPage: cursor?.startedAt ?? null, recordingSince, now });

  return {
    rows: history,
    total,
    shown: page.length,
    nextCursor: rows.length > HISTORY_PAGE_SIZE && last ? `${last.startedAt.toISOString()}|${last.id}` : null,
  };
}

export interface StepFailure {
  name: string;
  failures: number;
  lastAt: Date;
  lastError: string | null;
  lastRunId: string;
}

/**
 * Each step of a cron that threw inside the kept window: how often, when last,
 * and what it said last time. The question it answers is whether a red run
 * on the history is new or has been happening all quarter.
 */
export async function stepFailures(cron: JobCron, now: Date = new Date()): Promise<StepFailure[]> {
  const since = new Date(now.getTime() - JOB_RUN_KEEP_DAYS * DAY_MS);
  const groups = await prisma.jobRunStep.groupBy({
    by: ["name"],
    where: { ok: false, run: { cron, startedAt: { gte: since } } },
    _count: { _all: true },
  });
  if (groups.length === 0) return [];

  const latest = await Promise.all(
    groups.map((group) =>
      prisma.jobRunStep.findFirst({
        where: { ok: false, name: group.name, run: { cron, startedAt: { gte: since } } },
        orderBy: [{ finishedAt: "desc" }, { runId: "desc" }],
        select: { finishedAt: true, error: true, runId: true },
      }),
    ),
  );

  return groups
    .flatMap((group, index) => {
      const last = latest[index];
      return last
        ? [{ name: group.name, failures: group._count._all, lastAt: last.finishedAt, lastError: last.error, lastRunId: last.runId }]
        : [];
    })
    .sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime() || a.name.localeCompare(b.name));
}

export interface RefusalLog {
  rows: Refusal[];
  total: number;
}

/** Calls to this cron that were turned away inside the kept window, newest first. */
export async function refusedCalls(cron: JobCron, now: Date = new Date()): Promise<RefusalLog> {
  const since = new Date(now.getTime() - JOB_RUN_KEEP_DAYS * DAY_MS);
  const where = { cron, authorised: false, startedAt: { gte: since } };
  const [rows, total] = await Promise.all([
    prisma.jobRun.findMany({
      where,
      orderBy: [{ startedAt: "desc" }, { id: "desc" }],
      take: REFUSALS_SHOWN,
      select: { startedAt: true, refusal: true },
    }),
    prisma.jobRun.count({ where }),
  ]);
  return { rows: rows.flatMap((row) => asRefusal(row) ?? []), total };
}

export interface RunDetail {
  run: RunDigest & { authorised: boolean; refusal: string | null };
  steps: StepRow[];
}

/** One run and every step it planned, recorded or not. */
export async function runDetail(id: string, now: Date = new Date()): Promise<RunDetail | null> {
  const row = await prisma.jobRun.findUnique({
    where: { id },
    select: {
      id: true,
      cron: true,
      startedAt: true,
      finishedAt: true,
      ok: true,
      schedule: true,
      planned: true,
      authorised: true,
      refusal: true,
      steps: {
        orderBy: [{ position: "asc" }, { name: "asc" }],
        select: {
          name: true,
          position: true,
          startedAt: true,
          finishedAt: true,
          ok: true,
          error: true,
          result: true,
        },
      },
    },
  });
  if (!row || !isJobCron(row.cron)) return null;

  const run = { ...row, cron: row.cron, steps: row.steps.map((step) => ({ name: step.name, ok: step.ok })) };
  return { run, steps: stepRows(run, row.steps, now) };
}
