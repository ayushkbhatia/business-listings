import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth/staff";
import { can } from "@/lib/auth/can";
import { openVisitRequests } from "@/lib/visits/service";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import { AdminPage, getAdminNavBadges } from "../../_shell";
import { VisitTable, type VisitRow } from "./VisitTable";

/**
 * Board 12h — field visits.
 *
 * `visit.record` is ops lead or field verifier, and recording a visit does not
 * set a tier: those are two decisions made by two capabilities, and collapsing
 * them would mean a field verifier who visits a business has thereby tiered it.
 */

export const dynamic = "force-dynamic";

export default async function VisitsPage() {
  const seat = await requireStaff();
  if (!can(seat.actor, "visit.record")) notFound();

  const [requests, badges] = await Promise.all([
    openVisitRequests(200),
    getAdminNavBadges(seat),
  ]);

  const rows: VisitRow[] = requests.map((request) => {
    const location = request.business.locations[0];
    return {
      id: request.id,
      businessName: request.business.displayName,
      tier: request.business.verificationTier,
      where: location
        ? [location.area.name, location.emirate.replace(/_/g, " ")].filter(Boolean).join(", ")
        : "—",
      note: request.preferredNote,
      ageDays: request.ageDays,
    };
  });

  return (
    <AdminPage
      seat={seat}
      badges={badges}
      activeHref="/admin/visits"
      title={t("admin.visits.title")}
      eyebrow={t("admin.visits.eyebrow")}
      meta={
        <span className="text-caption text-muted">
          {t("admin.visits.meta", {
            count: formatCount(rows.length),
            days: String(rows[0]?.ageDays ?? 0),
          })}
        </span>
      }
    >
      <VisitTable rows={rows} />

      <p className="mt-[var(--gutter)] max-w-prose text-caption text-muted">
        {t("admin.visits.note")}
      </p>
    </AdminPage>
  );
}
