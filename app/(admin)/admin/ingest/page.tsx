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
import { discard, publish, rollback, stage } from "./actions";
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
      actions={<NewImport authorities={AUTHORITIES} stage={stage} />}
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
