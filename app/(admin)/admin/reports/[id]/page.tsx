import Link from "next/link";
import { notFound } from "next/navigation";
import { KeyValuePanel, Panel } from "@/components/structure";
import { StatusBadge, Tag } from "@/components/display";
import { requireStaff } from "@/lib/auth/staff";
import { can } from "@/lib/auth/can";
import { formatCount, formatDate, formatDateTime, formatDuration } from "@/lib/format";
import { t } from "@/lib/i18n";
import { reportDetail, reportEvidence } from "@/lib/reports/service";
import { slaMsFor, slaStateOf, slaTone } from "@/lib/reports/sla";
import { AdminPage, getAdminNavBadges } from "../../../_shell";
import { duplicate, escalate, removeSellerReply, resolve } from "../actions";
import { DecidePanel, MarkDuplicate } from "./Decide";
import { AcceptedRecord } from "./_record";

/**
 * Board 4h `B5` — `/admin/reports/:id`, the destination `Investigate` did not
 * have.
 *
 * The board's primary action on its oldest, reddest row went nowhere: `4b` has
 * `4c` at `/admin/queue/:id`, and this route existed but answered for exactly
 * one report kind — the one carrying an enquiry. Every other row 404'd.
 *
 * It answers for all of them now: the claim, the measurement, who filed it,
 * what else has been said about this business and this field, the rest of the
 * work item, and — where the report is about one — the review or the accepted
 * record. The decision is taken here and goes through the same `resolveReport`
 * the queue has always used, so there is still one place a report is closed and
 * one audit trail for it.
 *
 * ## Suspension and closure are links, not buttons
 *
 * `business.suspend` and `business.close` are ops-lead capabilities with their
 * own reason codes, their own audit entries and their own appeal paths, on
 * `/admin/businesses`. `12c` refused to give either a second route here and
 * wrote down why. What this screen does instead is escalate, and name where the
 * decision lives.
 */

export const dynamic = "force-dynamic";

export default async function ReportDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const seat = await requireStaff();
  if (!can(seat.actor, "report.resolve")) notFound();

  const [{ id }, query] = await Promise.all([params, searchParams]);
  const [detail, badges] = await Promise.all([reportDetail(id), getAdminNavBadges(seat)]);
  if (!detail) notFound();

  const { report, priors, group, duplicatesClosed } = detail;
  const supplier = report.subjectBusiness.displayName;
  const now = new Date();
  const waitingMs = Math.max(
    0,
    (report.resolvedAt ?? now).getTime() - report.createdAt.getTime(),
  );
  const slaMs = slaMsFor(report.kind);
  const sla = slaStateOf(waitingMs, slaMs);

  /* The accepted record, where there is one. Board `7c` `B8`, and `B12`. */
  const evidence = report.enquiryId ? await reportEvidence(report.id) : null;

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
      title={t("admin.report_detail.title", { supplier })}
      eyebrow={t(`admin.reports.type.${report.kind}` as "admin.reports.type.closed")}
      breadcrumb={
        <Link
          href={back}
          className="rounded-tag text-caption text-muted underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
        >
          {t("admin.report_detail.back")}
        </Link>
      }
      meta={
        <span className="flex flex-wrap items-center gap-2">
          {report.outcome ? (
            <StatusBadge tone="neutral">
              {t("admin.report_detail.resolved", {
                outcome: t(
                  `admin.reports.outcome.${report.outcome}` as "admin.reports.outcome.upheld",
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
          )}
          {report.escalatedAt && (
            <StatusBadge tone="warn">{t("admin.reports.escalated")}</StatusBadge>
          )}
          {report.subjectBusiness.suspendedAt && (
            <StatusBadge tone="bad">{t("admin.reports.suspended")}</StatusBadge>
          )}
        </span>
      }
    >
      <div className="grid items-start gap-[var(--gutter)] board:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <div className="flex flex-col gap-[var(--gutter)]">
          <Panel title={t("admin.report_detail.what")}>
            {/*
               The measurement first, in mono, exactly as the queue row carries
               it. A moderator who clicked the row read this line to get here.
            */}
            {report.evidence && (
              <p className="font-mono text-eyebrow uppercase tracking-eyebrow text-body">
                {report.evidence}
              </p>
            )}
            <p className="mt-1 max-w-prose whitespace-pre-line text-body text-prose">
              {report.detail ?? t("admin.reports.no_claim")}
            </p>

            <div className="mt-3">
              <KeyValuePanel
                columns={2}
                notProvidedLabel={t("table.not_provided")}
                entries={[
                  {
                    key: "filed",
                    label: t("admin.report_detail.filed"),
                    value: formatDateTime(report.createdAt),
                  },
                  {
                    key: "reporter",
                    label: t("admin.report_detail.reporter"),
                    value: report.detector
                      ? t(
                          `admin.reports.detector.${report.detector}` as "admin.reports.detector.shared_phone",
                        )
                      : (report.reporter?.fullName ?? t("admin.reports.reporter.public")),
                  },
                  {
                    key: "field",
                    label: t("admin.report_detail.field"),
                    value: report.subjectField ?? undefined,
                  },
                  {
                    key: "owner",
                    /*
                       "Nobody" rather than the panel's "Not provided". An
                       unassigned report is not a field somebody failed to fill
                       in; it is a row nobody has taken.
                    */
                    label: t("admin.report_detail.owner"),
                    value: report.assignee?.fullName ?? t("admin.reports.unassigned"),
                  },
                  ...(report.enquiry
                    ? [
                        {
                          key: "enquiry",
                          label: t("admin.report_detail.enquiry"),
                          value: report.enquiry.ref,
                          mono: true,
                        },
                      ]
                    : []),
                  ...(report.outcome
                    ? [
                        {
                          key: "reason",
                          label: t("admin.report_detail.outcome_reason"),
                          value: report.outcomeReason ?? undefined,
                          wide: true,
                        },
                        {
                          key: "decided",
                          label: t("admin.report_detail.decided_by"),
                          value: report.resolvedBy?.fullName ?? undefined,
                        },
                      ]
                    : []),
                  ...(report.escalatedAt
                    ? [
                        {
                          key: "escalation",
                          label: t("admin.report_detail.escalation_reason"),
                          value: report.escalationReason ?? undefined,
                          wide: true,
                        },
                      ]
                    : []),
                ]}
              />
            </div>
          </Panel>

          {/*
             The rest of the work item (`B6`). Three buyers reporting one
             telephone number is one decision and three records, and a moderator
             taking that decision should read all three before they take it.
          */}
          {group.length > 0 && (
            <Panel
              title={t("admin.report_detail.group")}
              description={t("admin.report_detail.group_note", {
                count: formatCount(group.length + 1),
              })}
            >
              <ul className="flex flex-col">
                {group.map((row) => (
                  <li
                    key={row.id}
                    className="flex flex-col gap-0.5 border-t border-line py-2 first:border-t-0"
                  >
                    <span className="flex flex-wrap items-baseline gap-2">
                      <span className="text-body-sm text-ink">
                        {row.detector
                          ? t(
                              `admin.reports.detector.${row.detector}` as "admin.reports.detector.shared_phone",
                            )
                          : (row.reporter?.fullName ?? t("admin.reports.reporter.public"))}
                      </span>
                      <span className="font-mono text-eyebrow uppercase text-faint">
                        {formatDate(row.createdAt)}
                      </span>
                    </span>
                    <span className="max-w-prose text-caption text-muted">{row.detail ?? "—"}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {/* Board `1m` and `11c`: the words a review-shaped report is about. */}
          {report.review && (
            <Panel title={t("admin.report_detail.review")}>
              <p className="flex flex-wrap items-baseline gap-2">
                <Tag mono>{`${report.review.overall}/5`}</Tag>
                <span className="text-caption text-muted">
                  {t("admin.report_detail.review_by", {
                    buyer: report.review.buyer.fullName ?? t("admin.report_evidence.buyer"),
                    date: formatDate(report.review.createdAt),
                  })}
                </span>
                {report.review.removedAt && (
                  <StatusBadge tone="bad" size="sm">
                    {t("admin.report_detail.review_removed")}
                  </StatusBadge>
                )}
                {report.review.heldAt && !report.review.removedAt && (
                  <StatusBadge tone="warn" size="sm">
                    {t("admin.report_detail.review_held")}
                  </StatusBadge>
                )}
              </p>
              <p className="mt-2 max-w-prose whitespace-pre-line text-body-sm text-prose">
                {report.review.body}
              </p>
              {report.review.sellerReply && (
                <div className="mt-3 border-t border-line pt-3">
                  <p className="font-mono text-eyebrow uppercase tracking-eyebrow text-faint">
                    {t("admin.report_detail.seller_reply", { supplier })}
                  </p>
                  <p className="mt-1 max-w-prose whitespace-pre-line text-body-sm text-prose">
                    {report.review.replyRemovedAt
                      ? t("admin.report_detail.reply_removed_line")
                      : report.review.sellerReply}
                  </p>
                </div>
              )}
            </Panel>
          )}

          {evidence && <AcceptedRecord evidence={evidence} supplier={supplier} />}
        </div>

        <aside className="flex flex-col gap-[var(--gutter)]" aria-label={t("admin.report_detail.rail_label")}>
          <Panel
            title={t("admin.report_detail.decide")}
            description={t("admin.report_detail.decide_note")}
          >
            {report.outcome ? (
              <p className="text-body-sm text-body">
                {t("admin.report_detail.already_decided", {
                  outcome: t(
                    `admin.reports.outcome.${report.outcome}` as "admin.reports.outcome.upheld",
                  ),
                  when: formatDate(report.resolvedAt ?? report.createdAt),
                })}
              </p>
            ) : (
              <DecidePanel
                reportId={report.id}
                reviewId={report.reviewId}
                hasRemovableReply={Boolean(
                  report.review?.sellerReply && !report.review.replyRemovedAt,
                )}
                escalated={report.escalatedAt !== null}
                alsoCloses={group.length}
                mayRemoveReply={can(seat.actor, "review.remove")}
                resolve={resolve}
                escalate={escalate}
                removeSellerReply={removeSellerReply}
              />
            )}
          </Panel>

          <Panel
            title={t("admin.report_detail.history")}
            description={t("admin.report_detail.history_note")}
          >
            <dl className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-body-sm text-body">{t("admin.report_detail.priors_field")}</dt>
                <dd className="font-mono text-body-sm tabular-nums text-ink">
                  {formatCount(priors.onField)}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-body-sm text-body">
                  {t("admin.report_detail.priors_business")}
                </dt>
                <dd className="font-mono text-body-sm tabular-nums text-ink">
                  {formatCount(priors.onBusiness)}
                </dd>
              </div>
              {duplicatesClosed > 0 && (
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-body-sm text-body">
                    {t("admin.report_detail.closed_with_it")}
                  </dt>
                  <dd className="font-mono text-body-sm tabular-nums text-ink">
                    {formatCount(duplicatesClosed)}
                  </dd>
                </div>
              )}
            </dl>
            <Link
              href={`/admin/audit?subject=SupplierReport:${report.id}`}
              className="mt-3 inline-block rounded-tag text-caption text-moss underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
            >
              {t("admin.report_detail.audit_link")}
            </Link>
          </Panel>

          {/*
             Where the two severe decisions actually live. Links rather than
             controls: `business.suspend` and `business.close` are ops-lead
             capabilities with their own reason codes and appeal paths, and a
             button here would be a second route that keeps none of that.
          */}
          <Panel
            title={t("admin.report_detail.elsewhere")}
            description={t("admin.report_detail.elsewhere_note")}
          >
            <ul className="flex flex-col gap-2">
              <li>
                <Link
                  href={`/admin/businesses/${report.subjectBusiness.id}`}
                  className="rounded-tag text-body-sm text-moss underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
                >
                  {t("admin.report_detail.open_account", { supplier })}
                </Link>
              </li>
              <li>
                <Link
                  href={`/b/${report.subjectBusiness.slug}`}
                  className="rounded-tag text-body-sm text-moss underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
                >
                  {t("admin.report_detail.open_listing")}
                </Link>
              </li>
            </ul>
            {report.subjectBusiness.closureRequestedAt && (
              <p className="mt-2 text-caption text-muted">
                {t("admin.report_detail.closing_already")}
              </p>
            )}
          </Panel>

          {!report.outcome && (
            <Panel
              title={t("admin.report_detail.duplicate")}
              description={t("admin.report_detail.duplicate_note")}
            >
              <MarkDuplicate reportId={report.id} duplicate={duplicate} />
            </Panel>
          )}
        </aside>
      </div>
    </AdminPage>
  );
}
