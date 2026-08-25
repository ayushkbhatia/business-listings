import { Alert } from "@/components/display";
import { prisma } from "@/lib/db/client";
import { VerificationLadder } from "@/components/domain";
import { TIERS } from "@/components/domain/verification";
import { Panel } from "@/components/structure";
import { formatDate } from "@/lib/format";
import { t } from "@/lib/i18n";
import { getNavBadges, requireSellerSeat, SellerPage } from "../_shell";
import { deleteDocument, recordDocument, signDocumentUpload } from "./actions";
import { DocumentUpload } from "./DocumentUpload";

/**
 * Board 3e — the verification ladder and the documents behind it.
 *
 * Read-only about the tier, on purpose and visibly. CLAUDE.md non-negotiable 2:
 * `verificationTier` is writable only by an `ops_lead`, with no API path and no
 * seller-editable field. This page says so out loud rather than only being
 * silent about it — a seller who cannot find the control looks for it, and the
 * sentence is the answer.
 */
export const metadata = { title: "Verification" };
export const dynamic = "force-dynamic";

export default async function VerificationPage() {
  const seat = await requireSellerSeat();

  const [business, documents, badges] = await Promise.all([
    prisma.business.findUniqueOrThrow({
      where: { id: seat.businessId },
      select: {
        verificationTier: true,
        verifiedAt: true,
        visitedAt: true,
        licenceExpiry: true,
      },
    }),
    prisma.document.findMany({
      where: { businessId: seat.businessId },
      orderBy: { createdAt: "desc" },
      select: { id: true, kind: true, filename: true, createdAt: true },
    }),
    getNavBadges(seat.businessId),
  ]);

  const now = new Date();
  const licenceExpired = business.licenceExpiry < now;

  return (
    <SellerPage
      seat={seat}
      badges={badges}
      activeHref="/dashboard/verification"
      eyebrow={t("verify_listing.eyebrow")}
      title={t("verify_listing.title")}
    >
      <div className="flex flex-col gap-5">
        <p className="max-w-prose text-body-sm text-muted">{t("verify_listing.intro")}</p>

        {licenceExpired && (
          <Alert tone="warn" live="polite" fix={t("verify_listing.licence_expired_fix")}>
            {t("verify_listing.licence_expired", { when: formatDate(business.licenceExpiry) })}
          </Alert>
        )}

        <Panel
          title={t("verify_listing.ladder")}
          description={t("verify_listing.current", { tier: String(business.verificationTier) })}
          footer={<p className="text-caption text-muted">{t("verify_listing.staff_only")}</p>}
        >
          {/*
            A different name from the Panel around it. Both are regions, and
            two landmarks sharing an accessible name are two identical entries
            in a screen reader's landmark list — the exact thing
            tests/e2e/landmarks.spec.ts guards on the gallery. The tier is the
            more useful of the two names anyway.
          */}
          <VerificationLadder
            current={business.verificationTier}
            label={t("verify_listing.current", { tier: String(business.verificationTier) })}
            reachedLabel={t("verify_listing.reached")}
            rungs={TIERS.map((spec) => {
              const at =
                spec.dateField === "verifiedAt"
                  ? business.verifiedAt
                  : spec.dateField === "visitedAt"
                    ? business.visitedAt
                    : null;
              return {
                tier: spec.tier,
                label: t(spec.labelKey as never),
                requirement: t(spec.checkedKey as never),
                ...(at && spec.tier <= business.verificationTier
                  ? { date: formatDate(at) }
                  : {}),
              };
            })}
          />
        </Panel>

        <Panel title={t("verify_listing.documents")} description={t("verify_listing.documents_hint")}>
          <DocumentUpload
            documents={documents.map((document) => ({
              id: document.id,
              kind: document.kind,
              filename: document.filename,
              uploadedAt: formatDate(document.createdAt),
            }))}
            signAction={signDocumentUpload}
            recordAction={recordDocument}
            deleteAction={deleteDocument}
          />
        </Panel>
      </div>
    </SellerPage>
  );
}
