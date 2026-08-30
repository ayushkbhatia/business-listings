import { requireStaff } from "@/lib/auth/staff";
import { can } from "@/lib/auth/can";
import { prisma } from "@/lib/db/client";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import { AdminPage, getAdminNavBadges } from "../../_shell";
import { BusinessTable, type BusinessRow } from "./BusinessTable";
import { lift, setTier, suspend } from "./actions";

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
  // `requireStaff()` 404s a non-staff visitor by itself. The `if (!seat)` that
  // used to sit here was dead code that read like a gate, which is worse than
  // no gate — the screen had none, and every seat saw every business. The real
  // gating is per row and per action, below.
  const seat = await requireStaff();

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
        visitedByStaffId: true,
      },
    }),
    getAdminNavBadges(seat),
  ]);

  /*
     What this seat may do, worked out here so the table can offer only what
     the service will accept.

     Tier is the subtle one. `business.verification_tier.write` is held by an
     ops lead and by a field verifier, but a field verifier may only tier a
     business *they* visited — `assertCanSetVerificationTier` reads
     `visitedByStaffId`. Offering the control to a field verifier on every row
     would put a refusal behind two thirds of the buttons on this screen.

     Note that `visitedByStaffId` is written by `recordVisit` and by nothing
     else, and `recordVisit` still has no screen. Until it does, a field
     verifier sees no tier control anywhere and only an ops lead can set one.
     That is the truth about the system rather than a decision taken here.
  */
  const mayTier = can(seat.actor, "business.verification_tier.write");
  const maySuspend = can(seat.actor, "business.suspend");

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
    mayTier: mayTier && (seat.isOpsLead || business.visitedByStaffId === seat.actor.id),
    maySuspend,
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
      <BusinessTable rows={rows} setTier={setTier} suspend={suspend} lift={lift} />
    </AdminPage>
  );
}
