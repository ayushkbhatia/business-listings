import Link from "next/link";
import { notFound } from "next/navigation";
import { KeyValuePanel, Panel } from "@/components/structure";
import { StatusBadge, Tag } from "@/components/display";
import { requireStaff } from "@/lib/auth/staff";
import { can } from "@/lib/auth/can";
import { formatDate, formatDateTime, formatDuration } from "@/lib/format";
import { t } from "@/lib/i18n";
import { disputeDetail } from "@/lib/reports/service";
import { slaMsFor, slaStateOf, slaTone } from "@/lib/reports/sla";
import { REVIEW_DISPUTE } from "@/lib/reports/taxonomy";
import { AdminPage, getAdminNavBadges } from "../../../../_shell";
import { decideDispute } from "../../actions";
import { DecideDispute } from "./DecideDispute";

/**
 * Board 4h `B5` and board 11c `B5` — a review dispute, on its own screen.
 *
 * A second route, one entity each. `/admin/reports/:id` answers for a
 * `SupplierReport` and this for a `ReviewDispute`, because the two rows are
 * different in every field: one is filed against a business on a free-text
 * subject and resolves to one of three outcomes; the other is filed by a
 * business about a review, on one of four fixed grounds, and resolves to one of
 * two. What they share is the frame — the same breadcrumb back into the same
 * filtered queue, the same audit promise, the same owner column.
 *
 * ## The one fact that most often answers the case
 *
 * A `no_traceable_enquiry` dispute against a review attached to a quote this
 * seller's own account accepted has answered itself, and a moderator should not
 * have to open two other screens to find that out. Derived from the enquiry
 * rather than stored on the review.
 */

export const dynamic = "force-dynamic";

export default async function DisputeDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const seat = await requireStaff();
  if (!can(seat.actor, "report.resolve")) notFound();

  const [{ id }, query] = await Promise.all([params, searchParams]);
  const [detail, badges] = await Promise.all([disputeDetail(id), getAdminNavBadges(seat)]);
  if (!detail) notFound();

  const { dispute, incentiveFinding, fromAcceptedQuote } = detail;
  const supplier = dispute.business.displayName;
  const now = new Date();
  const waitingMs = Math.max(
    0,
    (dispute.resolvedAt ?? now).getTime() - dispute.createdAt.getTime(),
  );
  const slaMs = slaMsFor(REVIEW_DISPUTE);
  const sla = slaStateOf(waitingMs, slaMs);

  const back = ((): string => {
    const carried = new URLSearchParams();
    for (const key of ["type", "mine", "escalated"]) {
      const value = query[key];
      if (typeof value === "string") carried.set(key, value);
    }
    const text = carried.toString();
    return text ? `/admin/reports?${text}` : "/admin/reports";
  })();

  return (
    <AdminPage
      seat={seat}
      badges={badges}
      activeHref="/admin/reports"
      title={t("admin.dispute_detail.title", { supplier })}
      eyebrow={t("admin.reports.type.review_dispute")}
      breadcrumb={
        <Link
          href={back}
          className="rounded-tag text-caption text-muted underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
        >
          {t("admin.report_detail.back")}
        </Link>
      }
      meta={
        dispute.outcome ? (
          <StatusBadge tone="neutral">
            {t("admin.dispute_detail.resolved", {
              outcome: t(
                `reviews.dispute.outcome.${dispute.outcome}` as "reviews.dispute.outcome.upheld",
              ),
            })}
          </StatusBadge>
        ) : (
          <StatusBadge tone={slaTone(sla)}>
            {sla === "late"
              ? t("admin.reports.sla.late", { sla: formatDuration(slaMs) })
              : sla === "due"
                ? t("admin.reports.sla.due", { sla: formatDuration(slaMs) })
                : t("admin.reports.sla.ok", { sla: formatDuration(slaMs) })}
          </StatusBadge>
        )
      }
    >
      <div className="grid items-start gap-[var(--gutter)] board:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <div className="flex flex-col gap-[var(--gutter)]">
          <Panel
            title={t("admin.dispute_detail.case")}
            description={t(`moderation.ground.${dispute.ground}` as "moderation.ground.abuse")}
          >
            <p className="max-w-prose whitespace-pre-line text-body text-prose">{dispute.detail}</p>
            <div className="mt-3">
              <KeyValuePanel
                columns={2}
                notProvidedLabel={t("table.not_provided")}
                entries={[
                  {
                    key: "raised",
                    label: t("admin.dispute_detail.raised"),
                    value: formatDateTime(dispute.createdAt),
                  },
                  {
                    key: "by",
                    label: t("admin.dispute_detail.raised_by"),
                    value: dispute.raisedBy.fullName ?? undefined,
                  },
                  {
                    key: "owner",
                    label: t("admin.report_detail.owner"),
                    value: dispute.assignee?.fullName ?? t("admin.reports.unassigned"),
                  },
                  ...(dispute.outcome
                    ? [
                        {
                          key: "reason",
                          label: t("admin.report_detail.outcome_reason"),
                          value: dispute.outcomeReason ?? undefined,
                          wide: true,
                        },
                        {
                          key: "decided",
                          label: t("admin.report_detail.decided_by"),
                          value: dispute.decidedBy?.fullName ?? undefined,
                        },
                      ]
                    : []),
                ]}
              />
            </div>
          </Panel>

          <Panel title={t("admin.dispute_detail.review")}>
            <p className="flex flex-wrap items-baseline gap-2">
              <Tag mono>{`${dispute.review.overall}/5`}</Tag>
              <span className="text-caption text-muted">
                {t("admin.report_detail.review_by", {
                  buyer: dispute.review.buyer.fullName ?? t("admin.report_evidence.buyer"),
                  date: formatDate(dispute.review.createdAt),
                })}
              </span>
              {dispute.review.removedAt && (
                <StatusBadge tone="bad" size="sm">
                  {t("admin.report_detail.review_removed")}
                </StatusBadge>
              )}
              {dispute.review.heldAt && !dispute.review.removedAt && (
                <StatusBadge tone="warn" size="sm">
                  {t("admin.report_detail.review_held")}
                </StatusBadge>
              )}
            </p>
            <p className="mt-2 max-w-prose whitespace-pre-line text-body-sm text-prose">
              {dispute.review.body}
            </p>

            {/*
               The provenance line. On the `no traceable enquiry` ground this is
               usually the whole answer, and it is derived from the enquiry
               rather than stored — the same read board 1m badges the buyer with.
            */}
            <p className="mt-3 border-t border-line pt-3 text-caption text-body">
              {fromAcceptedQuote
                ? t("admin.disputes.from_accepted_quote")
                : t("admin.disputes.from_confirmed_enquiry")}
              <span className="ms-2 font-mono text-eyebrow uppercase text-faint">
                {dispute.review.enquiry.ref}
              </span>
            </p>

            {dispute.review.sellerReply && (
              <div className="mt-3 border-t border-line pt-3">
                <p className="font-mono text-eyebrow uppercase tracking-eyebrow text-faint">
                  {t("admin.report_detail.seller_reply", { supplier })}
                </p>
                <p className="mt-1 max-w-prose whitespace-pre-line text-body-sm text-prose">
                  {dispute.review.replyRemovedAt
                    ? t("admin.report_detail.reply_removed_line")
                    : dispute.review.sellerReply}
                </p>
              </div>
            )}
          </Panel>

          {/*
             Board 11c `B6`, read where `B9` asks for it. A seller's dispute and
             our own finding about the same review are two records, and a
             moderator deciding one should be able to see the other.
          */}
          {incentiveFinding && (
            <Panel title={t("admin.dispute_detail.incentive")}>
              <p className="max-w-prose text-body-sm text-prose">{incentiveFinding.detail}</p>
              <p className="mt-1 text-caption text-muted">
                {t("admin.dispute_detail.incentive_when", {
                  date: formatDate(incentiveFinding.createdAt),
                })}
              </p>
            </Panel>
          )}
        </div>

        <aside className="flex flex-col gap-[var(--gutter)]" aria-label={t("admin.report_detail.rail_label")}>
          <Panel
            title={t("admin.report_detail.decide")}
            description={t("admin.dispute_detail.decide_note")}
          >
            {dispute.outcome ? (
              <p className="text-body-sm text-body">
                {t("admin.dispute_detail.already_decided", {
                  outcome: t(
                    `reviews.dispute.outcome.${dispute.outcome}` as "reviews.dispute.outcome.upheld",
                  ),
                  when: formatDate(dispute.resolvedAt ?? dispute.createdAt),
                })}
              </p>
            ) : (
              <DecideDispute
                disputeId={dispute.id}
                mayUphold={can(seat.actor, "review.remove")}
                decide={decideDispute}
              />
            )}
          </Panel>

          <Panel title={t("admin.report_detail.elsewhere")}>
            <ul className="flex flex-col gap-2">
              <li>
                <Link
                  href={`/b/${dispute.business.slug}/reviews`}
                  className="rounded-tag text-body-sm text-moss underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
                >
                  {t("admin.dispute_detail.open_reviews")}
                </Link>
              </li>
              <li>
                <Link
                  href={`/admin/audit?subject=ReviewDispute:${dispute.id}`}
                  className="rounded-tag text-body-sm text-moss underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
                >
                  {t("admin.report_detail.audit_link")}
                </Link>
              </li>
            </ul>
          </Panel>
        </aside>
      </div>
    </AdminPage>
  );
}
