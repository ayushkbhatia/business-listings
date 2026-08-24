import "server-only";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_SECRET_KEY, SUPABASE_URL } from "./env";

/**
 * The service-role client. Bypasses RLS and can write `app_metadata`.
 *
 * Needed for exactly two things in this handoff: setting the roles claim, which
 * only the service role may write and which `getActor` reads, and adopting a
 * provisional identity into a real account.
 *
 * Never import this from anything that renders. `server-only` is the fence and
 * `SUPABASE_SECRET_KEY` throws if it is somehow reached without one.
 */
export function createAdminClient() {
  return createClient(SUPABASE_URL(), SUPABASE_SECRET_KEY(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
