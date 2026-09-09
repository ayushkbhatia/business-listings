import { notFound } from "next/navigation";
import { Panel } from "@/components/structure";
import { requireStaff } from "@/lib/auth/staff";
import { can } from "@/lib/auth/can";
import { offPlatformReports, openReports, priorsFor } from "@/lib/reports/service";
import { openDisputes } from "@/lib/reviews/disputes";
import { formatCount, formatDate } from "@/lib/format";
import { t } from "@/lib/i18n";
import { AdminPage, getAdminNavBadges } from "../../_shell";
import { ReportTable, type ReportRow } from "./ReportTable";
import { DisputeQueue, type DisputeQueueRow } from "./DisputeQueue";
import { decideDispute, resolve } from "./actions";

/**
 * Board 4h — supplier reports.
 *
 * A supplier-conduct queue, not a payment-dispute queue. The three outcomes are
 * corrected, upheld and no action, and there is no fourth — CLAUDE.md's
 * vocabulary table calls this a supplier report rather than a dispute for
 * exactly that reason.
 *
 * Off-platform payment reports are shown separately, below. The README says
 * they skip the queue, and the reason is that they are not a judgement call:
 * the platform detected the message, and what a person decides is about the
 * account rather than about the message.
 */

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const seat = await requireStaff();
  if (!can(seat.actor, "report.resolve")) notFound();

  const [reports, skipped, disputes, badges] = await Promise.all([
    openReports(200),
    offPlatformReports(50),
    openDisputes(100),
    getAdminNavBadges(seat),
  ]);

  const rows: ReportRow[] = await Promise.all(
    reports.map(async (report) => {
      const priors = await priorsFor(report.subjectBusiness.id, report.subjectField);
      return {
        id: report.id,
        kind: report.kind,
        detail: report.detail,
        businessName: report.subjectBusiness.displayName,
        automatic: report.automatic,
        priorsOnField: priors.onField,
        ageDays: report.ageDays,
      };
    }),
  );

  const disputeRows: DisputeQueueRow[] = disputes.map((dispute) => ({
    id: dispute.id,
    businessName: dispute.businessName,
    businessSlug: dispute.businessSlug,
    ground: dispute.ground,
    detail: dispute.detail,
    reviewBody: dispute.reviewBody,
    reviewOverall: dispute.reviewOverall,
    buyerName: dispute.buyerName,
    fromAcceptedQuote: dispute.fromAcceptedQuote,
    createdAt: formatDate(dispute.createdAt),
    ageDays: dispute.ageDays,
  }));

  return (
    <AdminPage
      seat={seat}
      badges={badges}
      activeHref="/admin/reports"
      title={t("admin.reports.title")}
      eyebrow={t("admin.reports.eyebrow")}
      /*
         Nothing, when there is nothing. This rendered unconditionally, so an
         empty queue read "0 open, oldest 0 days" — and the oldest of no reports
         is not zero days, it is not a quantity. The designed empty state below
         is what an empty queue is supposed to say.
      */
      meta={
        rows.length > 0 ? (
          <span className="text-caption text-muted">
            {t("admin.reports.meta", {
              open: formatCount(rows.length),
              days: String(rows[0]!.ageDays),
            })}
          </span>
        ) : undefined
      }
    >
      <ReportTable rows={rows} resolve={resolve} />

      <p className="mt-[var(--gutter)] max-w-prose text-caption text-muted">
        {t("admin.reports.note")}
      </p>

      {/*
         Board 11c `B5`. A second queue on this screen rather than a fifth
         `ReportKind`: a dispute is filed by a business about a review and
         resolves to one of two outcomes, and a supplier report is filed against
         a business about a listing and resolves to one of three. One page, two
         row shapes, and `priorsFor()` still counting only what was reported.
      */}
      <div className="mt-[var(--gutter)]">
        <Panel
          title={t("admin.disputes.heading")}
          description={t("admin.disputes.description")}
        >
          <DisputeQueue
            rows={disputeRows}
            decide={decideDispute}
            mayUphold={can(seat.actor, "review.remove")}
          />
        </Panel>
      </div>

      <div className="mt-[var(--gutter)]">
        <Panel title={t("admin.reports.skipped_heading")}>
          {skipped.length === 0 ? (
            <p className="text-caption text-muted">{t("admin.reports.skipped_empty")}</p>
          ) : (
            <ul className="flex flex-col">
              {skipped.map((report) => (
                <li
                  key={report.id}
                  className="flex flex-col gap-0.5 border-t border-line py-1.5 first:border-t-0"
                >
                  <span className="text-body-sm text-ink">
                    {report.subjectBusiness.displayName}
                  </span>
                  <span className="max-w-prose text-caption text-muted">{report.detail}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </AdminPage>
  );
}
