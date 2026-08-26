import { notFound } from "next/navigation";
import { Panel } from "@/components/structure";
import { requireStaff } from "@/lib/auth/staff";
import { can } from "@/lib/auth/can";
import { offPlatformReports, openReports, priorsFor } from "@/lib/reports/service";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import { AdminPage, getAdminNavBadges } from "../../_shell";
import { ReportTable, type ReportRow } from "./ReportTable";
import { resolve } from "./actions";

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

  const [reports, skipped, badges] = await Promise.all([
    openReports(200),
    offPlatformReports(50),
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

  return (
    <AdminPage
      seat={seat}
      badges={badges}
      activeHref="/admin/reports"
      title={t("admin.reports.title")}
      eyebrow={t("admin.reports.eyebrow")}
      meta={
        <span className="text-caption text-muted">
          {t("admin.reports.meta", {
            open: formatCount(rows.length),
            days: String(rows[0]?.ageDays ?? 0),
          })}
        </span>
      }
    >
      <ReportTable rows={rows} resolve={resolve} />

      <p className="mt-[var(--gutter)] max-w-prose text-caption text-muted">
        {t("admin.reports.note")}
      </p>

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
