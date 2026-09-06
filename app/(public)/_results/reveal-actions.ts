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
import { recordContactReveal, type RevealSurface } from "@/lib/audit/contact-reveal";

/**
 * A contact reveal from a results row.
 *
 * The storefront has its own copy of this for its own surface. They are six
 * lines each and both call the same service, which is where the rule lives —
 * one shared action would have to be told which surface it was on anyway, and
 * a route owning its own server actions is the convention here.
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
