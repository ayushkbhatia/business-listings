import Link from "next/link";
import { notFound } from "next/navigation";
import { Panel } from "@/components/structure";
import { requireStaff } from "@/lib/auth/staff";
import { can } from "@/lib/auth/can";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import { prisma } from "@/lib/db/client";
import { readDetectorRules } from "@/lib/reports/detector-settings";
import { COOLING_DAYS } from "@/lib/reports/detector-rules";
import { AdminPage, getAdminNavBadges } from "../../../_shell";
import { saveDetectorRules } from "../actions";
import { DetectorForm } from "./DetectorForm";

/**
 * Board 4h `B11` — *"the threshold is configurable outside this screen."*
 *
 * Outside it, and one click from it, the same arrangement board 4b has with
 * `/admin/queue/rules`. The spec's flag 7 is the case this exists for: *"a
 * threshold that produces too many false positives is a moderator-time problem
 * with no screen."*
 *
 * ## What is not here
 *
 * A confidence slider. The board draws `IMAGE MATCH · 88% CONFIDENCE` and the
 * platform has no scoring detector — every rule below is a count or a date,
 * both of which are either true or not. What an auto-detected row carries is
 * the figure the detector measured, written into its evidence line.
 *
 * Off-platform payment detection has no switch either. It is not a sweep, it
 * runs at the moment a message is written, and a control that turns off fraud
 * detection is one nobody notices is off — the same call board 4b makes for its
 * two unswitchable rules.
 *
 * `report.detectors` is ops lead. A moderator works the queue; the seat that
 * answers for what lands in it sets the lines.
 */

export const dynamic = "force-dynamic";

export default async function DetectorsPage() {
  const seat = await requireStaff();
  if (!can(seat.actor, "report.detectors")) notFound();

  const [rules, badges, filed] = await Promise.all([
    readDetectorRules(),
    getAdminNavBadges(seat),
    /*
       What the sweeps have actually produced, so the page reports on itself.
       A tuning screen with no measurement beside it is a set of numbers to
       guess at.
    */
    prisma.supplierReport.groupBy({
      by: ["detector", "outcome"],
      where: { detector: { not: null } },
      _count: { _all: true },
    }),
  ]);

  const byDetector = (detector: string) =>
    filed.filter((row) => row.detector === detector).reduce((sum, row) => sum + row._count._all, 0);
  const noActionBy = (detector: string) =>
    filed
      .filter((row) => row.detector === detector && row.outcome === "no_action")
      .reduce((sum, row) => sum + row._count._all, 0);

  return (
    <AdminPage
      seat={seat}
      badges={badges}
      activeHref="/admin/reports"
      title={t("admin.detectors.title")}
      eyebrow={t("admin.reports.eyebrow")}
      breadcrumb={
        <Link
          href="/admin/reports"
          className="rounded-tag text-caption text-muted underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
        >
          {t("admin.report_detail.back")}
        </Link>
      }
    >
      <div className="grid items-start gap-[var(--gutter)] board:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <Panel title={t("admin.detectors.rules")} description={t("admin.detectors.rules_note")}>
          <DetectorForm rules={rules} save={saveDetectorRules} />
        </Panel>

        <aside className="flex flex-col gap-[var(--gutter)]" aria-label={t("admin.detectors.rail_label")}>
          <Panel
            title={t("admin.detectors.filed")}
            description={t("admin.detectors.filed_note")}
          >
            <table className="w-full border-collapse text-left">
              <caption className="sr-only">{t("admin.detectors.filed_caption")}</caption>
              <thead>
                <tr className="border-b border-line">
                  <th scope="col" className="py-1.5 pr-3 text-caption font-normal text-muted">
                    {t("admin.detectors.col_detector")}
                  </th>
                  <th scope="col" className="px-3 py-1.5 text-right text-caption font-normal text-muted">
                    {t("admin.detectors.col_filed")}
                  </th>
                  <th scope="col" className="py-1.5 pl-3 text-right text-caption font-normal text-muted">
                    {t("admin.detectors.col_no_action")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {(["shared_phone", "licence_long_expired", "off_platform_message"] as const).map(
                  (detector) => (
                    <tr key={detector} className="border-b border-line last:border-b-0">
                      <th
                        scope="row"
                        className="py-2 pr-3 text-left text-body-sm font-normal text-ink"
                      >
                        {t(
                          `admin.reports.detector.${detector}` as "admin.reports.detector.shared_phone",
                        )}
                      </th>
                      <td className="px-3 py-2 text-right font-mono text-body-sm tabular-nums">
                        {formatCount(byDetector(detector))}
                      </td>
                      <td className="py-2 pl-3 text-right font-mono text-body-sm tabular-nums">
                        {formatCount(noActionBy(detector))}
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
            <p className="mt-2 text-caption text-muted">{t("admin.detectors.false_positive_note")}</p>
          </Panel>

          <Panel title={t("admin.detectors.cooling")}>
            <p className="text-body-sm text-body">
              {t("admin.detectors.cooling_note", { days: String(COOLING_DAYS) })}
            </p>
          </Panel>
        </aside>
      </div>
    </AdminPage>
  );
}
