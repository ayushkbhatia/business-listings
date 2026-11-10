import { PLATFORM_FLOOR } from "@/lib/notify/routing";

/**
 * What the alert matrix may contain, and who each row reaches.
 *
 * Not in actions.ts: a `"use server"` module may only export async functions,
 * and everything it exports becomes a callable endpoint. A const array is
 * neither. Next reports this at module evaluation rather than at build, so it
 * ships and then fails on the first request — which is how it got here twice.
 */

/**
 * Board 7e's rows, in four groups — task T7.2, prompt P-09, spec S1.
 *
 * ## Every seller event that is emitted, and nothing else
 *
 * The screen rendered eleven rows against sixteen emitted seller events.
 * Two of the six it left out reached a seller only if their stored matrix
 * happened to name them (`subscription_renewed`, `review_dispute_decided`);
 * the other four were floor-only, so a seller received them and could see no
 * row saying so, nor add WhatsApp to them.
 *
 * Two seller events have no row, and they are the two with no emitter. A row
 * for either would be a control a seller can set and nothing honours:
 *
 *   · `enquiry_unanswered`. Board 7e §2 lists one row for an unanswered lead —
 *     "Lead unanswered after 2h → Owner. The escalation job" — and that job
 *     emits `enquiry_escalated`.
 *   · `weekly_digest`. It had a row on the shipped screen and nothing has ever
 *     sent it. Its row returns with the job that sends it; until then a stored
 *     choice is carried through by `nextRouting`, untouched.
 *
 * Both enum values survive because `NotificationDelivery.event` has history in
 * them and seeded templates name them.
 *
 * P-09 asked for eighteen rows in six groups and the spec it points at draws
 * seventeen in five, each counting a row for the digest. The grouping is the
 * spec's, less its `Summary` group, so the platform floor reads as a property
 * of a group — *these are ours to send* — rather than as a lock repeated cell
 * by cell.
 *
 * `alerts-matrix.test.ts` fails when a new seller event appears without a
 * decision about which group it joins.
 */
export const ALERT_GROUPS = [
  {
    key: "leads_quotes",
    events: [
      "enquiry_received",
      "enquiry_escalated",
      "enquiry_nudged",
      "quote_accepted",
      "quote_partly_accepted",
      "quote_declined",
      "quote_expiring",
    ],
  },
  { key: "reviews", events: ["review_posted", "review_dispute_decided"] },
  { key: "listing", events: ["document_expiring", "setup_nudge", "ramadan_dates_moved"] },
  {
    key: "billing",
    events: ["subscription_renewed", "placement_slot_freed", "payment_failed", "payment_final_notice"],
  },
] as const;

export type AlertGroupKey = (typeof ALERT_GROUPS)[number]["key"];

/** Every row, in screen order. `saveAlerts` writes exactly these. */
export const EVENTS = ALERT_GROUPS.flatMap((group) => group.events);

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

export type AlertEvent = (typeof ALERT_GROUPS)[number]["events"][number];
export type AlertChannel = (typeof CHANNELS)[number];

/**
 * Who each event reaches. Board 7e §2's `GOES TO` column.
 *
 * The matrix is business-wide policy — which channels — and this is the other
 * half: which person. Without it a seller reads a row of ticks with no idea
 * whose handset they are ticking, and the answer is not the same for every row.
 *
 * ## Read off the emitters, not off the board
 *
 * T7.2 checked every row against the `notify()` call in `lib/notify/events.ts`
 * that sends it, and three claims were false. `quote_accepted` and
 * `quote_partly_accepted` said *the assigned seat and the owner*; both are sent
 * to the owner alone. `document_expiring` said *the owner and finance*; it is
 * sent to the owner alone. A seller who relied on the column would have
 * expected a colleague to have been told, and nobody was.
 *
 * So the column now says what the code does. Whether an accepted quote should
 * also reach the seat that wrote it is a product question, and widening the
 * recipients is a change to the emitter, not to this map.
 *
 * `assigned` is what board 7d's routing decided, via `recipientFor` — an
 * `assigned` that names a seat with no verified channel would be a promise
 * nothing keeps, so it falls back to the owner and counts it.
 */
export type Recipient = "assigned" | "owner";

export const GOES_TO: Readonly<Record<AlertEvent, Recipient>> = {
  enquiry_received: "assigned",
  // Escalation is the owner by definition — it exists because the assigned seat did not answer.
  enquiry_escalated: "owner",
  enquiry_nudged: "assigned",
  quote_accepted: "owner",
  quote_partly_accepted: "owner",
  quote_declined: "assigned",
  quote_expiring: "assigned",
  review_posted: "owner",
  review_dispute_decided: "owner",
  document_expiring: "owner",
  setup_nudge: "owner",
  ramadan_dates_moved: "owner",
  subscription_renewed: "owner",
  placement_slot_freed: "owner",
  payment_failed: "owner",
  payment_final_notice: "owner",
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
