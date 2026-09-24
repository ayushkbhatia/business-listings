import {
  CronTable,
  RefusalTable,
  RunFacts,
  RunHistoryTable,
  StepFailureTable,
  StepTable,
} from "@/app/(admin)/admin/jobs/JobsView";
import {
  cronHealth,
  historyRows,
  needsAttention,
  runState,
  runTally,
  standingRefusal,
  stepRows,
  type RecordedStep,
  type Refusal,
  type RunDigest,
} from "@/lib/jobs/health";
import { boundResult } from "@/lib/jobs/outcome";
import type { CronSummary } from "@/lib/jobs/report";
import { JOB_SCHEDULES, nextSlot, type JobCron } from "@/lib/jobs/schedule";
import { Section, States } from "../_kit";

/**
 * Standing item 9.5 — `/admin/jobs` in the states it exists to show: both crons
 * on schedule; the nightly missing since Tuesday while the sweep keeps failing
 * one step; a cron that has never run because every call is refused; and the
 * cold start, where nothing is recorded and nothing is claimed.
 *
 * Every specimen goes through the functions the page uses — `cronHealth`,
 * `historyRows`, `stepRows`, `boundResult` — so a state that reads wrong here
 * reads wrong on the console. Read on Thursday 24 September at 10:00 Dubai.
 */

const NOW = new Date("2026-09-24T06:00:00Z");
const MIN = 60_000;

const DAILY_PLAN = ["expiredTrials", "renewals", "dunning", "invoicePdfs", "prunedJobRuns", "expiredLicences", "setupNudges"];
const SWEEP_PLAN = ["escalations", "followUps", "deferredNotifications", "releasedNotifications", "alerts"];

function run(cron: JobCron, startedAt: string, options: { failed?: string[]; unfinishedAfter?: number; hand?: boolean } = {}): RunDigest {
  const start = new Date(startedAt);
  const planned = cron === "daily" ? DAILY_PLAN : SWEEP_PLAN;
  const failed = new Set(options.failed ?? []);
  const reached = options.unfinishedAfter === undefined ? planned : planned.slice(0, options.unfinishedAfter);
  const finished = options.unfinishedAfter === undefined;
  return {
    id: `${cron}-${startedAt}`,
    cron,
    startedAt: start,
    finishedAt: finished ? new Date(start.getTime() + (cron === "daily" ? 5_310 : 1_240)) : null,
    ok: finished ? failed.size === 0 : null,
    schedule: options.hand ? null : JOB_SCHEDULES[cron].expression,
    planned,
    steps: reached.map((name) => ({ name, ok: !failed.has(name) })),
  };
}

function summary(cron: JobCron, last: RunDigest | null, recordingSince: Date | null, refusal: Refusal | null = null): CronSummary {
  const schedule = JOB_SCHEDULES[cron];
  const health = cronHealth({ schedule, last, recordingSince, now: NOW });
  return {
    schedule,
    health,
    attention: needsAttention(health),
    next: nextSlot(schedule, NOW),
    refusal: standingRefusal(health, refusal),
  };
}

const SINCE = new Date("2026-09-01T10:42:05Z");

const TYPICAL = [
  summary("daily", run("daily", "2026-09-23T20:23:26Z"), SINCE),
  summary("sweep", run("sweep", "2026-09-24T05:42:37Z"), SINCE),
];

// The nightly's last run was Tuesday's, and the sweep keeps throwing in one step.
const LATE = [
  summary("daily", run("daily", "2026-09-21T20:23:26Z"), SINCE),
  summary("sweep", run("sweep", "2026-09-24T05:42:37Z", { failed: ["releasedNotifications"] }), SINCE),
];

// Deployed without CRON_SECRET: the scheduler fires, and every call is refused.
const REFUSED = [
  summary("daily", null, new Date("2026-09-22T09:42:01Z"), { at: new Date("2026-09-23T20:23:01Z"), refusal: "no_secret" }),
  summary("sweep", null, new Date("2026-09-22T09:42:01Z"), { at: new Date("2026-09-24T05:42:02Z"), refusal: "no_secret" }),
];

// A run that stopped half way, and one still going.
const STOPPED = [
  summary("daily", run("daily", "2026-09-23T20:23:26Z", { unfinishedAfter: 3 }), SINCE),
  summary("sweep", run("sweep", new Date(NOW.getTime() - 2 * MIN).toISOString(), { unfinishedAfter: 2 }), SINCE),
];

const COLD = [summary("daily", null, null), summary("sweep", null, null)];

const DAILY_HISTORY = [
  run("daily", "2026-09-23T20:23:26Z"),
  run("daily", "2026-09-21T20:23:21Z", { failed: ["invoicePdfs"] }),
  run("daily", "2026-09-21T08:15:00Z", { hand: true }),
  run("daily", "2026-09-19T20:23:24Z", { unfinishedAfter: 4 }),
  run("daily", "2026-09-18T20:23:25Z"),
];

function history(cron: JobCron, runs: RunDigest[]) {
  return {
    rows: historyRows({ cron, runs, newerThanPage: null, recordingSince: SINCE, now: NOW }),
    total: runs.length,
    shown: runs.length,
  };
}

const FAILURES = [
  {
    name: "invoicePdfs",
    failures: 3,
    lastAt: new Date("2026-09-21T20:23:24Z"),
    lastError: "Storage upload failed for invoices/2026/INV-000184.pdf: The resource was not found",
    lastRunId: "daily-2026-09-21T20:23:21Z",
  },
  {
    name: "renewals",
    failures: 1,
    lastAt: new Date("2026-09-12T20:23:27Z"),
    lastError: "Invalid `prisma.subscription.update()` invocation: Transaction already closed: A query cannot be executed on an expired transaction.",
    lastRunId: "daily-2026-09-12T20:23:26Z",
  },
];

const REFUSALS = {
  rows: [
    { at: new Date("2026-09-24T05:42:02Z"), refusal: "no_secret" as const },
    { at: new Date("2026-09-24T04:42:01Z"), refusal: "no_secret" as const },
    { at: new Date("2026-09-17T20:23:02Z"), refusal: "wrong_secret" as const },
  ],
  total: 38,
};

const START = new Date("2026-09-23T20:23:26Z");
const step = (name: string, position: number, ms: number, outcome: { result?: unknown; error?: string }): RecordedStep => ({
  name,
  position,
  startedAt: new Date(START.getTime() + position * 400),
  finishedAt: new Date(START.getTime() + position * 400 + ms),
  ok: outcome.error === undefined,
  error: outcome.error ?? null,
  result: outcome.error === undefined ? boundResult(outcome.result) : null,
});

const LAPSED = Array.from({ length: 212 }, (_, index) => ({ slug: `al-quoz-trading-${index}`, from: 2, expiredOn: "2026-09-23" }));

const RECORDED = [
  step("expiredTrials", 0, 38, { result: { ended: 0, hidden: 0 } }),
  step("renewals", 1, 131, { result: { considered: 6, renewed: 0, failed: 0, skippedNoProvider: 5, ranAt: new Date("2026-09-23T20:23:28.703Z") } }),
  step("dunning", 2, 12, { error: "Invalid `prisma.subscription.findMany()` invocation: Can't reach database server at `aws-0-ap-south-1.pooler.supabase.com:5432`" }),
  step("invoicePdfs", 3, 2_460, { result: { considered: 0, written: 0, failed: 0, outstanding: 0, reasons: [], capped: false } }),
  step("prunedJobRuns", 4, 9, { result: { pruned: 223, olderThan: new Date("2026-06-25T20:23:29.042Z") } }),
  step("expiredLicences", 5, 340, { result: { expired: 212, dropped: LAPSED } }),
  step("setupNudges", 6, 1_180, { result: { considered: 4, nudged: 1, alreadyNudged: 3, failed: 0 } }),
];

const FAILED_RUN = { planned: DAILY_PLAN, startedAt: START, finishedAt: new Date(START.getTime() + 5_310), ok: false };
const STOPPED_RUN = { planned: DAILY_PLAN, startedAt: START, finishedAt: null, ok: null };
const LOST_WRITE_RUN = { planned: DAILY_PLAN, startedAt: START, finishedAt: new Date(START.getTime() + 5_310), ok: true };

function facts(runLike: typeof FAILED_RUN | typeof STOPPED_RUN, steps: RecordedStep[]) {
  const digest: RunDigest = {
    id: "gallery",
    cron: "daily",
    schedule: "23 20 * * *",
    ...runLike,
    steps: steps.map((recordedStep) => ({ name: recordedStep.name, ok: recordedStep.ok })),
  };
  return <RunFacts run={digest} state={runState(digest, NOW)} tally={runTally(digest)} />;
}

export function ScheduledJobsGallery() {
  return (
    <Section
      id="scheduled-jobs"
      title="Scheduled jobs"
      note="Standing item 9.5. When each cron last ran, what the run did, and every scheduled run that did not happen, as a row of its own rather than as a zero."
    >
      <States label="on schedule" stack>
        <CronTable crons={TYPICAL} now={NOW} />
      </States>
      <States label="late + failing" stack>
        <CronTable crons={LATE} now={NOW} />
      </States>
      <States label="refused" stack>
        <CronTable crons={REFUSED} now={NOW} />
      </States>
      <States label="stopped + running" stack>
        <CronTable crons={STOPPED} now={NOW} />
      </States>
      <States label="cold start" stack>
        <CronTable crons={COLD} now={NOW} />
      </States>

      <States label="runs, with gaps" stack>
        <RunHistoryTable
          cron="daily"
          history={history("daily", DAILY_HISTORY)}
          next={nextSlot(JOB_SCHEDULES.daily, NOW)}
          newestHref={null}
          olderHref="/admin/jobs?cron=daily#runs"
        />
      </States>
      <States label="runs, never ran" stack>
        <RunHistoryTable
          cron="sweep"
          history={{
            rows: historyRows({ cron: "sweep", runs: [], newerThanPage: null, recordingSince: new Date("2026-09-24T02:10:00Z"), now: NOW }),
            total: 0,
            shown: 0,
          }}
          next={nextSlot(JOB_SCHEDULES.sweep, NOW)}
          newestHref={null}
          olderHref={null}
        />
      </States>
      <States label="runs, empty" stack>
        <RunHistoryTable
          cron="sweep"
          history={{ rows: [], total: 0, shown: 0 }}
          next={nextSlot(JOB_SCHEDULES.sweep, NOW)}
          newestHref={null}
          olderHref={null}
        />
      </States>

      <States label="steps that threw" stack>
        <StepFailureTable cron="daily" failures={FAILURES} />
      </States>
      <States label="none threw" stack>
        <StepFailureTable cron="sweep" failures={[]} />
      </States>

      <States label="refused calls" stack>
        <RefusalTable cron="sweep" refusals={REFUSALS} />
      </States>
      <States label="none refused" stack>
        <RefusalTable cron="daily" refusals={{ rows: [], total: 0 }} />
      </States>

      <States label="run, failed step" stack>
        <div className="w-full rounded-panel border border-line bg-card px-4 py-2">{facts(FAILED_RUN, RECORDED)}</div>
        <StepTable steps={stepRows(FAILED_RUN, RECORDED, NOW)} caption="Steps of a finished run with one that threw" />
      </States>
      <States label="run, stopped" stack>
        <div className="w-full rounded-panel border border-line bg-card px-4 py-2">{facts(STOPPED_RUN, RECORDED.slice(0, 3))}</div>
        <StepTable steps={stepRows(STOPPED_RUN, RECORDED.slice(0, 3), NOW)} caption="Steps of a run that stopped half way" />
      </States>
      <States label="run, lost write" stack>
        <StepTable
          steps={stepRows(LOST_WRITE_RUN, RECORDED.filter((recordedStep) => recordedStep.ok).slice(0, 4), NOW)}
          caption="Steps of a finished run whose last rows did not reach the record"
        />
      </States>
    </Section>
  );
}
