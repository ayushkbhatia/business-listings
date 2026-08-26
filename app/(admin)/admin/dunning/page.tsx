import { notFound } from "next/navigation";
import { Alert } from "@/components/display";
import { can } from "@/lib/auth/can";
import { requireStaff } from "@/lib/auth/staff";
import { dunningQueue } from "@/lib/billing/dunning-queue";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import { AdminPage, getAdminNavBadges } from "../../_shell";
import { DunningTable, type DunningRowView } from "./DunningTable";

/**
 * Board 12e — failed payments, and criterion 10's screen.
 *
 * There is no "suspend" control on this page, no "unpublish", and no way to
 * remove a badge from it. That is not an oversight and it is not enforced by
 * hiding buttons: the sequence's whole vocabulary of account effects is one
 * plan change, enumerated in `lib/billing/dunning.ts` and asserted by a test
 * that reads the list.
 */

export const dynamic = "force-dynamic";

function nextLabel(next: { kind: string; channel?: string }): string {
  if (next.kind === "send") {
    return t("admin.dunning.next.send", { channel: next.channel ?? "" });
  }
  return t(`admin.dunning.next.${next.kind}` as never);
}

export default async function DunningPage() {
  const seat = await requireStaff();
  if (!can(seat.actor, "revenue.read")) notFound();

  const [queue, badges] = await Promise.all([dunningQueue(), getAdminNavBadges(seat)]);

  const rows: DunningRowView[] = queue.rows.map((row) => ({
    subscriptionId: row.subscriptionId,
    businessName: row.businessName,
    planName: row.planName,
    stage: row.stage,
    daysPastDue: row.daysPastDue,
    next: nextLabel(row.next),
    attempts: row.attempts,
  }));

  return (
    <AdminPage
      seat={seat}
      badges={badges}
      activeHref="/admin/dunning"
      title={t("admin.dunning.title")}
      eyebrow={t("admin.dunning.eyebrow")}
      meta={
        <span className="text-caption text-muted">
          {t("admin.dunning.meta", { count: formatCount(rows.length) })}
        </span>
      }
    >
      {!queue.gatewayLive && (
        <Alert tone="info" live="off">
          {t("admin.dunning.no_gateway")}
        </Alert>
      )}

      <p className="mb-[var(--gutter)] max-w-prose text-caption text-muted">
        {t("admin.dunning.sequence")}
      </p>

      <DunningTable rows={rows} />

      <p className="mt-[var(--gutter)] max-w-prose text-caption text-muted">
        {t("admin.dunning.never")}
      </p>
    </AdminPage>
  );
}
