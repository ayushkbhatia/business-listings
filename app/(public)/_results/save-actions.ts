"use server";

import { prisma } from "@/lib/db/client";
import { getActor } from "@/lib/auth/session";

export type SaveSearchResult = { ok: true } | { ok: false; error: "anonymous" };

/**
 * Keep the current view for a signed-in buyer.
 *
 * The query string is the whole state, so this stores that and the heading the
 * page was showing — a saved search called "HVAC & ventilation in Dubai" is one
 * somebody recognises three weeks later, which "search 4" is not.
 *
 * No audit row. This is a buyer bookmarking their own view, not a staff
 * decision, and `AuditEvent.actorId` is NOT NULL because that log holds
 * decisions.
 */
export async function saveSearch(input: {
  search: string;
  name: string;
}): Promise<SaveSearchResult> {
  const actor = await getActor();
  if (!actor) return { ok: false, error: "anonymous" };

  await prisma.savedSearch.create({
    data: {
      userId: actor.id,
      name: input.name.slice(0, 120),
      query: input.search.slice(0, 500),
    },
  });

  return { ok: true };
}
