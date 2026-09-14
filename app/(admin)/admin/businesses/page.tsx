import { requireStaff } from "@/lib/auth/staff";
import { can } from "@/lib/auth/can";
import { prisma } from "@/lib/db/client";
import { formatCount, formatDate } from "@/lib/format";
import { t } from "@/lib/i18n";
import { AdminPage, getAdminNavBadges } from "../../_shell";
import { BusinessTable, type BusinessRow } from "./BusinessTable";
import { giveNotice, lift, reopen, setTier, suspend, withdraw } from "./actions";

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

  /*
     The two figures in the header are queries, not slices of this page.

     They were `rows.length` and `rows.filter(state === "live").length` over a
     `take: 300`, printed into "{count} listings, {claimed} claimed" — so the
     screen that owns suspension across a directory its own copy calls 41,000
     listings reported "300 listings" and would have kept saying it. Every
     number is a query; a page cap wearing a total is the version of that rule
     this project keeps breaking.

     `claimed` also counted the wrong set. `state` is a precedence chain where
     `suspendedAt` wins, then `mergedIntoId`, so a claimed business that had
     been suspended stopped being claimed as far as the header was concerned.
     Claim status is its own column and is what the word means.
  */
  const [businesses, badges, listingCount, claimedCount] = await Promise.all([
    prisma.business.findMany({
      orderBy: [{ suspendedAt: { sort: "desc", nulls: "last" } }, { displayName: "asc" }, { id: "asc" }],
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
        licenceExpiry: true,
        closureRequestedAt: true,
        closedAt: true,
        // Board 11i. At most one open closure per business, by index.
        closures: {
          where: { reversedAt: null, finalisedAt: null },
          select: { initiator: true, appliedAt: true, effectiveAt: true, finalAt: true },
          take: 1,
        },
      },
    }),
    getAdminNavBadges(seat),
    prisma.business.count(),
    prisma.business.count({ where: { claimStatus: "claimed" } }),
  ]);

  /*
     What this seat may do, worked out here so the table can offer only what
     the service will accept.

     Tier used to be the subtle one. `business.verification_tier.write` was
     held by an ops lead and by a field verifier, and a field verifier could
     only tier a business they had been to — a subject check reading
     `visitedByStaffId`. Site visits were withdrawn and that column went with
     them, so the capability is ops-lead only and this is a plain role test
     again. Narrowed rather than widened: see lib/auth/capabilities.ts.
  */
  const mayTier = can(seat.actor, "business.verification_tier.write");
  const maySuspend = can(seat.actor, "business.suspend");
  const mayClose = can(seat.actor, "business.close");
  const now = new Date();

  const rows: BusinessRow[] = businesses.map((business) => ({
    id: business.id,
    displayName: business.displayName,
    plan: business.planId ?? "—",
    tier: business.verificationTier,
    replyMs: business.responseTimeMedianMs,
    strength: business.profileStrength,
    /*
       Closure sits under suspension and merge in the precedence, and above
       claim status: a closed business is out of the directory whatever its
       claim says, and reading it as `live` on the one screen that can reopen it
       would hide the only row an ops lead came here to find.
    */
    state: business.suspendedAt
      ? "suspended"
      : business.mergedIntoId
        ? "merged"
        : business.closedAt
          ? "closed"
          : business.closureRequestedAt
            ? "closing"
            : business.claimStatus === "unclaimed"
              ? "unclaimed"
              : "live",
    mayTier,
    maySuspend,
    mayClose,
    closure: closureOf(business.closures[0] ?? null),
    licenceLapsed: business.licenceExpiry.getTime() <= now.getTime(),
  }));

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
            count: formatCount(listingCount),
            claimed: formatCount(claimedCount),
          })}
          {listingCount > rows.length && (
            <>
              {" · "}
              {t("admin.businesses.showing", { count: formatCount(rows.length) })}
            </>
          )}
        </span>
      }
    >
      <BusinessTable
        rows={rows}
        setTier={setTier}
        suspend={suspend}
        lift={lift}
        giveNotice={giveNotice}
        withdraw={withdraw}
        reopen={reopen}
      />
    </AdminPage>
  );
}

/** Board 11i. What the decision strip needs to know about an open closure. */
function closureOf(
  closure: { initiator: "owner" | "platform"; appliedAt: Date | null; effectiveAt: Date; finalAt: Date } | null,
): BusinessRow["closure"] {
  if (!closure) return null;
  return closure.appliedAt
    ? { kind: "closing", date: formatDate(closure.finalAt) }
    : { kind: "notice", date: formatDate(closure.effectiveAt) };
}
