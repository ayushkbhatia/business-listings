import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth/staff";
import { prisma } from "@/lib/db/client";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import { AdminPage, getAdminNavBadges } from "../../_shell";
import { BusinessTable, type BusinessRow } from "./BusinessTable";

/**
 * Board 4f — businesses and account health.
 *
 * Every figure here is measured. `responseTimeMedianMs` comes from
 * enquiry-to-first-reply timestamps and `profileStrength` and
 * `specCompleteness` from pure functions the hourly job calls — all three were
 * invented in the seed at some point in this project's life, and all three were
 * caught. A dash means not enough to say, which is not the same as zero.
 */

export const dynamic = "force-dynamic";

export default async function BusinessesPage() {
  const seat = await requireStaff();
  if (!seat) notFound();

  const [businesses, badges] = await Promise.all([
    prisma.business.findMany({
      orderBy: [{ suspendedAt: { sort: "desc", nulls: "last" } }, { displayName: "asc" }],
      take: 300,
      select: {
        id: true,
        displayName: true,
        planId: true,
        verificationTier: true,
        responseTimeMedianMs: true,
        profileStrength: true,
        claimStatus: true,
        suspendedAt: true,
        mergedIntoId: true,
      },
    }),
    getAdminNavBadges(seat),
  ]);

  const rows: BusinessRow[] = businesses.map((business) => ({
    id: business.id,
    displayName: business.displayName,
    plan: business.planId ?? "—",
    tier: business.verificationTier,
    replyMs: business.responseTimeMedianMs,
    strength: business.profileStrength,
    state: business.suspendedAt
      ? "suspended"
      : business.mergedIntoId
        ? "merged"
        : business.claimStatus === "unclaimed"
          ? "unclaimed"
          : "live",
  }));

  const claimed = rows.filter((row) => row.state === "live").length;

  return (
    <AdminPage
      seat={seat}
      badges={badges}
      activeHref="/admin/businesses"
      title={t("admin.businesses.title")}
      eyebrow={t("admin.businesses.eyebrow")}
      meta={
        <span className="text-caption text-muted">
          {t("admin.businesses.meta", {
            count: formatCount(rows.length),
            claimed: formatCount(claimed),
          })}
        </span>
      }
    >
      <BusinessTable rows={rows} />
    </AdminPage>
  );
}
