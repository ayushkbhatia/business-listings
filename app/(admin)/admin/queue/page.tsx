import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth/staff";
import { can } from "@/lib/auth/can";
import { pendingQueue, ageInDays } from "@/lib/moderation/service";
import { pendingDocumentReviews } from "@/lib/verification/review";
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

  const [changes, conflicts, documents, badges, categories] = await Promise.all([
    pendingQueue(200),
    openConflicts(200),
    /*
       Board 3e §4's third kind of waiting thing.

       A credential a seller has asked to publish, which their own screen tells
       them takes two working days "in the moderation queue" — so the queue has
       to hold it. It was a state with an SLA, an owner named in copy, and no
       row anywhere; that is the same defect the board came here to fix, one
       screen along.
    */
    pendingDocumentReviews(200),
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
    // Both category fields store an id. `additional_category` joined them on
    // board 3b, and without this the queue row read a raw cuid — a moderator
    // cannot review "cm3x9…" against anything.
    if (field !== "primary_category" && field !== "additional_category") return value;
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
    ...documents.map((document) => ({
      id: document.id,
      kind: "document" as const,
      what: document.kind,
      businessName: document.business!.displayName,
      businessSlug: document.business!.slug,
      from: null,
      to: document.displayName ?? document.filename,
      ageDays: ageInDays(document.createdAt),
      late: ageInDays(document.createdAt) > SLA_DAYS.credential,
      href: `/admin/queue/document/${document.id}`,
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

  /*
     The maximum, not the head of the sort.

     The sort is late-first and only then oldest, and "late" is measured against
     a per-kind SLA — `SLA_DAYS.claim` is not `SLA_DAYS.listing`. So a claim
     four days old can sort above a credential six days old, and reading
     `rows[0].ageDays` reported the queue as younger than it was, in exactly the
     case where somebody is looking at this header to decide what is behind.
  */
  const oldest = rows.reduce((max, row) => Math.max(max, row.ageDays), 0);

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
