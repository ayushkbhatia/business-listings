"use server";

/*
   Registers the Prisma writer. `recordContactReveal` no-ops when none is set —
   deliberately, so a counter that is down never costs a buyer the number they
   asked for — and a server action is its own module graph. Neither reveal
   action imported this, so nothing registered a writer on either path and
   every reveal was discarded in silence.

   That is the one thing masking exists to prevent. `lib/audit/contact-reveal.ts`
   says it in its own header: "when a seller asks what the subscription bought,
   the answer is a count of reveals and enquiries, and that answer only exists
   if the reveal was written down."
*/
import "@/lib/audit/prisma-writer";
import { getActor } from "@/lib/auth/session";
import { recordContactReveal, type RevealSurface } from "@/lib/audit";

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
  surface: RevealSurface;
}): Promise<void> {
  const actor = await getActor();
  await recordContactReveal({
    actor,
    businessId: input.businessId,
    channel: input.channel,
    surface: input.surface,
  });
}
