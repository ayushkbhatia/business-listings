import { parseUaePhone, toE164 } from "@/lib/format/phone";

/**
 * One box that says "Mobile or email", and what it resolves to.
 *
 * Board 8d §2. The seller types a contact and the row states, live, what will
 * actually be sent — *Invite goes by WhatsApp* or *Invite goes by email* —
 * rather than the rail promising one channel while the field accepts the other.
 *
 * That is honesty first and cost second, and the second half is real: a WhatsApp
 * template message is billed per conversation and an email is not, so a screen
 * that silently picked the expensive channel would be spending money the seller
 * did not agree to.
 *
 * Pure, and it has to be: the field validates as the seller types, so this runs
 * in the browser, and it runs again on the server because a client-side check is
 * a courtesy rather than a rule.
 */

export type InviteChannel = "whatsapp" | "email";

export type ContactRead =
  | { ok: true; channel: "email"; email: string; phone: null }
  | { ok: true; channel: "whatsapp"; email: null; phone: string }
  | { ok: false; reason: "empty" | "ambiguous" };

/**
 * Sniff, rather than ask.
 *
 * An `@` means an address and nothing else does — a UAE mobile has no `@` and
 * no address is written without one, so the split needs no radio button and no
 * second field. §2 calls this "sniffed"; the failure is a single line on blur
 * rather than a block on typing, because a half-typed address is not an error
 * yet and telling somebody so mid-word is how a form gets abandoned.
 */
export function readContact(input: string): ContactRead {
  const value = input.trim();
  if (value === "") return { ok: false, reason: "empty" };

  if (value.includes("@")) {
    // Deliberately loose. The invitation itself is the real test of an address:
    // a regex that refuses a valid but unusual mailbox costs a seat, and one
    // that accepts a typo costs a bounce the seller can see and fix.
    return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)
      ? { ok: true, channel: "email", email: value.toLowerCase(), phone: null }
      : { ok: false, reason: "ambiguous" };
  }

  /*
     A mobile, specifically. `toE164` will happily normalise an 04 landline, and
     a landline cannot receive the invitation — so accepting one would produce a
     row that looks sent and never arrives. `05x` is the only kind WhatsApp
     reaches here.
  */
  const parsed = parseUaePhone(value);
  const e164 = parsed?.kind === "mobile" ? toE164(value) : null;
  if (e164) return { ok: true, channel: "whatsapp", email: null, phone: e164 };

  return { ok: false, reason: "ambiguous" };
}

/** What to show the seller for a stored invitation, whichever channel it used. */
export function contactLabel(invite: { email: string | null; phone: string | null }): string {
  return invite.email ?? invite.phone ?? "";
}

export function channelOf(invite: { email: string | null; phone: string | null }): InviteChannel {
  return invite.phone ? "whatsapp" : "email";
}
