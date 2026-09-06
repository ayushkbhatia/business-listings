import "server-only";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/db/client";
import { repairClaims } from "./flow";
import { isRole, type Actor, type Role } from "./roles";

/**
 * Resolve the acting user from the request's session.
 *
 * Uses getUser(), never getSession(): getSession trusts the cookie without
 * revalidating it against the auth server, and a permission decision must not
 * rest on a cookie the client could have written.
 *
 * Roles are read from the JWT app_metadata, which only the service role can
 * write. They are never read from user_metadata, which the user can edit.
 * The claim is populated by a Supabase auth hook backed by the profiles table
 * — wired in handoff 1, alongside the tables that hold it.
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
    select: { roles: true, businessId: true, branchId: true, buyerCompanyId: true },
  });

  /*
     Roles still come from the claim first.

     That is deliberate and unchanged: the claim is written by the service role
     alone, and reading permissions from a second place is a second place to get
     permissions wrong. The profile is the fallback for a session that has none
     yet, which is the repair this function has always done.
  */
  const roles: Role[] =
    claimedRoles.length > 0
      ? claimedRoles
      : (profile?.roles ?? []).filter((role): role is Role => isRole(role));

  const businessId = profile?.businessId ?? null;

  /*
     Self-healing, and quietly: a claim that disagrees with the record is
     rewritten so the next request costs nothing extra. It never blocks — the
     answer this request returns is already correct, and `syncClaims` swallows
     its own failure.
  */
  const claimIsStale =
    claimedRoles.length !== roles.length || claimedBusinessId !== (businessId ?? undefined);
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
    // Absent for every buyer who has not been attached to a company, which is
    // all of them until board 7b ships the screen that attaches them. Absent,
    // not null, for the same reason as `branchId`: a check reads the absence.
    ...(profile?.buyerCompanyId ? { buyerCompanyId: profile.buyerCompanyId } : {}),
  };
}

/** Throws when there is no session. For a route that has no anonymous form. */
export async function requireActor(): Promise<Actor> {
  const actor = await getActor();
  if (!actor) throw new Error("No authenticated actor on this request");
  return actor;
}
