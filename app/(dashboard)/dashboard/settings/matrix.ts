import { PLATFORM_FLOOR } from "@/lib/notify/routing";

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
  /*
     Board `1n`. A buyer chose another supplier's quote, and a buyer nudged for
     one. In-app is on the platform floor for both (`PLATFORM_FLOOR`); the rows
     are here so email and WhatsApp can be chosen — and so saving this screen
     does not drop them from the stored matrix.
  */
  "quote_declined",
  "quote_partly_accepted",
  "enquiry_nudged",
] as const;

/**
 * The channels a seller may choose between — decision N10, task T6.8.
 *
 * SMS has left. It had no carrier — `senders/index.ts` bound it to the console
 * sender — so a seller who ticked it was promised a text message and sent a
 * line in a server log, and its two bodies are `retired`. WhatsApp reaches the
 * same handset for a fraction of the cost and is the channel the product's copy
 * already promises.
 *
 * The **enum** keeps `sms`, because `NotificationDelivery.channel` has history
 * in it: 96 `enquiry_received` and 21 `quote_accepted` SMS deliveries are in the
 * seeded log and a retired channel is still a thing that happened. What goes is
 * every surface that offers it as a choice.
 */
export const CHANNELS = ["whatsapp", "email", "in_app"] as const;

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
  quote_declined: "assigned",
  quote_partly_accepted: "assigned_and_owner",
  enquiry_nudged: "assigned",
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

/**
 * Board 12g `B7`: channels the platform sends whatever this matrix says.
 *
 * Rendered ticked and locked for the same reason as `ALWAYS_IN_APP` — a box a
 * seller can untick and nothing honours is a control that lies — and read from
 * `PLATFORM_FLOOR` rather than listed again, so the form, `route()` and the
 * console cannot name different exceptions.
 */
export function floorLocked(event: AlertEvent, channel: AlertChannel): boolean {
  return (PLATFORM_FLOOR[event] ?? []).includes(channel);
}

/**
 * The matrix to store, from what was posted and what was already there — T6.5.
 *
 * ## The defect this is a function because of
 *
 * `saveAlerts` built the column from `{}` and `EVENTS`, so every stored choice
 * for an event the screen does not render was **deleted on save**. This screen
 * shows 11 of the 18 events a seller can receive; of the seven it omits, four
 * survive because `PLATFORM_FLOOR` puts them back whatever the matrix says, and
 * three did not — `subscription_renewed`, `enquiry_unanswered` and
 * `review_dispute_decided`. A seller who had chosen WhatsApp for a renewal
 * receipt lost it the first time they changed their quiet hours, and nothing on
 * the screen said so.
 *
 * ## The two halves, which pull against each other
 *
 * An event the screen **does** render is written from the form, whatever the
 * stored value was — including as an empty array, because a seller who unticked
 * every box has chosen and merging over the old value would make an untick a
 * no-op. An event the screen does **not** render is carried through untouched:
 * this form has no opinion about it, and a form with no opinion must not have
 * an effect.
 *
 * Pure, and in this module rather than in `actions.ts`, because a `"use server"`
 * module may only export async functions — and because the rule above is the
 * one thing on this screen worth a test of its own.
 */
export function nextRouting(
  previous: Readonly<Record<string, readonly string[]>>,
  posted: Readonly<Partial<Record<AlertEvent, readonly string[]>>>,
): Record<string, string[]> {
  const next: Record<string, string[]> = {};
  for (const [event, channels] of Object.entries(previous)) next[event] = [...channels];
  for (const event of EVENTS) next[event] = [...(posted[event] ?? [])];
  return next;
}
