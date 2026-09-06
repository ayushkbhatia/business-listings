import { notFound } from "next/navigation";
import Link from "next/link";
import { requireStaff } from "@/lib/auth/staff";
import { can } from "@/lib/auth/can";
import { prisma } from "@/lib/db/client";
import { KeyValuePanel, Panel } from "@/components/structure";
import { formatDate, formatMonth } from "@/lib/format";
import { t } from "@/lib/i18n";
import { AdminPage, getAdminNavBadges } from "../../../../_shell";
import { DecisionForm } from "../../DecisionForm";
import { approveCredential, rejectCredential } from "../../actions";

/**
 * One credential, waiting to go on a storefront.
 *
 * The narrow decision, and the page says so at the top: not whether the
 * certificate is true — nothing here checks an ISO number against a registrar,
 * and the seller's own screen draws the line between `Verified by us` and
 * `Uploaded by you` precisely so this cannot be read as a check — but whether
 * the file is the document it says it is and fit to name on a public page.
 *
 * The file itself is behind a signed URL and is not linked from here yet, for
 * the same reason it is not linked from the seller's screen: these objects live
 * in a bucket with no public read at all. Reading them is handoff 4's own work.
 */
export const dynamic = "force-dynamic";

export default async function CredentialReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const seat = await requireStaff();
  if (!can(seat.actor, "queue.decide")) notFound();

  const { id } = await params;
  const [document, badges] = await Promise.all([
    prisma.document.findUnique({
      where: { id },
      select: {
        id: true,
        kind: true,
        filename: true,
        displayName: true,
        reference: true,
        validUntil: true,
        isPublic: true,
        reviewedAt: true,
        createdAt: true,
        business: { select: { displayName: true, slug: true, verificationTier: true } },
      },
    }),
    getAdminNavBadges(seat),
  ]);
  if (!document?.business) notFound();

  return (
    <AdminPage
      seat={seat}
      badges={badges}
      activeHref="/admin/queue"
      eyebrow={t("admin.queue.kind.document")}
      title={document.displayName ?? document.filename}
      meta={
        <Link
          href={`/b/${document.business.slug}`}
          className="text-caption text-muted underline-offset-2 hover:underline"
        >
          {document.business.displayName}
        </Link>
      }
    >
      <div className="flex flex-col gap-5">
        <Panel title={t("admin.queue.document.scope")}>
          <p className="max-w-prose text-body-sm text-body">
            {t("admin.queue.document.scope_body")}
          </p>
        </Panel>

        <Panel title={t("admin.queue.document.details")} padded={false}>
          <KeyValuePanel
            notProvidedLabel={t("table.not_provided")}
            entries={[
              { key: "name", label: t("verify_listing.field_name"), value: document.displayName },
              {
                key: "reference",
                label: t("verify_listing.field_reference"),
                value: document.reference,
                mono: true,
              },
              {
                key: "valid",
                label: t("verify_listing.field_valid_until"),
                value: document.validUntil ? formatMonth(document.validUntil) : undefined,
              },
              {
                key: "file",
                label: t("admin.queue.document.file"),
                value: document.filename,
                mono: true,
              },
              {
                key: "asked",
                label: t("admin.queue.document.asked"),
                value: formatDate(document.createdAt),
              },
            ]}
          />
        </Panel>

        {document.reviewedAt ? (
          <Panel title={t("admin.queue.document.decided")}>
            <p className="text-body-sm text-body">
              {t("admin.queue.document.decided_body", { when: formatDate(document.reviewedAt) })}
            </p>
          </Panel>
        ) : (
          <Panel title={t("admin.review.decision_heading")}>
            <DecisionForm
              requestId={document.id}
              approve={approveCredential}
              reject={rejectCredential}
              note={t("admin.queue.document.note")}
            />
          </Panel>
        )}
      </div>
    </AdminPage>
  );
}
