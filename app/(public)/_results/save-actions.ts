"use server";

import { getActor } from "@/lib/auth/session";
import { saveSearchFor } from "@/lib/saved-search/service";

export type SaveSearchResult =
  | { ok: true; zeroResult: boolean }
  | { ok: false; error: "anonymous" };

/**
 * Keep the current view for a signed-in buyer — board 10e.
 *
 * The query string is the whole state, so this stores that, the heading the
 * page was showing, and the category page it was on. Whether the search found
 * nothing is decided by the service, by counting, not taken from the page: it is
 * the flag board 12d recruits against.
 *
 * No audit row. This is a buyer bookmarking their own view, not a staff
 * decision, and `AuditEvent.actorId` is NOT NULL because that log holds
 * decisions.
 */
export async function saveSearch(input: {
  search: string;
  name: string;
  categoryId?: string | null;
}): Promise<SaveSearchResult> {
  const actor = await getActor();
  if (!actor) return { ok: false, error: "anonymous" };

  const saved = await saveSearchFor({
    userId: actor.id,
    name: input.name,
    query: input.search,
    categoryId: input.categoryId ?? null,
  });

  return { ok: true, zeroResult: saved.zeroResult };
}
