import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth/staff";
import { can } from "@/lib/auth/can";
import { REVERSIBLE_DAYS, isRecordFilter, runOverview, runRecords } from "@/lib/ingest/read";
import { queuedRecordCount } from "@/lib/ingest/queue";
import { t } from "@/lib/i18n";
import { AdminPage, getAdminNavBadges } from "../../../_shell";
import { discard, publish, rollback } from "../actions";
import { IngestTabs } from "../IngestTabs";
import { RunReview } from "../RunReview";
import { RecordsTable } from "./RecordsTable";

/**
 * One run: its buckets, its decision, and every record it staged.
 *
 * The records table is the build plan's "a screen that renders a staged row"
 * — the run page used to stop at counts, so a rejection could be counted and
 * never looked at, and a record the queue could not explain could not be
 * found.
 */

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

export default async function RunPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ show?: string; page?: string }>;
}) {
  const seat = await requireStaff();
  if (!can(seat.actor, "queue.decide")) notFound();

  const [{ id }, query] = await Promise.all([params, searchParams]);
  const show = isRecordFilter(query.show) ? query.show : "all";
  const page = Math.max(1, Number.parseInt(query.page ?? "1", 10) || 1);

  const [run, records, queued, badges] = await Promise.all([
    runOverview(id),
    runRecords(id, show, page, PAGE_SIZE),
    queuedRecordCount(),
    getAdminNavBadges(seat),
  ]);
  if (!run) notFound();

  return (
    <AdminPage
      seat={seat}
      badges={badges}
      activeHref="/admin/ingest"
      title={t("admin.run.title", { number: run.number, source: run.source })}
      eyebrow={t("admin.run.eyebrow")}
      breadcrumb={
        <Link
          href="/admin/ingest"
          className="rounded-tag text-caption text-body underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
        >
          {t("admin.run.back")}
        </Link>
      }
    >
      <IngestTabs active="runs" queued={queued} showDedupe={can(seat.actor, "business.merge")} />

      <div className="mt-[var(--gutter)]">
        <RunReview
          run={run}
          headingId="run-summary"
          publish={publish}
          discard={discard}
          rollback={rollback}
          reversibleDays={REVERSIBLE_DAYS}
        />
      </div>

      <section aria-labelledby="run-records" className="mt-[var(--section-gap)]">
        <h2 id="run-records" className="mb-3 text-h2 text-ink">
          {t("admin.records.title")}
        </h2>
        <RecordsTable
          runId={run.id}
          runNumber={run.number}
          show={show}
          page={page}
          pageSize={PAGE_SIZE}
          total={records.total}
          counts={records.counts}
          rows={records.rows}
        />
      </section>
    </AdminPage>
  );
}
