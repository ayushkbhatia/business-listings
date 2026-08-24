"use server";

import { getActor } from "@/lib/auth/session";
import { recordContactReveal } from "@/lib/audit";

/**
 * Somebody asked for a supplier's number.
 *
 * Board 10j. Counted because that count is what tells a seller the directory
 * delivered them something, and it is the number their subscription is
 * ultimately judged on. Most reveals happen before signup, so an anonymous one
 * is the normal case and `actorId` is null rather than missing.
 *
 * Never throws and never blocks: `recordContactReveal` swallows its own
 * failures, and a lost statistic must not cost a buyer a phone number.
 */
export async function revealContact(input: {
  businessId: string;
  channel: "phone" | "whatsapp";
  surface: string;
}): Promise<void> {
  const actor = await getActor();
  await recordContactReveal({
    actor,
    businessId: input.businessId,
    channel: input.channel,
    surface: input.surface,
  });
}
