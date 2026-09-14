import { notFound } from "next/navigation";
import { Alert, StatusBadge } from "@/components/display";
import { KeyValuePanel, Panel } from "@/components/structure";
import { can } from "@/lib/auth/can";
import { requireStaff } from "@/lib/auth/staff";
import { prisma } from "@/lib/db/client";
import { formatCount, formatDate } from "@/lib/format";
import { t } from "@/lib/i18n";
import { entryFor, refFor } from "@/lib/moderation/queue";
import { AdminPage, getAdminNavBadges } from "../../../../_shell";
import { approveQueueRef, rejectQueueRef, requestDocsQueueRef } from "../../actions";
import { ChecksPanel } from "../../ChecksPanel";
import { DecisionForm } from "../../DecisionForm";
import { QueuePosition, type QueueParams } from "../../position";

/**
 * Board 4b — one claim, and the decision nobody could make before.
 *
 * Three things before the buttons, in the order a reviewer reads them: what
 * the machine already checked, what the register says against what the
 * claimant said, and the document itself. Approving claims the listing and
 * keeps the claimant's owner seat; rejecting takes that seat back; requesting a
 * document asks without deciding. None of the three moves the verification tier
 * or the licence expiry (B10).
 *
 * A claim that is part of an open conflict is not decided here — the conflict
 * screen settles both sides at once — and this page says so.
 */

export const dynamic = "force-dynamic";

export default async function ClaimReviewPage({
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
  const queueRef = refFor("claim", id);

  const [claim, entry, badges] = await Promise.all([
    prisma.claimSubmission.findUnique({
      where: { id },
      select: {
        id: true,
        route: true,
        phone: true,
        claimantName: true,
        claimantRole: true,
        statedLicenceNumber: true,
        statedLicenceExpiry: true,
        ocrLicenceNumber: true,
        ocrLicenceExpiry: true,
        ocrConfidence: true,
        createdAt: true,
        decidedAt: true,
        outcome: true,
        decisionReason: true,
        claimant: { select: { fullName: true, email: true, phone: true } },
        decidedBy: { select: { fullName: true } },
        document: { select: { filename: true, detectedKind: true } },
        conflictsAsA: { where: { resolvedAt: null }, select: { id: true } },
        conflictsAsB: { where: { resolvedAt: null }, select: { id: true } },
        business: {
          select: {
            id: true,
            displayName: true,
            tradeName: true,
            slug: true,
            licenceNumber: true,
            licenceAuthority: true,
            licenceExpiry: true,
            claimStatus: true,
            _count: { select: { reviews: true, recipients: true } },
          },
        },
      },
    }),
    entryFor(queueRef, now),
    getAdminNavBadges(seat),
  ]);
  if (!claim) notFound();

  const conflictId = claim.conflictsAsA[0]?.id ?? claim.conflictsAsB[0]?.id ?? null;
  const decided = claim.decidedAt !== null;

  return (
    <AdminPage
      seat={seat}
      badges={badges}
      activeHref="/admin/queue"
      title={claim.business.displayName}
      eyebrow={t("admin.claim_review.eyebrow")}
      breadcrumb={<QueuePosition actor={seat.actor} subject={queueRef} params={queueParams} />}
      meta={
        <span className="text-caption text-muted">
          {t("admin.claim_review.meta", {
            name: claim.claimantName ?? claim.claimant.fullName ?? t("admin.claim_review.unnamed"),
            date: formatDate(claim.createdAt),
          })}
        </span>
      }
    >
      <div className="flex flex-col gap-[var(--gutter)]">
        {conflictId && (
          <Alert
            tone="info"
            action={
              <a className="text-body-sm text-moss underline underline-offset-2" href={`/admin/queue/conflict/${conflictId}`}>
                {t("admin.claim_review.open_conflict")}
              </a>
            }
          >
            {t("admin.claim_review.in_conflict")}
          </Alert>
        )}

        <ChecksPanel entry={entry} now={now} />

        <div className="grid gap-[var(--gutter)] lg:grid-cols-2">
          <Panel title={t("admin.claim_review.register_title")} padded={false}>
            <KeyValuePanel
              columns={1}
              notProvidedLabel={t("table.not_provided")}
              entries={[
                // The reviewer matches the document against the legal name, so this is the licence's own.
                { key: "name", label: t("admin.claim_review.legal_name"), value: claim.business.tradeName /* licence-locked */ },
                { key: "authority", label: t("admin.claim_review.authority"), value: claim.business.licenceAuthority, mono: true },
                { key: "licence", label: t("admin.claim_review.licence"), value: claim.business.licenceNumber, mono: true },
                { key: "expiry", label: t("admin.claim_review.expiry"), value: formatDate(claim.business.licenceExpiry) },
                {
                  key: "history",
                  label: t("admin.claim_review.history"),
                  value: t("admin.claim_review.history_value", {
                    reviews: formatCount(claim.business._count.reviews),
                    enquiries: formatCount(claim.business._count.recipients),
                  }),
                },
              ]}
            />
          </Panel>

          <Panel title={t("admin.claim_review.claimant_title")} padded={false}>
            <KeyValuePanel
              columns={1}
              notProvidedLabel={t("table.not_provided")}
              entries={[
                { key: "name", label: t("admin.claim_review.named_on_document"), value: claim.claimantName ?? undefined },
                {
                  key: "role",
                  label: t("admin.claim_review.role"),
                  value: claim.claimantRole ? t(`verify.role.${claim.claimantRole}`) : undefined,
                },
                { key: "account", label: t("admin.claim_review.account"), value: claim.claimant.fullName ?? claim.claimant.email ?? claim.claimant.phone ?? undefined },
                { key: "route", label: t("admin.conflict.route"), value: t(`admin.conflict.route.${claim.route}`) },
                ...(claim.route === "phone_callback"
                  ? [{ key: "phone", label: t("admin.conflict.number"), value: claim.phone ?? undefined, mono: true }]
                  : [
                      { key: "stated", label: t("admin.claim_review.stated_licence"), value: claim.statedLicenceNumber ?? undefined, mono: true },
                      { key: "scanned", label: t("admin.claim_review.scanned_licence"), value: claim.ocrLicenceNumber ?? undefined, mono: true },
                      {
                        key: "stated_expiry",
                        label: t("admin.claim_review.stated_expiry"),
                        value: claim.statedLicenceExpiry ? formatDate(claim.statedLicenceExpiry) : undefined,
                      },
                    ]),
              ]}
            />
            {claim.document && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3">
                <span className="flex flex-wrap items-center gap-2 text-body-sm text-body">
                  <span className="font-mono">{claim.document.filename}</span>
                  {claim.document.detectedKind && claim.document.detectedKind !== "trade_licence" && (
                    <StatusBadge tone="warn" size="sm">
                      {claim.document.detectedKind === "unknown"
                        ? t("admin.claim_review.unread")
                        : t("admin.claim_review.reads_as", { document: t(`verify.document.${claim.document.detectedKind}` as never) })}
                    </StatusBadge>
                  )}
                </span>
                <a
                  href={`/admin/queue/claim/${claim.id}/document`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-body-sm text-moss underline underline-offset-2"
                >
                  {t("admin.claim_review.open_document")}
                </a>
              </div>
            )}
          </Panel>
        </div>

        <Panel title={t("admin.review.decision_heading")}>
          {decided ? (
            <div className="flex flex-col gap-2">
              <StatusBadge tone={claim.outcome === "approved" ? "ok" : "bad"}>
                {t(`admin.claim_review.outcome.${claim.outcome ?? "rejected"}`)}
              </StatusBadge>
              <p className="max-w-prose text-body-sm text-body">{claim.decisionReason}</p>
              <p className="text-caption text-muted">
                {t("admin.claim_review.decided", {
                  date: formatDate(claim.decidedAt!),
                  name: claim.decidedBy?.fullName ?? t("admin.run.someone"),
                })}
              </p>
            </div>
          ) : conflictId ? (
            <p className="text-body-sm text-body">{t("admin.claim_review.in_conflict")}</p>
          ) : (
            <DecisionForm
              requestId={claim.id}
              fields={{ ref: queueRef }}
              approve={approveQueueRef}
              reject={rejectQueueRef}
              {...(claim.route === "licence_upload" ? { requestDocs: requestDocsQueueRef } : {})}
              note={t("admin.claim_review.note")}
            />
          )}
        </Panel>
      </div>
    </AdminPage>
  );
}
