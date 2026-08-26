import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, Panel } from "@/components/structure";
import { StatusBadge } from "@/components/display";
import { requireStaff } from "@/lib/auth/staff";
import { can } from "@/lib/auth/can";
import { runSummary } from "@/lib/ingest/service";
import { prisma } from "@/lib/db/client";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import { AdminPage, getAdminNavBadges } from "../../../_shell";
import { ApproveForm } from "./ApproveForm";
import { approve } from "../actions";

/**
 * One run: what it staged, what it queued, and why it refused the rest.
 *
 * **Rejections by countable reason** is the half of criterion 1 that is easy to
 * ship as prose and useless that way. Four grounds, four counts, adding to the
 * rejected total — so a run that refuses two thousand rows can be argued with
 * rather than only regretted.
 */

export const dynamic = "force-dynamic";

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const seat = await requireStaff();
  if (!can(seat.actor, "queue.decide")) notFound();

  const { id } = await params;
  const [run, badges] = await Promise.all([runSummary(id), getAdminNavBadges(seat)]);
  if (!run) notFound();

  const [ready, published] = await Promise.all([
    prisma.stagedListing.count({ where: { runId: run.id, disposition: "ready" } }),
    prisma.stagedListing.count({ where: { runId: run.id, disposition: "published" } }),
  ]);

  const figures = [
    { key: "categorised", label: t("admin.run.categorised"), value: run.categorisedCount },
    { key: "queued", label: t("admin.run.queued"), value: run.queuedCount },
    { key: "rejected", label: t("admin.run.rejected"), value: run.rejectedCount },
    { key: "published", label: t("admin.run.published"), value: published },
  ];

  return (
    <AdminPage
      seat={seat}
      badges={badges}
      activeHref="/admin/ingest"
      title={run.source}
      eyebrow={t("admin.run.title")}
      breadcrumb={
        <Link
          href="/admin/ingest"
          className="rounded-tag text-caption text-muted underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
        >
          {t("admin.run.back")}
        </Link>
      }
      meta={
        <span className="flex flex-wrap items-center gap-3 text-caption text-muted">
          <span className="font-mono text-eyebrow">{run.filename}</span>
          <span>{t("admin.run.rows", { count: formatCount(run.rowCount) })}</span>
          <StatusBadge tone={run.status === "approved" ? "ok" : "warn"}>{run.status}</StatusBadge>
        </span>
      }
    >
      <div className="grid gap-[var(--gutter)] sm:grid-cols-2 xl:grid-cols-4">
        {figures.map((figure) => (
          <Card key={figure.key}>
            <p className="text-caption text-muted">{figure.label}</p>
            <p className="mt-1 font-mono text-h2 tabular-nums text-ink">
              {formatCount(figure.value)}
            </p>
          </Card>
        ))}
      </div>

      <div className="mt-[var(--gutter)] grid gap-[var(--gutter)] lg:grid-cols-2">
        <Panel title={t("admin.run.grounds")}>
          {run.byGround.length === 0 ? (
            <p className="text-caption text-muted">{t("admin.run.no_rejections")}</p>
          ) : (
            <ul className="flex flex-col">
              {run.byGround.map((row) => (
                <li
                  key={row.ground}
                  className="flex items-baseline justify-between gap-3 border-t border-line py-1.5 first:border-t-0"
                >
                  <span className="min-w-0 text-body-sm text-body">
                    {t(`admin.run.ground.${row.ground}` as never)}
                  </span>
                  <span className="shrink-0 font-mono text-body-sm tabular-nums text-ink">
                    {formatCount(row.count)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title={t("admin.review.decision_heading")}>
          {run.status === "staged" ? (
            <ApproveForm runId={run.id} ready={ready} approve={approve} />
          ) : (
            <div className="flex flex-col gap-2">
              <p className="max-w-prose text-body-sm text-body">{run.decisionReason}</p>
              <p className="text-caption text-muted">
                {t("admin.run.decided", {
                  status: run.status,
                  name: run.actor.fullName ?? "—",
                })}
              </p>
            </div>
          )}
        </Panel>
      </div>
    </AdminPage>
  );
}
