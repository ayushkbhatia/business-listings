import "server-only";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/db/client";
import { repairClaims } from "./flow";
import { isRole, sameRoles, type Actor, type Role } from "./roles";

/**
 * Resolve the acting user from the request's session.
 *
 * Uses getUser(), never getSession(): getSession trusts the cookie without
 * revalidating it against the auth server, and a permission decision must not
 * rest on a cookie the client could have written.
 *
 * Roles are decided by the profile row and mirrored into the JWT app_metadata,
 * which only the service role can write — board 4i moved the decision from the
 * mirror to the record; the note inside says why. They are never read from
 * user_metadata, which the user can edit.
 */
export async function getActor(): Promise<Actor | null> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) return null;

  const claimed = user.app_metadata?.["roles"];
  const claimedRoles: Role[] = Array.isArray(claimed) ? claimed.filter((r): r is Role => typeof r === "string" && isRole(r)) : [];
  const claimedBusinessId = user.app_metadata?.["business_id"];

  /*
     The profile row, every request.

     `businessId` decides which business this person owns, and roughly a hundred
     and fifty call sites read it to answer "is this mine?" — it is an ownership
     boundary, not a routing hint. A JWT claim is a cache of that, and a cache
     on an ownership boundary is only safe while it cannot go stale.

     It can. `syncClaims` writes the claim at sign-in and nothing re-checks it,
     so a claim outlives whatever it pointed at: a restore, a merge, a reseed,
     or — the way this was actually found — an environment that shares an auth
     project with a database it does not share. CI signed a seller in, read a
     `business_id` written months earlier against a different database, found no
     such business, and 404'd every page of that seller's dashboard.

     Failing closed is the good version of that bug. The bad version is an id
     that resolves to somebody else's business, and nothing in the old code
     would have noticed.

     So the record wins and the claim is repaired to match. The cost is one
     lookup on a primary key per authenticated request, which is what this
     function already paid whenever the roles claim was empty.
  */
  const profile = await prisma.user.findUnique({
    where: { id: user.id },
    /*
       `branchId` since board 8d, and it closes a hole rather than adding a
       feature. `Actor.branchId` has been declared in ./roles.ts since handoff 0
       and read by `withinScope()` and `analyticsScopeFor()` ever since — with
       nothing ever setting it, so every branch-scoping check in the product
       returned true and board 7d's branch-scoped sales seat scoped nothing.

       `buyerCompanyId` ahead of board 7b, and it is read here rather than from
       a claim on purpose. Everything above about a cache on an ownership
       boundary applies to it word for word, and the lookup it would save is
       this one — already unconditional. A second claim would be a second thing
       that can point at a company the record no longer agrees with, bought for
       nothing.
    */
    select: { roles: true, businessId: true, branchId: true, buyerCompanyId: true, suspendedAt: true },
  });

  /*
     A suspended account has no actor — board 7a `B7`, on every request.

     Every sign-in path already turned a suspended account straight back out,
     and that was the only place the column was read. A session minted the day
     before a suspension kept working until its refresh token died, which for a
     rotating refresh token is never. `suspendAccount` ends the sessions as well;
     this is the half that does not depend on that delete having reached every
     row, and it costs nothing — the profile is read on this request regardless.
  */
  if (profile?.suspendedAt) return null;

  /*
     Roles come from the record, the same as `businessId` — board 4i.

     They used to come from the claim first, with the record as a fallback for
     a claim that was empty. That held while roles only ever grew. Board 4i is
     the first screen that takes them away, and it exposed two ways the claim
     outvoted the decision:

       - **A revoke whose claim write failed never took effect.** `syncClaims`
         swallows its own failure, so an ops lead could deactivate somebody,
         see the row update, and leave that person holding every capability
         until their session was rebuilt — and the "repair" below then wrote
         the stale claim back over itself, because `roles` *was* the claim.
       - **A swap was never noticed at all.** Staleness was a length comparison.
         Moderator to finance is one role for one role, so a failed sync left a
         person with the role they were moved off, indefinitely.

     The record is the one place every writer writes — invitations, removals,
     role changes, the retirement migration — and it is read on this request
     regardless. So it decides, and the claim is a mirror that is repaired to
     match. A session with no profile row gets no roles: that is an auth user
     from another database or a half-finished cleanup, and failing closed is
     the only safe reading of a claim nobody's record backs.
  */
  const roles: Role[] = (profile?.roles ?? []).filter((role): role is Role => isRole(role));

  const businessId = profile?.businessId ?? null;

  /*
     Self-healing, and quietly: a claim that disagrees with the record is
     rewritten so the next request costs nothing extra. It never blocks — the
     answer this request returns is already correct, and `syncClaims` swallows
     its own failure.

     Compared as sets. Two lists of the same length can hold different roles.
  */
  const claimIsStale =
    !sameRoles(claimedRoles, roles) || claimedBusinessId !== (businessId ?? undefined);
  if (profile && claimIsStale) {
    await repairClaims(user.id, roles, businessId);
  }

  return {
    id: user.id,
    roles,
    ...(businessId ? { businessId } : {}),
    // Absent means unscoped, which is what an owner and most managers are.
    // `withinScope` reads the absence that way, so it must stay absent rather
    // than becoming null.
    ...(profile?.branchId ? { branchId: profile.branchId } : {}),
    // Absent for every buyer who does not send enquiries for a company. Since
    // board 7b the column is the mirror of an active `buyer_company_member`
    // row, written by that table's trigger. Absent, not null, for the same
    // reason as `branchId`: a check reads the absence.
    ...(profile?.buyerCompanyId ? { buyerCompanyId: profile.buyerCompanyId } : {}),
  };
}

/** Throws when there is no session. For a route that has no anonymous form. */
export async function requireActor(): Promise<Actor> {
  const actor = await getActor();
  if (!actor) throw new Error("No authenticated actor on this request");
  return actor;
}
