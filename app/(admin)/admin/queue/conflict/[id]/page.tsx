import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { can } from "@/lib/auth/can";
import { requireStaff } from "@/lib/auth/staff";
import { conflictHolders } from "@/lib/claims/conflict";
import { conflictReviewFor } from "@/lib/claims/review";
import { prisma } from "@/lib/db/client";
import { t } from "@/lib/i18n";
import { AdminPage, getAdminNavBadges } from "../../../../_shell";
import { QueuePosition, type QueueParams } from "../../position";
import {
  assignConflictAction,
  escalateConflictAction,
  logConflictCallAction,
  requestConflictDocumentsAction,
  resolveConflictAction,
} from "../actions";
import { ConflictWorkspace } from "../ConflictWorkspace";
import { conflictView } from "../view";

/**
 * Board 4c — review a submission, the conflicting-claim body.
 *
 * Two or more claims on one listing, scored on the same rows against the
 * record the listing was minted from, with the listing and the cost of the
 * delay in a rail and a decision log read from events. Every resolution is one
 * call, notifies every claimant, and is written with the internal note as its
 * reason.
 *
 * `queue.decide` opens it; `claim.resolve` decides it. A moderator reaching a
 * conflict reads the evidence and may assign it to an ops lead (`B1`) — the
 * route used to 404 for them, which left a queue row they could see linking to
 * nowhere. Everything else is refused by the services from their seat, not
 * only absent from their screen.
 *
 * A resolved conflict opened by URL is the resolved view, never an editable
 * one (§States).
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function ConflictPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<QueueParams>;
}) {
  const seat = await requireStaff();
  if (!can(seat.actor, "queue.decide")) notFound();

  const [{ id }, queueParams] = await Promise.all([params, searchParams]);
  const now = new Date();
  const [review, badges, holders, item] = await Promise.all([
    conflictReviewFor(id, now),
    getAdminNavBadges(seat),
    conflictHolders(),
    prisma.queueItem.findUnique({
      where: { subjectType_subjectId: { subjectType: "conflict", subjectId: id } },
      select: { assignee: { select: { fullName: true } } },
    }),
  ]);
  if (!review) notFound();

  const view = conflictView(review, {
    canResolve: can(seat.actor, "claim.resolve"),
    holders,
    assignee: item?.assignee?.fullName ?? null,
    now,
  });

  return (
    <AdminPage
      seat={seat}
      badges={badges}
      activeHref="/admin/queue"
      title={review.business.displayName}
      eyebrow={t("admin.conflict.title")}
      breadcrumb={<QueuePosition actor={seat.actor} subject={`conflict:${review.id}`} params={queueParams} skip />}
    >
      <ConflictWorkspace
        view={view}
        actions={{
          resolve: resolveConflictAction,
          escalate: escalateConflictAction,
          requestDocs: requestConflictDocumentsAction,
          logCall: logConflictCallAction,
          assign: assignConflictAction,
        }}
      />
    </AdminPage>
  );
}
