import { notFound } from "next/navigation";
import { can } from "@/lib/auth/can";
import { requireStaff } from "@/lib/auth/staff";
import { formatCount, formatDateTime } from "@/lib/format";
import { t } from "@/lib/i18n";
import { JOB_RUN_KEEP_DAYS } from "@/lib/jobs/health";
import { jobsOverview, refusedCalls, runHistory, stepFailures } from "@/lib/jobs/report";
import { JOB_GRACE_MS, JOB_SCHEDULES, isJobCron, nextSlot, type JobCron } from "@/lib/jobs/schedule";
import { AdminPage, getAdminNavBadges } from "../../_shell";
import { CronTable, CronTabs, RefusalTable, RunHistoryTable, StepFailureTable, cronHref, cronInSentence } from "./JobsView";

/**
 * Standing item 9.5 — the scheduled jobs, and whether they ran.
 *
 * Two crons call two routes and between them run every renewal, every dunning
 * step, the licence sweep and every notification held for quiet hours. Until
 * this screen, a run left a `console.info` behind and nothing else, so a
 * nightly that stopped firing changed nothing anywhere. Now the first table
 * answers the question outright — when each cron last ran, how long ago, and
 * how many of its scheduled runs are missing — and the three below it say, for
 * one cron, which runs happened, which steps keep throwing, and which calls
 * were turned away.
 *
 * A report and nothing else: there is nothing to press here, so nothing here
 * writes and nothing needs an audit row. Every figure is a query over
 * `job_run` or arithmetic on the schedule `vercel.json` declares.
 */

export const dynamic = "force-dynamic";
export const metadata = { title: t("admin.jobs.title") };

type Search = { cron?: string; after?: string };

export default async function JobsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const seat = await requireStaff();
  if (!can(seat.actor, "jobs.read")) notFound();

  const query = await searchParams;
  const cron: JobCron = query.cron && isJobCron(query.cron) ? query.cron : "daily";
  const cursor = query.after ?? null;
  const now = new Date();

  const [overview, badges] = await Promise.all([jobsOverview(now), getAdminNavBadges(seat)]);
  const [history, failures, refusals] = await Promise.all([
    runHistory(cron, cursor, overview.recordingSince, now),
    stepFailures(cron, now),
    refusedCalls(cron, now),
  ]);
  const days = formatCount(JOB_RUN_KEEP_DAYS);

  return (
    <AdminPage
      seat={seat}
      badges={badges}
      activeHref="/admin/jobs"
      title={t("admin.jobs.title")}
      eyebrow={t("admin.jobs.eyebrow")}
      meta={
        <span className="font-mono text-eyebrow uppercase text-muted">
          {overview.recordingSince
            ? t("admin.jobs.meta", { date: formatDateTime(overview.recordingSince), days })
            : t("admin.jobs.meta_none", { days })}
        </span>
      }
    >
      <section aria-labelledby="jobs-crons">
        <h2 id="jobs-crons" className="mb-3 text-h2 text-ink">
          {t("admin.jobs.crons.title")}
        </h2>
        <CronTable crons={overview.crons} now={now} />
        <p className="mt-2 max-w-prose text-caption text-body">
          {t("admin.jobs.crons.note", { grace: formatCount(JOB_GRACE_MS / 60_000) })}
        </p>
      </section>

      {/*
         The three tables below are about one cron at a time, so the choice sits
         above all three rather than inside the first. Routes, so a colleague
         can be sent "the sweep's refusals" as a link.
      */}
      <div id="runs" className="mt-[var(--section-pad)] scroll-mt-6">
        <CronTabs active={cron} />
      </div>

      <section aria-labelledby="jobs-runs" className="mt-[var(--gutter)]">
        <h2 id="jobs-runs" className="mb-3 text-h2 text-ink">
          {t("admin.jobs.history.title", { cron: cronInSentence(cron) })}
        </h2>
        <RunHistoryTable
          cron={cron}
          history={history}
          next={nextSlot(JOB_SCHEDULES[cron], now)}
          newestHref={cursor ? `${cronHref(cron)}#runs` : null}
          olderHref={history.nextCursor ? `${cronHref(cron)}&after=${encodeURIComponent(history.nextCursor)}#runs` : null}
        />
      </section>

      <section aria-labelledby="jobs-failures" className="mt-[var(--section-pad)]">
        <h2 id="jobs-failures" className="mb-3 text-h2 text-ink">
          {t("admin.jobs.failures.title", { cron: cronInSentence(cron), days })}
        </h2>
        <StepFailureTable cron={cron} failures={failures} />
      </section>

      <section aria-labelledby="jobs-refusals" className="mt-[var(--section-pad)]">
        <h2 id="jobs-refusals" className="mb-3 text-h2 text-ink">
          {t("admin.jobs.refusals.title", { cron: cronInSentence(cron), days })}
        </h2>
        <RefusalTable cron={cron} refusals={refusals} />
        <p className="mt-2 max-w-prose text-caption text-body">{t("admin.jobs.refusals.note")}</p>
      </section>
    </AdminPage>
  );
}
