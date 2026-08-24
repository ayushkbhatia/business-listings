import "server-only";
import { getActor } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";

/**
 * Who is looking at an enquiry.
 *
 * A signed-in buyer is their session. A buyer with no account — most of them,
 * at first — is identified by the claim token their enquiry was created with,
 * carried in the URL. That is a bearer secret, so it is a long random value,
 * it only ever grants access to the enquiries of the identity it belongs to,
 * and it stops working the moment the account is claimed.
 *
 * The alternative was to make the tracking page public by reference. `ENQ-8901`
 * is four digits and sits in a WhatsApp message; anybody could walk them.
 */
export async function resolveBuyerId(claimToken?: string | null): Promise<string | null> {
  const actor = await getActor();
  if (actor) return actor.id;

  if (!claimToken) return null;
  const provisional = await prisma.user.findFirst({
    where: { claimToken, isProvisional: true, claimedAt: null },
    select: { id: true },
  });
  return provisional?.id ?? null;
}

/** The token to put on a link back to this enquiry, or null once claimed. */
export async function trackingTokenFor(buyerId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { id: buyerId },
    select: { claimToken: true, isProvisional: true },
  });
  return user?.isProvisional ? user.claimToken : null;
}
