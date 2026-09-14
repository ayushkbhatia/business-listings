import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert } from "@/components/display";
import { Panel } from "@/components/structure";
import { can } from "@/lib/auth/can";
import { requireStaff } from "@/lib/auth/staff";
import { registerConfigured } from "@/lib/credentials/fta";
import { isCheckable } from "@/lib/credentials/kinds";
import { credentialReviewFor, OPEN_REVIEWS, submittedOf } from "@/lib/credentials/review";
import { formatDateTime, formatDuration, formatRelative } from "@/lib/format";
import { t } from "@/lib/i18n";
import { entryFor, queueHealth, refFor } from "@/lib/moderation/queue";
import { AdminPage, getAdminNavBadges } from "../../../../_shell";
import { QueuePosition, type QueueParams } from "../../position";
import { refetchRegisterAction, rejectCredentialAction, requestClearerDocumentAction, verifyCredentialAction } from "../actions";
import { CredentialDecision, RefetchButton } from "../CredentialDecision";
import { RegisterComparison } from "../RegisterComparison";
import { certificateView, comparisonView, decisionView } from "../view";
import { CredentialRail, UnlocksPanel } from "../panels";

/**
 * Board `4c-s` — review a credential. A register lookup, not a photo judgement.
 *
 * *Reviewing a product submission is a judgement about photographs and stock
 * claims, and two reviewers can reasonably disagree. This is a lookup with three
 * fields that either match or do not.* So the screen is a comparison and not a
 * document viewer: what they submitted against what the FTA register said, at a
 * time the screen states, with the verdict for each field and the entity
 * cross-check apart from the three. The certificate is one link away, for the
 * one rejection that is about the file.
 *
 * Only a credential the register could not settle reaches this screen from the
 * queue. The rest is reachable by URL and says why there is nothing to do: a
 * kind no register answers for (B1), a credential already decided, or one that
 * never entered review.
 */

export const dynamic = "force-dynamic";

export default async function RegisterCredentialReviewPage({
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
  const queueRef = refFor("register_credential", id);

  const [review, entry, badges, health] = await Promise.all([
    credentialReviewFor(id, now),
    entryFor(queueRef, now),
    getAdminNavBadges(seat),
    queueHealth(now),
  ]);
  if (!review) notFound();
  const { row, comparison, unlocks } = review;

  const checkable = isCheckable(row.kind);
  const open = row.review !== null && OPEN_REVIEWS.includes(row.review);
  const kindLabel = t(`credentials.kind.${row.kind}` as never);
  const view = comparisonView(comparison, submittedOf(row), now);
  const certificate = certificateView(row.document, `/admin/queue/credential/${row.id}/document`);
  const refetch = open && registerConfigured() ? <RefetchButton credentialId={row.id} refetch={refetchRegisterAction} /> : undefined;

  return (
    <AdminPage
      seat={seat}
      badges={badges}
      activeHref="/admin/queue"
      eyebrow={t("admin.credential_review.eyebrow", { kind: kindLabel })}
      title={row.business.displayName}
      breadcrumb={<QueuePosition actor={seat.actor} subject={queueRef} params={queueParams} skip />}
      meta={
        <Link
          href={`/b/${row.business.slug}`}
          className="text-caption text-muted underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
        >
          {t("admin.credential_review.storefront")}
        </Link>
      }
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-5">
          {!checkable ? (
            <Panel title={t("admin.credential_review.unverifiable.title")}>
              <p className="max-w-prose text-body-sm text-body">
                {t("admin.credential_review.unverifiable.body", { kind: kindLabel })}
              </p>
            </Panel>
          ) : (
            <>
              <Panel eyebrow={t("admin.credential_review.check_eyebrow")} title={kindLabel}>
                <div className="flex flex-col gap-4">
                  <p className="max-w-prose text-body-sm text-body">{t("admin.credential_review.check_body")}</p>
                  <RegisterComparison view={view} certificate={certificate} refetch={refetch} />
                </div>
              </Panel>

              {open ? (
                <>
                  <UnlocksPanel unlocks={unlocks} />
                  <Panel title={t("admin.review.decision_heading")}>
                    <div className="flex flex-col gap-4">
                      <p className="text-caption text-muted">
                        {[
                          t("admin.credential_review.waiting", {
                            waiting: formatDuration(Math.max(0, now.getTime() - (row.reviewOpenedAt ?? row.createdAt).getTime())),
                          }),
                          entry?.assignee?.name
                            ? t("admin.review.assigned_to", { name: entry.assignee.name })
                            : t("admin.queue.unassigned"),
                        ].join(" · ")}
                      </p>
                      {row.review === "more_info" && row.reviewNote && row.reviewedAt && (
                        <Alert tone="info">
                          {t("admin.credential_review.waiting_on_seller", {
                            when: formatRelative(row.reviewedAt, { now }),
                            note: row.reviewNote,
                          })}
                        </Alert>
                      )}
                      {row.review === "pending" && row.resubmittedAt && (
                        <Alert tone="info">
                          {t("admin.credential_review.resubmitted", { when: formatRelative(row.resubmittedAt, { now }) })}
                        </Alert>
                      )}
                      <CredentialDecision
                        credentialId={row.id}
                        decision={decisionView(comparison, row.document !== null)}
                        verify={verifyCredentialAction}
                        requestMore={requestClearerDocumentAction}
                        reject={rejectCredentialAction}
                      />
                    </div>
                  </Panel>
                </>
              ) : (
                <Panel title={t("admin.credential_review.decided.title")}>
                  <div className="flex flex-col gap-2 text-body-sm text-body">
                    <p>{decidedSentence(row)}</p>
                    {row.reviewNote && row.review !== "auto_verified" && row.review !== null && (
                      <p className="text-caption text-muted">{t("admin.credential_review.decided.note", { note: row.reviewNote })}</p>
                    )}
                    <p className="text-caption text-muted">
                      {health.medianMs === null || health.lastDecidedAt === null
                        ? t("admin.queue.empty_board.body_none")
                        : t("admin.queue.empty_board.body", {
                            time: formatDuration(health.medianMs),
                            when: formatRelative(health.lastDecidedAt, { now }),
                          })}
                    </p>
                  </div>
                </Panel>
              )}
            </>
          )}
        </div>

        <CredentialRail registerLive={registerConfigured()} />
      </div>
    </AdminPage>
  );
}

function decidedSentence(row: NonNullable<Awaited<ReturnType<typeof credentialReviewFor>>>["row"]): string {
  const who = row.reviewedBy?.fullName ?? t("admin.credential_review.decided.someone");
  switch (row.review) {
    case "verified":
      return t("admin.credential_review.decided.verified", { name: who, when: formatDateTime(row.reviewedAt!) });
    case "auto_verified":
      return t("admin.credential_review.decided.auto_verified", { when: formatDateTime(row.verifiedOn!) });
    case "rejected":
      return t("admin.credential_review.decided.rejected", {
        name: who,
        when: formatDateTime(row.reviewedAt!),
        reason: t(`admin.credential_review.reject.${row.rejectReason!}` as never),
      });
    default:
      return t("admin.credential_review.decided.never");
  }
}
