import { notFound } from "next/navigation";
import { $Enums } from "@/lib/db/generated/client";
import { requireStaff } from "@/lib/auth/staff";
import { can } from "@/lib/auth/can";
import {
  REVERSIBLE_DAYS,
  recentRuns,
  runHistory,
  runOverview,
  runsAwaitingReview,
  sourceCoverage,
} from "@/lib/ingest/read";
import { queuedRecordCount } from "@/lib/ingest/queue";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import { AdminPage, getAdminNavBadges } from "../../_shell";
import { discard, publish, resumeStaging, rollback, signIngestUpload, stage } from "./actions";
import { IngestTabs } from "./IngestTabs";
import { RunHistory, SourcesPanel } from "./IngestRail";
import { NewImport } from "./NewImport";
import { RunReview } from "./RunReview";
import { RunTable } from "./RunTable";

/**
 * Board 12a — the licence importer.
 *
 * The page answers one question first: is a run waiting for a decision. The
 * oldest one waiting is drawn whole — the board's render — with the rest of
 * the queue named under it, the sources and history in the rail, and every
 * run in the table below.
 */

export const dynamic = "force-dynamic";
/*
   Task T4.6 — how long an ingest action is allowed to live.

   Every action on this screen can touch forty thousand records: staging a
   register export, publishing a run, continuing one the chunk loop did not
   finish, categorising a queue group, rescanning the directory for pairs.
   Not one of them declared a duration, so each inherited the platform's
   default — and a function killed mid-run is what T4.2's chunked transactions
   and resumable cursor exist to survive. Surviving it is not a reason to keep
   provoking it.

   `maxDuration` on a **page** sets the ceiling for every Server Action called
   from it (Next's own note in `route-segment-config/maxDuration`), which is
   what makes one line here cover six actions.

   Three hundred seconds: the ceiling on this project's Vercel plan — settled by
   measurement in `docs/deployments.md` § Which plan the crons run on — and well
   above what a 41,000-row run measures at, with every chunk transaction bounded
   at thirty seconds inside it so a stall fails one chunk rather than the
   request. The resume is what covers the case where even this is not enough.
*/
export const maxDuration = 300;

/**
 * The licensing authorities a run can come from, straight off the schema enum
 * so a new free zone is one migration rather than two edits.
 */
const AUTHORITIES = Object.values($Enums.Authority).map((value) => ({ value, label: value }));

export default async function IngestPage() {
  const seat = await requireStaff();
  if (!can(seat.actor, "queue.decide")) notFound();

  const [waiting, runs, history, coverage, queued, badges] = await Promise.all([
    runsAwaitingReview(),
    recentRuns(),
    runHistory(),
    sourceCoverage(),
    queuedRecordCount(),
    getAdminNavBadges(seat),
  ]);

  const next = waiting[0] ? await runOverview(waiting[0].id) : null;

  return (
    <AdminPage
      seat={seat}
      badges={badges}
      activeHref="/admin/ingest"
      title={t("admin.ingest.title")}
      eyebrow={t("admin.ingest.eyebrow")}
      meta={
        <span className="text-caption text-body">
          {waiting.length > 0
            ? t("admin.ingest.meta", { count: waiting.length, n: formatCount(waiting.length) })
            : t("admin.ingest.meta_none")}
        </span>
      }
      actions={<NewImport authorities={AUTHORITIES} stage={stage} sign={signIngestUpload} />}
    >
      <IngestTabs active="runs" queued={queued} showDedupe={can(seat.actor, "business.merge")} />

      <div className="mt-[var(--gutter)] grid gap-[var(--gutter)] xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-[var(--gutter)]">
          {next ? (
            <>
              <RunReview
                run={next}
                headingId="run-under-review"
                publish={publish}
                discard={discard}
                rollback={rollback}
                resume={resumeStaging}
                reversibleDays={REVERSIBLE_DAYS}
                linkToRun
              />
              {waiting.length > 1 && (
                <p className="text-caption text-body">
                  {t("admin.ingest.more_waiting", {
                    count: waiting.length - 1,
                    n: formatCount(waiting.length - 1),
                  })}
                </p>
              )}
            </>
          ) : (
            <div className="rounded-card border border-line bg-card p-4">
              <p className="text-body-sm text-ink">{t("admin.ingest.none_waiting.title")}</p>
              <p className="mt-1 max-w-prose text-caption text-body">
                {t("admin.ingest.none_waiting.body")}
              </p>
            </div>
          )}
        </div>

        <aside className="flex min-w-0 flex-col gap-[var(--gutter)]" aria-label={t("admin.ingest.rail")}>
          <SourcesPanel rows={coverage} />
          <RunHistory rows={history} reversibleDays={REVERSIBLE_DAYS} />
        </aside>
      </div>

      <div className="mt-[var(--section-pad)]">
        <RunTable rows={runs} />
      </div>
    </AdminPage>
  );
}
