import type { NotificationEvent } from "@/lib/db/generated/enums";

/**
 * What each notification event supplies to a template.
 *
 * `render()` refuses a placeholder with no value — *"a notification with a hole
 * in it is worse than one that did not send"* — and until now the only way to
 * find out a template referenced `{quotedValue}` on an event that has no such
 * thing was for a seller not to get told something.
 *
 * This is the list, and it is bound to the call sites rather than parallel to
 * them: `paramsFor` types what `events.ts` passes to `render`, so a param added
 * at a call site and not declared here is a typecheck failure, and one declared
 * here and not passed is the same.
 *
 * ## The events with no params
 *
 * Eight of the fourteen are declared in the enum, seeded with templates, and
 * emitted by nothing. They get an empty list and the admin screen says so. A
 * template written against an event that never fires is not a bug — somebody
 * has to write it before the emitter lands — but staff should know which is
 * which before they spend an afternoon on the copy.
 *
 * That count read "seven of the eleven" over a list of thirteen until board 8a
 * came past, which is what a number written in prose beside a list that grows
 * does. `params.test.ts` counts the keys, so the list cannot drift again.
 */

export const EVENT_PARAMS = {
  enquiry_received: [
    "ref",
    "summary",
    "neededBy",
    "closesAt",
    "area",
    "lineCount",
    "enquiryId",
    "shortLink",
  ],
  quote_received: ["ref", "businessName", "businessSlug", "revision", "enquiryId", "shortLink"],
  quote_revised: ["ref", "businessName", "businessSlug", "revision", "enquiryId", "shortLink"],
  quote_accepted: ["ref", "quoteRef", "amount", "enquiryId", "shortLink"],
  /*
     The first event a scheduled job sends.

     No `ref` and no `enquiryId`: a renewal is about a subscription, and
     `NotificationDelivery` has no column for one — the invoice is the record
     and `shortLink` is how the seller reaches it.
  */
  subscription_renewed: ["planName", "amount", "renewsAt", "shortLink"],
  /*
     Board 8a's one nudge, sent 72 hours after a listing goes live.

     Two declared params and no more, because this is the one event whose
     recipient did not ask for it. `taskList` names what is still open and
     `minutes` is what those tasks cost — the estimates in
     `lib/onboarding/service.ts`, which `lib/setup/tasks.ts` deliberately shares
     so that two screens describing the same four jobs cannot disagree about how
     long one takes.

     **Not points.** A card on the hub shows what a task would still *add*, so a
     seller three photographs in sees a smaller number than the lever's weight.
     A message quoting the full weight would be a bigger number than the screen
     it links to, on the one page whose whole argument is that its figures are
     real. Minutes are the same number wherever they are read.

     Nothing here identifies a person. No `businessName`: the message goes to
     the owner of that listing, who knows whose listing it is, and every param
     added to a notification is a param `render()` has to prove is not a leak.
     No `shortLink` either — the action path is the static `/dashboard/setup`.
  */
  setup_nudge: ["taskList", "minutes"],

  // Declared, seeded, and emitted by nothing yet.
  enquiry_unanswered: [],
  /*
     Board 8d §8 gave this its first emitter. The four are exactly what the
     seeded templates already interpolate — they were written before anything
     sent them, and `render` throws MissingParamError on a placeholder the
     params do not carry, in a cron where nobody is watching.
  */
  enquiry_escalated: ["ref", "hours", "closesAt", "enquiryId"],
  quote_expiring: [],
  /*
     Board 11b's follow-up, and the first message-shaped notification in the
     product. Everything the enquiry spine sends is about a *quote* — received,
     revised, accepted, expiring — because a message was assumed to be read
     where it was written. The follow-up breaks that: it goes to a buyer who has
     gone quiet, and a quiet buyer is not looking at the thread.

     `preview` is the seller's own words, truncated. It is not a summary we
     wrote: the whole rule on that screen is that we suggest the act and never
     the number, so a message body composed here would be the platform putting
     words in a supplier's mouth on a carrier the supplier cannot see.

     No buyer name and no seller contact detail — `render()` refuses anything
     that looks like contact details, and there is nothing here it would need to.
  */
  message_received: ["businessName", "preview", "enquiryId", "shortLink"],
  review_posted: [],
  review_requested: [],
  document_expiring: [],
  /*
     Declared, and deliberately empty — so `isEmitted` reports false and the
     notifications screen shows it as "nothing sends this yet", which is the
     affordance handoff 4 built for exactly this state.

     `sweepAlerts` matches and records; it does not send. `notify` is
     seller-shaped — it reads `NotificationPreference` and quiet hours keyed by
     business — and routing a buyer's alert through the matched supplier's
     preferences would let that seller's quiet hours silence a message to
     somebody else's customer. Buyer-side notification preferences do not exist,
     and inventing them inside this step would be a second pipeline rather than
     a wire.
  */
  product_alert_matched: [],
  weekly_digest: [],
} as const satisfies Record<NotificationEvent, readonly string[]>;

export type ParamsOf<E extends NotificationEvent> = (typeof EVENT_PARAMS)[E][number];

/** True where something in the codebase actually sends this event. */
export function isEmitted(event: NotificationEvent): boolean {
  return EVENT_PARAMS[event].length > 0;
}

export function paramsFor(event: NotificationEvent): readonly string[] {
  return EVENT_PARAMS[event];
}

/**
 * The binding.
 *
 * A call site writes `withParams("enquiry_received", { … })` and the compiler
 * checks the object against the declaration above — every declared key present,
 * and no key that is not declared. Returns the object unchanged; it exists for
 * the type, not for the value.
 */
export function withParams<E extends NotificationEvent>(
  _event: E,
  params: Record<ParamsOf<E>, string | number>,
): Record<string, string | number> {
  return params;
}

/** Every `{placeholder}` a template body, subject or action label references. */
export function placeholdersIn(...parts: (string | null | undefined)[]): string[] {
  const found = new Set<string>();
  for (const part of parts) {
    if (!part) continue;
    for (const match of part.matchAll(/\{([a-zA-Z0-9_]+)\}/g)) found.add(match[1]!);
  }
  return [...found].sort();
}

/**
 * Placeholders a template uses that its event does not supply.
 *
 * Every one of these is a `MissingParamError` at send time, which is a seller
 * not being told something. Caught here, it is a red line under a textarea.
 */
export function unknownPlaceholders(
  event: NotificationEvent,
  ...parts: (string | null | undefined)[]
): string[] {
  const supplied = new Set<string>(paramsFor(event));
  return placeholdersIn(...parts).filter((name) => !supplied.has(name));
}
