import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth/staff";
import { can } from "@/lib/auth/can";
import { prisma } from "@/lib/db/client";
import { t } from "@/lib/i18n";
import { AdminPage, getAdminNavBadges } from "../../../_shell";
import { VisitReportForm } from "./VisitReportForm";
import { fileReport, recordVisitPhoto, signVisitPhoto } from "./actions";

/**
 * Board 4h — one visit request, and the report against it.
 *
 * The screen `recordVisit` never had. It was the last of the eight orphaned
 * mutations and the last for a reason: a report needs photographs, and there
 * was no admin-side upload path on the platform at all.
 *
 * Gated on `visit.record`. The service asserts it again at the fence, and both
 * upload actions assert it themselves — `signVisitPhoto` writes no platform
 * state so it never reaches the fence, and without its own check any staff seat
 * could get a signed upload URL into a business's private folder.
 */

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function VisitReportPage({ params }: Props) {
  const seat = await requireStaff();
  if (!can(seat.actor, "visit.record")) notFound();

  const { id } = await params;

  const request = await prisma.siteVisitRequest.findUnique({
    where: { id },
    select: {
      id: true,
      completedAt: true,
      cancelledAt: true,
      preferredNote: true,
      business: {
        select: {
          id: true,
          displayName: true,
          verificationTier: true,
          locations: {
            take: 1,
            select: { emirate: true, addressLine: true, area: { select: { name: true } } },
          },
        },
      },
    },
  });

  if (!request) notFound();

  const badges = await getAdminNavBadges(seat);
  const location = request.business.locations[0];
  const where = location
    ? [location.addressLine, location.area?.name, location.emirate].filter(Boolean).join(", ")
    : t("admin.visit.no_address");

  /*
     A completed request keeps its page rather than 404ing. Somebody following a
     link from the audit log to see what was filed should land on the report,
     not on a missing page — but the form is not offered twice.
  */
  const done = request.completedAt !== null || request.cancelledAt !== null;

  return (
    <AdminPage
      seat={seat}
      badges={badges}
      activeHref="/admin/visits"
      title={request.business.displayName}
      eyebrow={t("admin.visit.eyebrow")}
      meta={<span className="text-caption text-muted">{where}</span>}
    >
      {request.preferredNote && (
        <p className="mb-[var(--gutter)] max-w-prose text-body-sm text-body">
          {t("admin.visit.seller_note", { note: request.preferredNote })}
        </p>
      )}

      {done ? (
        <p className="max-w-prose text-body-sm text-body">
          {request.cancelledAt ? t("admin.visit.cancelled") : t("admin.visit.already_filed")}
        </p>
      ) : (
        <VisitReportForm
          businessId={request.business.id}
          businessName={request.business.displayName}
          requestId={request.id}
          // The date input wants `YYYY-MM-DD`, and a verifier filing on the day
          // should not have to type today's date.
          today={new Date().toISOString().slice(0, 10)}
          signPhoto={signVisitPhoto}
          recordPhoto={recordVisitPhoto}
          fileReport={fileReport}
        />
      )}
    </AdminPage>
  );
}
