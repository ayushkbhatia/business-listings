import { notFound } from "next/navigation";
import { Card, KeyValuePanel, Panel } from "@/components/structure";
import { Alert, StatusBadge } from "@/components/display";
import { requireStaff } from "@/lib/auth/staff";
import { can } from "@/lib/auth/can";
import { conflictFor } from "@/lib/onboarding/conflict";
import { formatCount, formatDate } from "@/lib/format";
import { t } from "@/lib/i18n";
import { AdminPage, getAdminNavBadges } from "../../../../_shell";
import { ResolutionForm } from "./ResolutionForm";
import { resolve } from "../../actions";
import { ChecksPanel } from "../../ChecksPanel";
import { QueuePosition, type QueueParams } from "../../position";
import { entryFor, refFor } from "@/lib/moderation/queue";

/**
 * Board 4c, the conflicting-claim half — two licences, one premises.
 *
 * Both sides on screen at once, with the evidence each of them submitted, and
 * three numbers above the decision:
 *
 *   - **buyers waiting**, which is what the delay costs
 *   - **reviews** and **enquiries** on the listing, which is what both parties
 *     are actually asking about when they ask what happens if they lose
 *
 * The second of those is stated in words rather than left to be inferred:
 * none of the four outcomes touches the history. A supplier's first fear on
 * claiming is that claiming resets them, and the second is that losing a
 * dispute deletes them. Neither happens, and the screen says so where the
 * decision is made rather than in a policy page.
 *
 * `claim.resolve` is ops lead alone. A moderator reaching this URL gets a 404 —
 * they can approve and reject listing edits all day and cannot decide who owns
 * a business.
 */

export const dynamic = "force-dynamic";

export default async function ConflictPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<QueueParams>;
}) {
  const seat = await requireStaff();
  if (!can(seat.actor, "claim.resolve")) notFound();

  const [{ id }, queueParams] = await Promise.all([params, searchParams]);
  const now = new Date();
  const queueRef = refFor("conflict", id);
  const [conflict, entry, badges] = await Promise.all([conflictFor(id), entryFor(queueRef, now), getAdminNavBadges(seat)]);
  if (!conflict) notFound();

  const ageDays = conflict.ageDays;
  const settled = conflict.resolvedAt !== null;

  const side = (
    heading: string,
    claim: typeof conflict.submissionA,
  ) => (
    <Card>
      <h2 className="text-body-sm font-medium text-ink">{heading}</h2>
      <div className="mt-2">
        <KeyValuePanel
          columns={1}
          notProvidedLabel={t("table.not_provided")}
          entries={[
            {
              key: "name",
              label: t("admin.conflict.claimant"),
              value: claim.claimant.fullName ?? undefined,
            },
            {
              key: "route",
              label: t("admin.conflict.route"),
              value: t(`admin.conflict.route.${claim.route}` as never),
            },
            ...(claim.document
              ? [{ key: "doc", label: t("admin.conflict.evidence"), value: claim.document.filename, mono: true }]
              : []),
            ...(claim.phone ? [{ key: "phone", label: t("admin.conflict.number"), value: claim.phone, mono: true }] : []),
            {
              key: "when",
              label: t("admin.conflict.submitted"),
              value: formatDate(claim.createdAt),
            },
          ]}
        />
      </div>
    </Card>
  );

  return (
    <AdminPage
      seat={seat}
      badges={badges}
      activeHref="/admin/queue"
      title={conflict.business.displayName}
      eyebrow={t("admin.conflict.title")}
      breadcrumb={<QueuePosition actor={seat.actor} subject={queueRef} params={queueParams} />}
      meta={
        <span className="flex flex-wrap items-center gap-3 text-caption text-muted">
          <span className="font-mono text-eyebrow tabular-nums">
            {t("admin.queue.age_days", { days: String(ageDays) })}
          </span>
          <span className={conflict.buyersWaiting > 0 ? "text-warn-ink" : undefined}>
            {conflict.buyersWaiting > 0
              ? t("admin.review.buyers_waiting", {
                  count: formatCount(conflict.buyersWaiting),
                })
              : t("admin.review.no_buyers_waiting")}
          </span>
        </span>
      }
    >
      <div className="flex flex-col gap-[var(--gutter)]">
        {/*
          Stated before the options, not after. It is the answer to the question
          both parties are asking, and the reason none of the four is as
          destructive as it looks.
        */}
        <ChecksPanel entry={entry} now={now} />

        <Alert tone="info">
          {t("admin.conflict.preserved", {
            reviews: formatCount(conflict.preserved.reviews),
            enquiries: formatCount(conflict.preserved.enquiries),
          })}
        </Alert>

        <div className="grid gap-[var(--gutter)] md:grid-cols-2">
          {side(t("admin.conflict.heading_a"), conflict.submissionA)}
          {side(t("admin.conflict.heading_b"), conflict.submissionB)}
        </div>

        <Panel title={t("admin.review.decision_heading")}>
          {settled ? (
            <div className="flex flex-col gap-2">
              <StatusBadge tone="ok">
                {t(`admin.conflict.${conflict.resolution}` as never)}
              </StatusBadge>
              <p className="max-w-prose text-body-sm text-body">{conflict.reason}</p>
            </div>
          ) : (
            <ResolutionForm conflictId={conflict.id} resolve={resolve} />
          )}
        </Panel>
      </div>
    </AdminPage>
  );
}
