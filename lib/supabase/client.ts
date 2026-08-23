import { createBrowserClient } from "@supabase/ssr";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./env";

/** Browser-side Supabase client. Auth only — all data reads go through the server. */
export function createClient() {
  return createBrowserClient(SUPABASE_URL(), SUPABASE_PUBLISHABLE_KEY());
}
