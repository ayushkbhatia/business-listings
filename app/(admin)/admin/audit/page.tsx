import { notFound } from "next/navigation";
import { Alert } from "@/components/display";
import { requireStaff } from "@/lib/auth/staff";
import { auditLog } from "@/lib/reports/service";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import { AdminPage, getAdminNavBadges } from "../../_shell";
import { AuditTable, type AuditRowData } from "./AuditTable";

/**
 * Board 4i — the audit log, scoped.
 *
 * §07: ops lead reads all of it, every other staff role reads **their own
 * actions**. `auditScopeFor` has implemented that since handoff 3 step 4 and
 * had never been called — the narrowing existed and narrowed nothing.
 *
 * A moderator is told they are seeing their own rows rather than left to work
 * it out from an unexpectedly short list. A scope somebody cannot see is a
 * scope they will assume is a bug.
 */

export const dynamic = "force-dynamic";

export default async function AuditPage() {
  const seat = await requireStaff();
  const [entries, badges] = await Promise.all([
    auditLog(seat.actor, { limit: 200 }),
    getAdminNavBadges(seat),
  ]);
  if (!entries) notFound();

  const rows: AuditRowData[] = entries.map((entry) => ({
    id: entry.id,
    when: entry.createdAt,
    who: entry.actor.fullName ?? "—",
    action: entry.action,
    subject: entry.subject,
    reason: entry.reason,
  }));

  return (
    <AdminPage
      seat={seat}
      badges={badges}
      activeHref="/admin/audit"
      title={t("admin.audit.title")}
      eyebrow={t("admin.audit.eyebrow")}
      meta={
        <span className="text-caption text-muted">
          {seat.isOpsLead
            ? t("admin.audit.meta_all", { count: formatCount(rows.length) })
            : t("admin.audit.meta_own", { count: formatCount(rows.length) })}
        </span>
      }
    >
      {!seat.isOpsLead && (
        <div className="mb-[var(--gutter)]">
          <Alert tone="info">{t("admin.audit.scope_own")}</Alert>
        </div>
      )}

      <AuditTable rows={rows} />
    </AdminPage>
  );
}
