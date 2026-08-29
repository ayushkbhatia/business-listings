import { notFound } from "next/navigation";
import { can } from "@/lib/auth/can";
import { requireStaff } from "@/lib/auth/staff";
import { ATTRIBUTION_MAX_AGE_S } from "@/lib/campaign/attribution";
import { attributionReport } from "@/lib/campaign/report";
import { formatCount, formatDate } from "@/lib/format";
import { t } from "@/lib/i18n";
import { AdminPage, getAdminNavBadges } from "../../../_shell";
import { AttributionTable, type AttributionRowView } from "./AttributionTable";

/**
 * Criterion 9 — "campaign pages preserve UTM through to the enquiry and
 * attribute it in admin". This is the admin half.
 *
 * Counts and date ranges, and no buyer named anywhere. A marketing report that
 * listed the people who asked for a quote would be a profile, and the privacy
 * policy this handoff also ships says we do not build those.
 */

export const dynamic = "force-dynamic";

export default async function AttributionPage() {
  const seat = await requireStaff();
  if (!can(seat.actor, "taxonomy.write")) notFound();

  const [report, badges] = await Promise.all([attributionReport(), getAdminNavBadges(seat)]);

  const rows: AttributionRowView[] = report.rows.map((row, i) => ({
    key: `${row.campaign ?? ""}|${row.source ?? ""}|${row.medium ?? ""}|${i}`,
    campaign: row.campaign ?? "—",
    source: row.source ?? "—",
    medium: row.medium ?? "—",
    enquiries: formatCount(row.enquiries),
    first: formatDate(row.first),
    last: formatDate(row.last),
    direct: row.campaign === null && row.source === null && row.medium === null,
  }));

  return (
    <AdminPage
      seat={seat}
      badges={badges}
      activeHref="/admin/content/attribution"
      title={t("attribution.title")}
      eyebrow={t("attribution.eyebrow")}
      meta={
        <span className="text-caption text-muted">
          {t("attribution.meta", {
            attributed: formatCount(report.attributed),
            total: formatCount(report.total),
          })}
        </span>
      }
    >
      <AttributionTable rows={rows} />

      <p className="mt-[var(--gutter)] max-w-prose text-caption text-muted">
        {t("attribution.note", { days: ATTRIBUTION_MAX_AGE_S / 86_400 })}
      </p>
    </AdminPage>
  );
}
