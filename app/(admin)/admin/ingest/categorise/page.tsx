import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth/staff";
import { can } from "@/lib/auth/can";
import { prisma } from "@/lib/db/client";
import {
  activityMappings,
  categorisationQueue,
  categoryOptions,
  queuedRecordCount,
} from "@/lib/ingest/queue";
import { formatCount, formatDate } from "@/lib/format";
import { t } from "@/lib/i18n";
import { AdminPage, getAdminNavBadges } from "../../../_shell";
import { categorise, forgetMapping } from "../actions";
import { IngestTabs } from "../IngestTabs";
import { MappingsTable } from "./MappingsTable";
import { QueueTable } from "./QueueTable";

/**
 * Board 12a — the categorisation queue.
 *
 * The build plan's step 4.1: "a categorise screen for `needs_category`".
 * Records wait here, grouped by the activity their licence names, until a
 * person files them — and a run's publish control counts them as waiting
 * until then (B3). `?run=` narrows the queue to one run, which is where the
 * run page's "Categorise this run's queue" lands.
 */

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

export default async function CategorisePage({
  searchParams,
}: {
  searchParams: Promise<{ run?: string; q?: string; page?: string }>;
}) {
  const seat = await requireStaff();
  if (!can(seat.actor, "queue.decide")) notFound();

  const query = await searchParams;
  const page = Math.max(1, Number.parseInt(query.page ?? "1", 10) || 1);
  const runId = query.run?.trim() || null;
  const search = query.q?.trim() ?? "";

  const [queue, options, mappings, queued, run, badges] = await Promise.all([
    categorisationQueue({ runId, query: search, page, pageSize: PAGE_SIZE }),
    categoryOptions(),
    activityMappings(),
    queuedRecordCount(),
    runId
      ? prisma.licenceImportRun.findUnique({ where: { id: runId }, select: { id: true, number: true } })
      : Promise.resolve(null),
    getAdminNavBadges(seat),
  ]);
  if (runId && !run) notFound();

  return (
    <AdminPage
      seat={seat}
      badges={badges}
      activeHref="/admin/ingest"
      title={t("admin.categorise.title")}
      eyebrow={t("admin.categorise.eyebrow")}
      meta={
        <span className="flex flex-wrap items-center gap-3 text-caption text-body">
          <span>
            {t("admin.categorise.meta", {
              count: queue.totalGroups,
              n: formatCount(queue.totalGroups),
              records: formatCount(queue.totalRecords),
            })}
          </span>
          {run && (
            <>
              <span className="font-mono text-eyebrow uppercase">
                {t("admin.categorise.meta_run", { number: run.number })}
              </span>
              <Link
                href="/admin/ingest/categorise"
                className="rounded-tag text-moss underline underline-offset-2 focus-visible:shadow-focus focus-visible:outline-none"
              >
                {t("admin.categorise.all_runs")}
              </Link>
            </>
          )}
        </span>
      }
    >
      <IngestTabs active="queue" queued={queued} showDedupe={can(seat.actor, "business.merge")} />

      <p className="mt-[var(--gutter)] max-w-prose text-caption text-body">{t("admin.categorise.note")}</p>

      <div className="mt-[var(--gutter)]">
        <QueueTable
          rows={queue.groups.map((group) => ({
            key: group.key,
            activity: group.activity,
            records: group.records,
            runNumbers: group.runNumbers,
            emirates: group.emirates,
            authorities: group.authorities,
          }))}
          page={queue.page}
          pageSize={queue.pageSize}
          totalGroups={queue.totalGroups}
          runId={runId}
          query={search}
          options={options}
          categorise={categorise}
        />
      </div>

      <section aria-labelledby="remembered" className="mt-[var(--section-gap)]">
        <h2 id="remembered" className="text-h2 text-ink">
          {t("admin.mappings.title")}
        </h2>
        <p className="mb-3 mt-1 max-w-prose text-caption text-body">
          {t("admin.mappings.description")}
          {mappings.total > mappings.rows.length && (
            <>
              {" "}
              {t("admin.mappings.showing", {
                shown: formatCount(mappings.rows.length),
                total: formatCount(mappings.total),
              })}
            </>
          )}
        </p>
        <MappingsTable
          rows={mappings.rows.map((row) => ({
            id: row.id,
            activity: row.activity,
            categoryName: row.category.name,
            decidedLabel: t("admin.mappings.by", {
              name: row.actor.fullName ?? t("admin.run.someone"),
              date: formatDate(row.updatedAt),
            }),
            reason: row.reason,
          }))}
          forget={forgetMapping}
        />
      </section>
    </AdminPage>
  );
}
