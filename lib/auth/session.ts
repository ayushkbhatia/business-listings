import "server-only";
import { createClient } from "@/lib/supabase/server";
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
