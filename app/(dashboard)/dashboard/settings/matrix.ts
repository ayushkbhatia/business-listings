/**
 * What the alert matrix may contain, and who each row reaches.
 *
 * Not in actions.ts: a `"use server"` module may only export async functions,
 * and everything it exports becomes a callable endpoint. A const array is
 * neither. Next reports this at module evaluation rather than at build, so it
 * ships and then fails on the first request — which is how it got here twice.
 */
export const EVENTS = [
  "enquiry_received",
  /*
     Board 7e §2 lists one row for an unanswered lead — "Lead unanswered after
     2h → Owner. The escalation job" — and that job emits `enquiry_escalated`.
     `enquiry_unanswered` was a second row for the same thing with no emitter
     behind it, which is a control a seller can set and nothing can honour, so
     it is gone from the matrix. The event name survives in the union because
     `NotificationDelivery.event` has history in it and a seeded template still
     names it.
  */
  "enquiry_escalated",
  "quote_accepted",
  "quote_expiring",
  "review_posted",
  "document_expiring",
  /*
     Board 8a's one nudge.

     Here because `saveAlerts` rebuilds the whole matrix from this list: an
     event missing from it is an event silently dropped out of the seller's
     stored routing the next time they press save, so the nudge would work until
     somebody visited this screen and then never fire again. That it is sent
     once ever rather than repeatedly makes no difference — it still routes.
  */
  "setup_nudge",
  "weekly_digest",
] as const;

export const CHANNELS = ["whatsapp", "sms", "email", "in_app"] as const;

export const ESCALATION_CHOICES = [30, 60, 120, 240, 480] as const;
export const NUDGE_CHOICES = [12, 24, 48, 72] as const;

export type AlertEvent = (typeof EVENTS)[number];
export type AlertChannel = (typeof CHANNELS)[number];

/**
 * Who each event reaches. Board 7e §2's `GOES TO` column.
 *
 * The matrix is business-wide policy — which channels — and this is the other
 * half: which person. Without it a seller reads a row of ticks with no idea
 * whose handset they are ticking, and the answer is not the same for every row.
 *
 * `assigned` is what board 7d's routing decided. It is the reason these two
 * screens are one handoff: an `assigned` that names a seat with no verified
 * channel would be a promise nothing keeps, so `lib/notify/events.ts` falls back
 * to the owner and counts it.
 */
export type Recipient =
  | "assigned"
  | "assigned_and_owner"
  | "owner"
  | "owner_and_finance";

export const GOES_TO: Readonly<Record<AlertEvent, Recipient>> = {
  enquiry_received: "assigned",
  // Escalation is the owner by definition — it exists because the assigned seat
  // did not answer. `NotificationPreference.escalateToUserId` would let a
  // supplier name somebody else and is read by nothing; a screen for it belongs
  // with the person who asked for it.
  enquiry_escalated: "owner",
  quote_accepted: "assigned_and_owner",
  quote_expiring: "assigned",
  review_posted: "owner",
  document_expiring: "owner_and_finance",
  setup_nudge: "owner",
  weekly_digest: "owner",
};

/**
 * The events in-app cannot be switched off for. Board 7e §2.2.
 *
 * "In-app is always on for anything with a deadline — an enquiry, an expiring
 * quote, an escalation. A seller who turns off every channel still has a place
 * the work appears."
 *
 * Enforced in `saveAlerts` as well as rendered as a locked checkbox, because a
 * form is a suggestion: the box being disabled stops a seller unticking it and
 * does nothing at all about a posted body that omits it.
 */
export const ALWAYS_IN_APP: readonly AlertEvent[] = [
  "enquiry_received",
  "enquiry_escalated",
  "quote_expiring",
];

export function inAppLocked(event: AlertEvent): boolean {
  return ALWAYS_IN_APP.includes(event);
}
