import Link from "next/link";
import { notFound } from "next/navigation";
import { StatusBadge } from "@/components/display";
import { requireStaff } from "@/lib/auth/staff";
import { can } from "@/lib/auth/can";
import { prisma } from "@/lib/db/client";
import { dedupeCounts, manualQueue, reversibleDecisions, todayTally, type ReversibleRow } from "@/lib/dedupe/queue";
import { BULK_LIMIT } from "@/lib/dedupe/resolve";
import { REVERSIBLE_DAYS } from "@/lib/dedupe/service";
import { formatCount, formatDate, formatPercent } from "@/lib/format";
import { queuedRecordCount } from "@/lib/ingest/queue";
import { t } from "@/lib/i18n";
import { AdminPage, getAdminNavBadges } from "../../../_shell";
import { IngestTabs } from "../IngestTabs";
import { bulkMerge, preview, rescan, resolve, reverse, tune } from "./actions";
import { DedupeActions } from "./DedupeActions";
import { BelowFloorNote, QueueEmpty, SignalsCard, TodayCard, WhyCard } from "./DedupeRail";
import { DedupeWorkspace } from "./DedupeWorkspace";
import { ReversibleTable, type ReversibleTableRow } from "./ReversibleTable";
import { signalRows } from "./signals";

/**
 * Board 12b — the dedupe queue.
 *
 * The second and last board of the ingestion chain. Pairs above the certain
 * line bulk merge in one action; the band between the floor and that line
 * comes here one at a time, because merging two genuinely separate companies
 * destroys reviews and confuses buyers.
 *
 * `business.merge` is ops lead alone: a merge rewrites slugs, creates a 301 and
 * moves somebody's reviews onto another company's page. `?run=` narrows the
 * queue to one import run; `?pair=` is the position J and K move.
 */

export const dynamic = "force-dynamic";

const DAY_MS = 86_400_000;

export default async function DedupePage({
  searchParams,
}: {
  searchParams: Promise<{ run?: string; pair?: string }>;
}) {
  const seat = await requireStaff();
  if (!can(seat.actor, "business.merge")) notFound();

  const query = await searchParams;
  const runId = query.run?.trim() || null;
  const position = Math.max(1, Number.parseInt(query.pair ?? "1", 10) || 1);
  const now = new Date();

  const [counts, queue, tally, decisions, queued, run, badges] = await Promise.all([
    dedupeCounts({ runId }),
    manualQueue({ runId, position }),
    todayTally(seat.actor.id, now),
    reversibleDecisions(now),
    queuedRecordCount(),
    runId
      ? prisma.licenceImportRun.findUnique({ where: { id: runId }, select: { id: true, number: true } })
      : Promise.resolve(null),
    getAdminNavBadges(seat),
  ]);
  if (runId && !run) notFound();

  const pair = queue.pair;

  return (
    <AdminPage
      seat={seat}
      badges={badges}
      activeHref="/admin/ingest/dedupe"
      title={t("admin.dedupe.title")}
      eyebrow={t("admin.dedupe.eyebrow")}
      meta={
        <span className="flex flex-wrap items-center gap-3 text-body-sm text-body">
          <StatusBadge tone="warn">{t("admin.dedupe.pairs", { count: counts.pending, n: formatCount(counts.pending) })}</StatusBadge>
          <span>
            {t("admin.dedupe.meta", { n: formatCount(counts.certain), line: formatPercent(counts.bands.certain) })}
          </span>
          {run && (
            <>
              <span className="font-mono text-eyebrow uppercase">{t("admin.dedupe.meta_run", { number: run.number })}</span>
              <Link
                href="/admin/ingest/dedupe"
                className="rounded-tag text-moss underline underline-offset-2 focus-visible:shadow-focus focus-visible:outline-none"
              >
                {t("admin.dedupe.all_runs")}
              </Link>
            </>
          )}
        </span>
      }
      actions={
        <DedupeActions
          certain={counts.certain}
          bands={counts.bands}
          runId={runId}
          reversibleDays={REVERSIBLE_DAYS}
          bulkLimit={BULK_LIMIT}
          bulkMerge={bulkMerge}
          preview={preview}
          tune={tune}
          rescan={rescan}
        />
      }
    >
      {/* The ingestion chain's shared strip, identical on all three of its screens. */}
      <IngestTabs active="dedupe" queued={queued} showDedupe />

      <div className="mt-[var(--gutter)] grid items-start gap-[var(--gutter)] xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0">
          <DedupeWorkspace
            pair={pair}
            position={queue.position}
            total={queue.total}
            runId={runId}
            reversibleDays={REVERSIBLE_DAYS}
            resolve={resolve}
            empty={<QueueEmpty certain={counts.certain} bands={counts.bands} />}
          />
        </div>

        <div className="flex flex-col gap-[var(--gutter)]">
          {pair && <SignalsCard rows={signalRows(pair.signals)} />}
          <WhyCard score={pair?.score ?? null} bands={counts.bands} />
          <TodayCard tally={tally} />
          <BelowFloorNote count={counts.belowFloor} floor={counts.bands.floor} />
        </div>
      </div>

      <section aria-labelledby="dedupe-reversible" className="mt-[var(--section-pad)]">
        <h2 id="dedupe-reversible" className="mb-3 text-h2 text-ink">
          {t("admin.dedupe.reversible_title")}
        </h2>
        <ReversibleTable rows={decisions.map((row) => reversibleRow(row, now))} reverse={reverse} />
      </section>
    </AdminPage>
  );
}

function reversibleRow(row: ReversibleRow, now: Date): ReversibleTableRow {
  const names = { parent: row.parentName ?? "", other: row.otherName ?? "" };
  return {
    kind: row.kind,
    id: row.id,
    decision:
      row.outcome === "bulk"
        ? t("admin.dedupe.row.bulk", { count: row.pairs, n: formatCount(row.pairs) })
        : t(`admin.dedupe.row.${row.outcome}`, names),
    owner:
      row.ownerConfirmation && ["awaiting", "informed", "confirmed"].includes(row.ownerConfirmation)
        ? row.ownerConfirmation
        : null,
    reason: row.reason,
    decidedBy: t("admin.dedupe.row.by", { name: row.by ?? t("admin.run.someone"), date: formatDate(row.decidedAt) }),
    // Rounded up, so the last day reads "1 day" rather than "0 days".
    daysLeft: Math.max(0, Math.ceil((row.reversibleUntil.getTime() - now.getTime()) / DAY_MS)),
  };
}
