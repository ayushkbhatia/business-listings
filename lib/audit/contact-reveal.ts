import type { Actor } from "@/lib/auth/roles";

/**
 * A buyer revealing a masked phone number is an event, not a UI state.
 *
 * Masking is not a growth trick. It is how the platform proves it delivered the
 * enquiry: when a seller asks what the subscription bought, the answer is a
 * count of reveals and enquiries, and that answer only exists if the reveal was
 * written down. It is deliberately separate from AuditEvent — that log is for
 * staff acting on other people's data, and mixing buyer behaviour into it would
 * make the staff log unreadable.
 */
export type RevealChannel = "phone" | "whatsapp" | "email" | "website";

export interface ContactRevealInput {
  /** Null for an anonymous buyer — most reveals happen before signup. */
  actor: Actor | null;
  businessId: string;
  locationId?: string;
  channel: RevealChannel;
  /** Where on the site it happened, e.g. `storefront` or `search_results`. */
  surface: string;
}

export interface ContactRevealRow {
  actorId: string | null;
  businessId: string;
  locationId: string | null;
  channel: RevealChannel;
  surface: string;
}

export interface ContactRevealWriter {
  write(row: ContactRevealRow): Promise<void>;
}

let writer: ContactRevealWriter | null = null;

export function setContactRevealWriter(next: ContactRevealWriter | null): void {
  writer = next;
}

/**
 * Never blocks the reveal. A buyer who clicked "Show number" gets the number
 * whether or not the counter wrote; losing one row is cheaper than losing the
 * enquiry that row exists to prove.
 */
export async function recordContactReveal(input: ContactRevealInput): Promise<void> {
  if (!writer) return;

  const row: ContactRevealRow = {
    actorId: input.actor?.id ?? null,
    businessId: input.businessId,
    locationId: input.locationId ?? null,
    channel: input.channel,
    surface: input.surface,
  };

  try {
    await writer.write(row);
  } catch (error) {
    console.error("[contact_reveal] write failed", error);
  }
}
