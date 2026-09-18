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

  /*
     Declared, seeded, and emitted by nothing.

     Board 7e §2 lists one row for this — "Lead unanswered after 2h → Owner. The
     escalation job" — and that job emits `enquiry_escalated`. Two events for one
     thing is a matrix that lies about what the seller controls, so the alerts
     screen shows the one that fires. This stays in the union because the seeded
     template row still names it and `NotificationDelivery.event` is a string
     column with history in it.
  */
  enquiry_unanswered: [],
  /*
     Board 8d §8 gave this its first emitter. The four are exactly what the
     seeded templates already interpolate — they were written before anything
     sent them, and `render` throws MissingParamError on a placeholder the
     params do not carry, in a cron where nobody is watching.
  */
  enquiry_escalated: ["ref", "hours", "closesAt", "enquiryId"],
  /*
     Board 7e §2 adds this row: "3k ships the expiry window and had nothing
     notifying it." The two placeholders are what the seeded template already
     interpolates — `render` throws on a placeholder the params do not carry,
     and this one sends from a cron where nobody is watching.
  */
  quote_expiring: ["quoteRef", "expiresAt"],
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
  /*
     Board 11c. Both of these were declared in the enum, seeded with **live**
     templates carrying placeholders, and emitted by nothing — which made the
     empty list here worse than a missing one. `render()` throws on a
     placeholder the params do not carry, so the first thing that ever called
     either of these was going to be a `MissingParamError`, and the seeded copy
     had been sitting there since handoff 2 looking like a feature.

     `review_posted` closes the loop this board's reply window depends on: a
     seller has twenty-eight days to answer, measured from a review they were
     never told about.

     No buyer name on either, and no seller contact detail. `render()` refuses
     anything that looks like contact details and there is nothing here that
     would need to — a review request says who is asking and what deal it is
     about, and the buyer's own name is not news to the buyer.
  */
  review_posted: ["rating", "ref", "enquiryId"],
  review_requested: ["businessName", "ref", "enquiryId"],
  /*
     Board 11c `B5`, and the shortest param list on this page for a reason.

     The rail promises the outcome and the reason. The **outcome** and the
     ground travel here; the reason does not, and that is a decision rather than
     an omission — `render()` refuses a value that looks like a phone number or
     an email, and a moderator explaining that a review published somebody's
     mobile would throw instead of sending. The prose is on the review card,
     which is where a seller can also see what it is about.
  */
  review_dispute_decided: ["outcome", "ground"],
  /*
     Board 3e §5 — the sixty-day and fourteen-day notices on a trade licence.

     Declared and emitted by nothing until this board. The screen writes the
     whole sequence down — email and banner at sixty days, banner and an amber
     row at fourteen, the tier drop on the day — and a screen that describes a
     job on the job's behalf is a job that has to exist. It did not; the only
     thing that ever read `licenceExpiry` was the nightly sweep that performs
     the drop, so the first a supplier heard about their licence was the badge
     going.

     `days` as well as `expiresAt` because the two notices are the same event at
     different distances, and a template that can say "in 14 days" reads as a
     deadline where a bare date reads as administration. That distinction is the
     board's own argument for the column: *"`28 Sep 2026` in a table does not
     read as urgent."*
  */
  document_expiring: ["expiresAt", "days"],
  /*
     Board 4h `Q5`. Two params, and the reason is `review_dispute_decided`'s:
     the outcome is what the reporter needs, and a moderator's written reason is
     prose about a listing that may itself be a private-information complaint.
     `render()` refuses a value that looks like contact details, so a reason
     saying *"the address field held a residential flat number"* would throw in
     a path where nobody is watching rather than send.
  */
  /*
     Board 13c `B4`: `reference` joins them — the `RP-` number the reporter was
     shown on the confirmation, so an email arriving two days later can be
     matched to the report it answers. It is a placeholder the template may use
     rather than one it must: the wording lives in the template editor on `12g`,
     and a new placeholder is a thing staff add there without a deploy.
  */
  report_resolved: ["businessName", "businessSlug", "outcome", "reference"],
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
  /*
     Board 3d. The Ramadan card promises "we shift them and email you when they
     move", and the whole point of the mail is that it is about *our* dates and
     not their hours — so it carries the year and the corrected window and
     nothing about what the seller should do, because the answer is nothing.

     `year` as well as the two dates because a shift arriving in November is
     about a window four months out, and a mail that opens with two bare dates
     reads as a change to something happening now.
  */
  ramadan_dates_moved: ["year", "from", "to"],
  /*
     Board `11e` `B10`. The scope, and what it costs today.

     `price` is not decoration. A slot's price follows measured demand and is
     recut on the first of each month, so the figure somebody saw when they
     joined a queue in July is not necessarily the figure they would be
     committing to in November — the invoice history already carries a jump from
     1,100 to 1,400 across one such gap. A message that said only "it is free"
     would be inviting a seller to commit to a number they last saw months ago.
  */
  placement_slot_freed: ["scope", "price"],
  weekly_digest: [],
  /*
     Board `7b`. To colleagues, never to a supplier: `requester` and `approver`
     are first names within one buying company, and nothing here reaches the
     other side of an enquiry. `amount` is the value the request was raised at,
     or the words for a quote with no single total.
  */
  approval_requested: ["ref", "quoteRef", "businessName", "amount", "requester", "approvalId"],
  approval_decided: ["ref", "quoteRef", "businessName", "approver", "outcome", "nextStep", "approvalId"],
  off_platform_flagged: ["ref", "businessName"],
} as const satisfies Record<NotificationEvent, readonly string[]>;

export type ParamsOf<E extends NotificationEvent> = (typeof EVENT_PARAMS)[E][number];

/**
 * Board 12g's `FIRED BY` column: the boards whose screens or jobs send each
 * event.
 *
 * Code, not a column. The handoff draws `firedBy` as a field on the template
 * row, and `B6` says it has to be maintained because it is the only record of a
 * template's sender. A field staff type is a field that drifts from the call
 * sites the moment one moves — the failure `B1` names for the send count — so
 * the record lives beside `EVENT_PARAMS`, which is already bound to those call
 * sites by type, and `params.test.ts` holds the two in step: an event that
 * declares params has a sender here, and one that declares none has none.
 *
 * Board ids as the design canvas numbers them, so a row on the console names
 * the board somebody can open.
 */
export const EVENT_SOURCES = {
  // `lib/enquiry/service.ts` fans an RFQ out; `add-recipients.ts` adds suppliers to a brief.
  enquiry_received: ["1h", "1h-s"],
  quote_received: ["3k", "3j-s"],
  quote_revised: ["3k", "3j-s"],
  quote_accepted: ["7c", "7c-s"],
  // `lib/quotes/expiry-job.ts`, which boards 7d and 7e added.
  quote_expiring: ["7e"],
  subscription_renewed: ["11f"],
  setup_nudge: ["8a"],
  enquiry_unanswered: [],
  enquiry_escalated: ["8d"],
  message_received: ["11b"],
  // `submitReview`, which the buyer's review form on board 10f calls.
  review_posted: ["10f"],
  review_requested: ["11c"],
  review_dispute_decided: ["11c"],
  document_expiring: ["3e"],
  report_resolved: ["4h", "13c"],
  product_alert_matched: [],
  ramadan_dates_moved: ["3d"],
  // `endPlacementsFor`, which is what ends a slot for all three of its reasons.
  placement_slot_freed: ["11e"],
  weekly_digest: [],
  // `lib/buyer-company/approvals.ts`, from the accept screen and the approval page.
  approval_requested: ["7b"],
  approval_decided: ["7b"],
  // `postMessage`, when the scanner files an off-platform report on a company enquiry.
  off_platform_flagged: ["7b", "10h"],
} as const satisfies Record<NotificationEvent, readonly string[]>;

/**
 * Who receives each event.
 *
 * Every event goes to one side, and which side decides who can switch it off
 * (`B7`): a seller on board 7e's matrix, a buyer on nothing yet — buyer-side
 * events route through `BUYER_DEFAULT` in `routing.ts`.
 */
export const EVENT_AUDIENCE = {
  enquiry_received: "seller",
  quote_received: "buyer",
  quote_revised: "buyer",
  quote_accepted: "seller",
  quote_expiring: "seller",
  subscription_renewed: "seller",
  setup_nudge: "seller",
  enquiry_unanswered: "seller",
  enquiry_escalated: "seller",
  message_received: "buyer",
  review_posted: "seller",
  review_requested: "buyer",
  review_dispute_decided: "seller",
  document_expiring: "seller",
  /* The person who filed the report, who is a buyer or a member of the public. */
  report_resolved: "buyer",
  product_alert_matched: "buyer",
  ramadan_dates_moved: "seller",
  placement_slot_freed: "seller",
  weekly_digest: "seller",
  approval_requested: "buyer",
  approval_decided: "buyer",
  off_platform_flagged: "buyer",
} as const satisfies Record<NotificationEvent, "seller" | "buyer">;

export type Audience = (typeof EVENT_AUDIENCE)[NotificationEvent];

/**
 * Placeholder names no template may use. Board 12g `B3`.
 *
 * *"No variable resolves to a buyer's contact details or quote count. Enforce it
 * in the resolver, not by convention — `7c` is the only release point."*
 *
 * `render()` already refuses a **value** shaped like a phone number or an
 * email, which catches a caller passing the wrong thing into a safe slot. This
 * is the other half: a **name** that could only ever carry the wrong thing.
 * `{buyerPhone}` is refused before anybody has written a value for it, and so is
 * `{buyerQuoteCount}` — how many quotes a buyer holds is their negotiating position,
 * and a seller told it before acceptance has been handed it by the platform.
 *
 * Substring matches, case-insensitive, so `buyerMobile` and `quotesReceived`
 * are caught with `mobile` and `quotesreceived`. Nothing in `EVENT_PARAMS`
 * matches, and `params.test.ts` says so.
 */
const FORBIDDEN_NAME = [
  "phone",
  "mobile",
  "whatsapp",
  "email",
  "address",
  "contact",
  "buyername",
  "buyercompany",
  "companyname",
  "iban",
  // A buyer's count of quotes held. Not `quoteCount` alone: the weekly digest
  // tells a seller how many *they* sent, which is theirs to know.
  "buyerquote",
  "quotesreceived",
  "quotesheld",
  "competingquote",
] as const;

/** Placeholders whose name could only carry contact details or a buyer's quote count. */
export function forbiddenPlaceholders(...parts: (string | null | undefined)[]): string[] {
  return placeholdersIn(...parts).filter((name) => isForbiddenParam(name));
}

export function isForbiddenParam(name: string): boolean {
  const lower = name.toLowerCase();
  return FORBIDDEN_NAME.some((fragment) => lower.includes(fragment));
}

/**
 * What a template looks like filled in, for the editor's preview and for
 * `Send test to me` (`B10`).
 *
 * Plausible and never real: no business, enquiry or person in here exists, and
 * `render()` still checks every value, so a sample shaped like contact details
 * would throw on the console exactly as it would at a carrier. Lengths are
 * realistic rather than short, because `B8`'s 160 characters is measured
 * against this — a sample `{area}` of "JLT" would let an SMS through that
 * "Dubai Investments Park 2" overflows.
 *
 * `origin` is the site's own, so a test link is a link to this deployment.
 */
export function sampleParams<E extends NotificationEvent>(
  event: E,
  origin: string,
): Record<ParamsOf<E>, string | number> {
  const all = {
    ref: "ENQ-48213",
    summary: "Chilled water pumps for a residential tower",
    neededBy: "4 Oct 2026",
    closesAt: "21 Sep 2026",
    area: "Dubai Investments Park 2",
    lineCount: 3,
    enquiryId: "sample-enquiry",
    shortLink: `${origin}/dashboard/leads/sample-enquiry`,
    businessName: "Gulf Pump Engineering",
    businessSlug: "gulf-pump-engineering",
    revision: 2,
    quoteRef: "Q-48213-2",
    amount: "AED 15,344",
    planName: "Basic",
    renewsAt: "14 Oct 2026",
    taskList: "photos, opening hours and a second contact",
    minutes: 12,
    hours: 2,
    preview: "We can deliver the pumps from stock in Jebel Ali next week if that suits.",
    rating: 4,
    outcome: "Upheld",
    reference: "RP-4K2M9XQT",
    ground: "Not a real transaction",
    expiresAt: "28 Oct 2026",
    days: 14,
    year: "2027",
    from: "8 Feb 2027",
    to: "9 Mar 2027",
    scope: "Valves & actuators · Dubai",
    price: "439",
    requester: "Priya",
    approver: "Rami Haddad",
    approvalId: "sample-approval",
    nextStep: "The quote is accepted and the supplier has your contact details.",
  } as const;
  const params: Record<string, string | number> = {};
  for (const name of EVENT_PARAMS[event]) params[name] = all[name as keyof typeof all];
  return params as Record<ParamsOf<E>, string | number>;
}

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
