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

/**
 * Where a reveal happened. A closed set, and it has to be one.
 *
 * `surface` was typed `String` with a doc comment saying "e.g. `storefront` or
 * `search_results`", and nothing checked it — so call sites drifted into paths:
 * the storefront card wrote `/b/<slug>` and a results row wrote
 * `/c/<category>`. Grouping by a column like that returns one row per listing,
 * which means it answers no question at all. `lib/telemetry/events.ts` records
 * this exact column as the argument for why its own event names are a closed
 * set; this is that argument applied back here.
 *
 * Three members, because those are the three surfaces that reveal a number and
 * they are the three values already in the table.
 */
export type RevealSurface = "storefront" | "search_results" | "category";

export interface ContactRevealInput {
  /** Null for an anonymous buyer — most reveals happen before signup. */
  actor: Actor | null;
  businessId: string;
  locationId?: string;
  channel: RevealChannel;
  /** Where on the site it happened. Never a path — see `RevealSurface`. */
  surface: RevealSurface;
}

export interface ContactRevealRow {
  actorId: string | null;
  businessId: string;
  locationId: string | null;
  channel: RevealChannel;
  surface: RevealSurface;
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
