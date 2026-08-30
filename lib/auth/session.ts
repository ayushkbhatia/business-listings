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
  const roles: Role[] = Array.isArray(claimed) ? claimed.filter((r): r is Role => typeof r === "string" && isRole(r)) : [];

  const businessId = user.app_metadata?.["business_id"];

  /*
     A session with no roles whose profile row has some is always a bug, and
     until now it was a permanent one.

     `syncClaims` swallows its own failure on the way in, on the reasoning that
     a thin session "the next request repairs" beats failing the sign-in over
     it. Nothing repaired it: roles are read here and only here, out of a claim
     only the service role can write, so a staff member whose `updateUserById`
     call failed got a valid session and a 404 on every page behind a
     capability, with no signal anywhere.

     This is the repair the comment promised. It costs one indexed lookup on
     the empty-roles path only — a signed-in buyer with no roles is the normal
     case and reads their own row once per request, and everybody else skips it
     entirely.
  */
  if (roles.length === 0) {
    const profile = await prisma.user.findUnique({
      where: { id: user.id },
      select: { roles: true, businessId: true },
    });

    if (profile && profile.roles.length > 0) {
      const repaired = profile.roles.filter((role): role is Role => isRole(role));
      await repairClaims(user.id, repaired, profile.businessId);
      return {
        id: user.id,
        roles: repaired,
        ...(profile.businessId ? { businessId: profile.businessId } : {}),
      };
    }
  }

  return {
    id: user.id,
    roles,
    ...(typeof businessId === "string" ? { businessId } : {}),
  };
}

/** Throws when there is no session. For a route that has no anonymous form. */
export async function requireActor(): Promise<Actor> {
  const actor = await getActor();
  if (!actor) throw new Error("No authenticated actor on this request");
  return actor;
}
