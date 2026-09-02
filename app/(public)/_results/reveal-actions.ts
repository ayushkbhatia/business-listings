"use server";

import { getActor } from "@/lib/auth/session";
import { recordContactReveal } from "@/lib/audit/contact-reveal";

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
