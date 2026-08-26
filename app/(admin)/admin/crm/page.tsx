import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth/staff";
import { callList } from "@/lib/crm/call-list";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import { AdminPage, getAdminNavBadges } from "../../_shell";
import { CallListTable, type ProspectRow } from "./CallListTable";

/**
 * Board 12d — recruitment.
 *
 * Every signal behind this list has been written since handoffs 1 and 2 and
 * read by nothing: `ZeroResultQuery` since the search step, `MissedEnquiry`
 * since the fan-out. This is the reader.
 */

export const dynamic = "force-dynamic";

export default async function CrmPage() {
  const seat = await requireStaff();
  // Any staff seat may see the list. Nothing on it is a decision.
  if (!seat) notFound();

  const [prospects, badges] = await Promise.all([callList(200), getAdminNavBadges(seat)]);

  const rows: ProspectRow[] = prospects.map((prospect) => ({
    businessId: prospect.businessId,
    displayName: prospect.displayName,
    signal: prospect.signal,
    value: prospect.value,
    plan: prospect.planId ?? "—",
    claimStatus: prospect.claimStatus,
  }));

  return (
    <AdminPage
      seat={seat}
      badges={badges}
      activeHref="/admin/crm"
      title={t("admin.crm.title")}
      eyebrow={t("admin.crm.eyebrow")}
      meta={
        <span className="text-caption text-muted">
          {t("admin.crm.meta", { count: formatCount(rows.length) })}
        </span>
      }
    >
      <CallListTable rows={rows} />

      <p className="mt-[var(--gutter)] max-w-prose text-caption text-muted">
        {t("admin.crm.note")}
      </p>
    </AdminPage>
  );
}
