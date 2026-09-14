import Link from "next/link";
import { notFound } from "next/navigation";
import { StatusBadge } from "@/components/display";
import { KeyValuePanel, Panel } from "@/components/structure";
import { can } from "@/lib/auth/can";
import { requireStaff } from "@/lib/auth/staff";
import { prisma } from "@/lib/db/client";
import { AUTHORITY_EMIRATE } from "@/lib/ingest/sources";
import { formatDate } from "@/lib/format";
import { t } from "@/lib/i18n";
import { entryFor, refFor } from "@/lib/moderation/queue";
import { AdminPage, getAdminNavBadges } from "../../../../_shell";
import { approveQueueRef, rejectQueueRef } from "../../actions";
import { ChecksPanel } from "../../ChecksPanel";
import { DecisionForm } from "../../DecisionForm";
import { QueuePosition, type QueueParams } from "../../position";

/**
 * Board 4b — a branch published outside the emirate its licence covers.
 *
 * *"A branch outside a licensed emirate is a different judgement from a
 * description rewrite, and it is the one submission type that can put a
 * business in an emirate its licence does not cover."* The branch is already
 * live — board 3c keeps the supplier the authority on their own address, so
 * nothing waited — and this is the look after the fact. Approving records that
 * a person checked this emirate for this branch; rejecting takes it off the
 * directory with the reason the seller reads on their locations page. Moving
 * the branch again puts it back here.
 */

export const dynamic = "force-dynamic";

export default async function BranchReviewPage({
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
  const queueRef = refFor("location", id);

  const [branch, entry, decision, badges] = await Promise.all([
    prisma.location.findUnique({
      where: { id },
      select: {
        id: true,
        type: true,
        emirate: true,
        addressLine: true,
        published: true,
        publishedAt: true,
        createdAt: true,
        area: { select: { name: true } },
        business: {
          select: {
            displayName: true,
            slug: true,
            licenceNumber: true,
            licenceAuthority: true,
            locations: { where: { published: true }, select: { id: true, emirate: true } },
          },
        },
      },
    }),
    entryFor(queueRef, now),
    prisma.queueItem.findUnique({
      where: { subjectType_subjectId: { subjectType: "location", subjectId: id } },
      select: { decidedAt: true, decision: true, decisionReason: true, subjectVersion: true, decidedBy: { select: { fullName: true } } },
    }),
    getAdminNavBadges(seat),
  ]);
  if (!branch) notFound();

  const licensed = AUTHORITY_EMIRATE[branch.business.licenceAuthority as keyof typeof AUTHORITY_EMIRATE];
  const otherEmirates = new Set(branch.business.locations.map((location) => location.emirate)).size;

  return (
    <AdminPage
      seat={seat}
      badges={badges}
      activeHref="/admin/queue"
      title={branch.business.displayName}
      eyebrow={t("admin.branch_review.eyebrow")}
      breadcrumb={<QueuePosition actor={seat.actor} subject={queueRef} params={queueParams} />}
      meta={
        <Link href={`/b/${branch.business.slug}`} className="text-caption text-muted underline-offset-2 hover:underline">
          {t("admin.branch_review.storefront")}
        </Link>
      }
    >
      <div className="flex flex-col gap-[var(--gutter)]">
        <ChecksPanel entry={entry} now={now} />

        <Panel title={t("admin.branch_review.details")} padded={false}>
          <KeyValuePanel
            notProvidedLabel={t("table.not_provided")}
            entries={[
              { key: "type", label: t("admin.branch_review.type"), value: t(`locations.type.${branch.type}`) },
              { key: "where", label: t("admin.branch_review.where"), value: t("admin.branch_review.where_value", { area: branch.area.name, emirate: t(`emirate.${branch.emirate}`) }) },
              { key: "address", label: t("admin.branch_review.address"), value: branch.addressLine },
              {
                key: "licence",
                label: t("admin.branch_review.licence"),
                value: t("admin.branch_review.licence_value", {
                  authority: branch.business.licenceAuthority,
                  number: branch.business.licenceNumber,
                  emirate: licensed ? t(`emirate.${licensed}`) : branch.business.licenceAuthority,
                }),
              },
              { key: "spread", label: t("admin.branch_review.spread"), value: t("admin.branch_review.spread_value", { count: otherEmirates, n: otherEmirates }) },
              {
                key: "live",
                label: t("admin.branch_review.live"),
                value: branch.published
                  ? t("admin.branch_review.live_since", { date: formatDate(branch.publishedAt ?? branch.createdAt) })
                  : t("admin.branch_review.hidden"),
              },
            ]}
          />
        </Panel>

        <Panel title={t("admin.review.decision_heading")}>
          {entry ? (
            <DecisionForm
              requestId={branch.id}
              fields={{ ref: queueRef }}
              approve={approveQueueRef}
              reject={rejectQueueRef}
              note={t("admin.branch_review.note")}
            />
          ) : decision?.decidedAt ? (
            <div className="flex flex-col gap-2">
              <StatusBadge tone={decision.decision === "approved" ? "ok" : "bad"}>
                {t(decision.decision === "approved" ? "admin.branch_review.kept" : "admin.branch_review.taken_down")}
              </StatusBadge>
              <p className="max-w-prose text-body-sm text-body">{decision.decisionReason}</p>
              <p className="text-caption text-muted">
                {t("admin.claim_review.decided", {
                  date: formatDate(decision.decidedAt),
                  name: decision.decidedBy?.fullName ?? t("admin.run.someone"),
                })}
              </p>
            </div>
          ) : (
            <p className="text-body-sm text-body">{t("admin.branch_review.not_waiting")}</p>
          )}
        </Panel>
      </div>
    </AdminPage>
  );
}
