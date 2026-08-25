import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth/staff";
import { can } from "@/lib/auth/can";
import { pendingQueue } from "@/lib/moderation/service";
import { openConflicts } from "@/lib/onboarding/conflict";
import { SLA_DAYS } from "@/lib/console/overview";
import { prisma } from "@/lib/db/client";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import { AdminPage, getAdminNavBadges } from "../../_shell";
import { QueueTable, type QueueRow } from "./QueueTable";

/**
 * Board 4b — the approval queue.
 *
 * First screen of handoff 4 that drains rather than fills. Handoff 3 has been
 * writing into `ListingChangeRequest` since it shipped and nothing has ever
 * read it back.
 *
 * `queue.decide` is moderator or ops lead. A staff seat that does not hold it —
 * a field verifier, finance — gets a 404 rather than an empty screen, for the
 * same reason `requireStaff` does: a page they cannot use should not be a page
 * that exists for them.
 */

export const dynamic = "force-dynamic";

export default async function QueuePage() {
  const seat = await requireStaff();
  if (!can(seat.actor, "queue.decide")) notFound();

  const [changes, conflicts, badges, categories] = await Promise.all([
    pendingQueue(200),
    openConflicts(200),
    getAdminNavBadges(seat),
    prisma.category.findMany({ select: { id: true, name: true } }),
  ]);

  const categoryName = new Map(categories.map((c) => [c.id, c.name]));

  /*
   * A category change stores ids, because that is what the column holds. A
   * moderator cannot review "cm3x9…" against "cm4a2…", so both sides are
   * resolved to names here — the queue is where a diff has to be readable.
   */
  const readable = (field: string, value: string | null): string | null => {
    if (value === null) return null;
    if (field !== "primary_category") return value;
    return categoryName.get(value) ?? value;
  };

  const rows: QueueRow[] = [
    ...changes.map((change) => ({
      id: change.id,
      kind: "change" as const,
      what: change.field,
      businessName: change.business.displayName,
      businessSlug: change.business.slug,
      from: readable(change.field, change.beforeValue),
      to: readable(change.field, change.afterValue),
      ageDays: change.ageDays,
      late: change.ageDays > SLA_DAYS.moderation,
      href: `/admin/queue/${change.id}`,
    })),
    ...conflicts.map((conflict) => ({
      id: conflict.id,
      kind: "conflict" as const,
      what: "conflict",
      businessName: conflict.business.displayName,
      businessSlug: conflict.business.slug,
      from: conflict.submissionA.claimant.fullName,
      to: conflict.submissionB.claimant.fullName,
      ageDays: conflict.ageDays,
      late: conflict.ageDays > SLA_DAYS.claim,
      href: `/admin/queue/conflict/${conflict.id}`,
    })),
  ];

  // Late first, then oldest within each band. The banding is the ordering.
  rows.sort((a, b) => Number(b.late) - Number(a.late) || b.ageDays - a.ageDays);

  const oldest = rows[0]?.ageDays ?? 0;

  return (
    <AdminPage
      seat={seat}
      badges={badges}
      activeHref="/admin/queue"
      title={t("admin.queue.title")}
      eyebrow={t("admin.queue.eyebrow")}
      meta={
        <span className="text-caption text-muted">
          {rows.length === 0
            ? t("admin.queue.empty_meta")
            : t("admin.queue.meta", {
                count: formatCount(rows.length),
                days: String(oldest),
              })}
        </span>
      }
    >
      <QueueTable rows={rows} />
    </AdminPage>
  );
}
