// ─────────────────────────────────────────────────────────────────────────────
// Notification templates — the catalogue the seed writes and the backfill
// migration mirrors.
//
// Database records rather than code: board 12g gives admin an editor, and a
// WhatsApp template cannot change version without Meta approving it first.
//
// Not one of these may name a buyer's phone, email or company. Rule 1 applies
// to notifications, and this is the easiest place in the product to leak it.
//
// ## Why this left `seed.mts`
//
// Production never ran the seed, so every template added here after handoff 2
// existed locally and in CI and nowhere a seller could receive it: on 14 Sep
// 2026 production held 15 rows against this list's 27, and `enquiry_escalated`
// had skipped its in-app delivery 22 times for want of one. Migration
// `20261027091000_notification_template_backfill` writes the missing pairs, and
// `tests/unit/notification-templates.test.ts` holds that file and this list in
// step — so a template added here without the SQL beside it fails a test
// rather than repeating the drift.
//
// `kind` is board 12g `B5`: `goods` where the body speaks in one trade's terms
// (lines, quantities, a quote), `neutral` where it says nothing about trade at
// all. A goods body is the one that owes a services twin; a neutral one never
// does.
// ─────────────────────────────────────────────────────────────────────────────

export interface TemplateSeed {
  event: string;
  channel: string;
  /** Board 12g `B5`. See the note at the top of this file. */
  kind: "goods" | "neutral" | "services";
  subject?: string;
  body: string;
  actionLabel?: string;
  actionPath?: string;
  metaTemplateName?: string;
  status?: string;
}

export const TEMPLATES: TemplateSeed[] = [
  /*
     The renewal receipt.

     Email and in-app, and deliberately no WhatsApp: a receipt is a record
     somebody keeps for their accountant, and `INTERRUPTING_CHANNELS` exists to
     stop us buzzing a phone with something nobody has to act on. It is also the
     only template here sent by a cron rather than by a request.

     The amount is the period's, not the month's — an annual seller reads what
     they were actually charged.
  */
  {
    event: "subscription_renewed",
    channel: "email",
    kind: "neutral",
    /*
       Board 12g found this had no subject. The Resend sender falls back to the
       body's first sentence, so a receipt arrived titled with a whole line of
       prose, and the editor now refuses an email with none — the catalogue could
       not have been re-saved on the console as it stood.
    */
    subject: "Your {planName} plan renewed: {amount}",
    body:
      "Your {planName} plan has been charged {amount}. The next payment is due {renewsAt}. " +
      "Your invoice is on the billing page.",
    actionLabel: "See the invoice",
    actionPath: "/dashboard/billing",
    status: "live",
  },
  {
    event: "subscription_renewed",
    channel: "in_app",
    kind: "neutral",
    body: "{planName} charged {amount}. Next payment {renewsAt}.",
    actionLabel: "See the invoice",
    actionPath: "/dashboard/billing",
    status: "live",
  },
  /*
     Board 11b's follow-up, and the only message-shaped notification in the
     product. Everything else here is about a quote, because a message was
     assumed to be read where it was written — the follow-up breaks that, since
     it is aimed at a buyer who has gone quiet and is not looking at the thread.

     In-app only. The seller gets exactly one follow-up because a second loses
     more deals than it wins; putting that one on WhatsApp would make the cap a
     formality, since the interruption is the part that costs the deal. A buyer
     weighing four quotes reads it where they are already comparing them.

     `preview` is the supplier's own words, truncated. We do not summarise them:
     the rule on that screen is suggest the act and never the number, and a body
     written on this side would be the platform speaking in a supplier's voice.
  */
  {
    event: "message_received",
    channel: "in_app",
    kind: "neutral",
    body: "{businessName} followed up on your enquiry: \"{preview}\"",
    actionLabel: "Open the conversation",
    actionPath: "/enquiry/{enquiryId}",
    status: "live",
  },
  {
    event: "enquiry_received",
    channel: "whatsapp",
    kind: "goods",
    // Two taps from notification to a quote in progress. That deep link is the
    // mechanic behind the reply-speed number, so it carries the enquiry ref
    // and lands on the composer, not on a list.
    body: "New enquiry {ref} for {summary}. Needed by {neededBy} in {area}. {lineCount} lines. Quote before {closesAt}.",
    actionLabel: "Open and quote",
    actionPath: "/dashboard/leads/{enquiryId}",
    metaTemplateName: "bl_enquiry_received_v1",
    status: "pending_meta",
  },
  {
    event: "enquiry_received",
    channel: "in_app",
    kind: "goods",
    body: "New enquiry {ref} — {lineCount} lines for {area}, needed by {neededBy}.",
    actionLabel: "Open and quote",
    actionPath: "/dashboard/leads/{enquiryId}",
    status: "live",
  },
  {
    event: "enquiry_unanswered",
    channel: "whatsapp",
    kind: "goods",
    body: "Enquiry {ref} is still unanswered after {hours} hours. It closes {closesAt}.",
    actionLabel: "Quote now",
    actionPath: "/dashboard/leads/{enquiryId}",
    metaTemplateName: "bl_enquiry_unanswered_v1",
    status: "pending_meta",
  },
  {
    event: "enquiry_escalated",
    channel: "email",
    kind: "neutral",
    subject: "Enquiry {ref} has gone unanswered",
    body: "Enquiry {ref} reached your team {hours} hours ago and has no reply. It closes {closesAt}. Median reply time is part of how suppliers rank in search.",
    actionLabel: "Open the enquiry",
    actionPath: "/dashboard/leads/{enquiryId}",
    status: "live",
  },
  {
    // SMS is the fallback when WhatsApp does not deliver. Deliberately terse:
    // it is one segment, and a two-segment SMS to eight sellers a day is a
    // cost line nobody budgeted for.
    event: "enquiry_received",
    channel: "sms",
    kind: "goods",
    body: "New enquiry {ref}, {lineCount} lines for {area}. Closes {closesAt}. Quote: {shortLink}",
    actionPath: "/dashboard/leads/{enquiryId}",
    status: "live",
  },
  {
    event: "quote_accepted",
    channel: "sms",
    kind: "goods",
    body: "Quote {quoteRef} accepted, {amount}. Contact details are on the enquiry: {shortLink}",
    actionPath: "/dashboard/leads/{enquiryId}",
    status: "live",
  },
  {
    event: "quote_received",
    channel: "in_app",
    kind: "goods",
    body: "{businessName} sent a quote on {ref}, revision {revision}.",
    actionLabel: "Compare quotes",
    actionPath: "/enquiry/{enquiryId}/compare",
    status: "live",
  },
  {
    event: "quote_revised",
    channel: "in_app",
    kind: "goods",
    body: "{businessName} revised their quote on {ref} to revision {revision}.",
    actionLabel: "See what changed",
    actionPath: "/enquiry/{enquiryId}/thread/{businessSlug}",
    status: "live",
  },
  {
    event: "quote_accepted",
    channel: "whatsapp",
    kind: "goods",
    // What happened, what it is worth, one action.
    body: "Your quote {quoteRef} was accepted, {amount}. The buyer's contact details are now on the enquiry.",
    actionLabel: "Open the accepted quote",
    actionPath: "/dashboard/leads/{enquiryId}",
    metaTemplateName: "bl_quote_accepted_v1",
    status: "pending_meta",
  },
  {
    event: "quote_accepted",
    channel: "email",
    kind: "goods",
    subject: "Quote {quoteRef} accepted — {amount}",
    body: "Your quote {quoteRef} for enquiry {ref} was accepted at {amount}. Contact details are on the enquiry page. Payment and delivery are between you and the buyer.",
    actionLabel: "Open the accepted quote",
    actionPath: "/dashboard/leads/{enquiryId}",
    status: "live",
  },
  {
    event: "quote_expiring",
    channel: "in_app",
    kind: "goods",
    body: "Quote {quoteRef} expires {expiresAt}. Extend the validity or let it lapse.",
    actionLabel: "Open the quote",
    actionPath: "/dashboard/quotes",
    status: "live",
  },
  /*
     Board 11c. The seller has twenty-eight days to answer, measured from the
     review — so the copy names the window rather than leaving a deadline to be
     discovered on the page after it has passed, which is the defect the board's
     own expired countdown had.

     The rating and not the words. A notification carrying a two-star review's
     text puts the complaint in front of a supplier before the box they can
     answer it in, and there is no reply box in an email.
  */
  {
    event: "review_posted",
    channel: "email",
    kind: "neutral",
    subject: "A review was posted on your listing",
    body: "A buyer left a {rating} out of 5 review after enquiry {ref}. You have 28 days to reply. One reply, public, and it cannot be edited afterwards.",
    actionLabel: "Read and reply",
    actionPath: "/dashboard/reviews",
    status: "live",
  },
  {
    event: "review_posted",
    channel: "in_app",
    kind: "neutral",
    body: "A {rating} out of 5 review landed after enquiry {ref}. 28 days to reply.",
    actionLabel: "Read and reply",
    actionPath: "/dashboard/reviews",
    status: "live",
  },
  /*
     Board 11c `B2` — the request channel, and the fallback that has to be real.

     The panel says "WhatsApp where we have a number, email otherwise", and that
     is a per-buyer decision made in `lib/reviews/channel.ts` rather than a
     matrix. Both templates exist so both halves of the sentence can happen.

     WhatsApp is `pending_meta` like every other WhatsApp template here — Meta
     approves them, we do not — which is exactly why `requestChannelFor` asks
     the template table what is live before it picks. Until approval every
     request goes by email, and it goes rather than silently not going.

     This was seeded `in_app` and live, which is the one channel a review
     request must not use: it goes to somebody who finished a deal weeks ago and
     has no reason to open the site, so an in-app notification for them is a
     message filed where nobody is standing.
  */
  {
    event: "review_requested",
    channel: "email",
    kind: "goods",
    subject: "{businessName} would like your review",
    body: "You accepted a quote from {businessName} on enquiry {ref}. If you have a minute, other buyers would find it useful to know how it went. One request only — we will not ask again.",
    actionLabel: "Write a review",
    actionPath: "/review/new?enq={enquiryId}",
    status: "live",
  },
  /*
     Board 11c `B5`. The decision leaving the platform.

     The outcome and the ground, and not the moderator's prose: `render()`
     refuses a value that looks like contact details, and a reason explaining
     that a review published somebody's mobile number would throw rather than
     send. The reason is on the review card, which the action opens.
  */
  {
    event: "review_dispute_decided",
    channel: "email",
    kind: "neutral",
    subject: "Your review dispute was decided",
    body: "We have decided your dispute on the ground of {ground}. Outcome: {outcome}. The reason is recorded on the review.",
    actionLabel: "Open the review",
    actionPath: "/dashboard/reviews",
    status: "live",
  },
  {
    event: "review_dispute_decided",
    channel: "in_app",
    kind: "neutral",
    body: "Review dispute decided — {ground}. Outcome: {outcome}.",
    actionLabel: "Open the review",
    actionPath: "/dashboard/reviews",
    status: "live",
  },
  {
    event: "review_requested",
    channel: "whatsapp",
    kind: "goods",
    body: "{businessName} has asked for a review of enquiry {ref}. One request only.",
    actionLabel: "Write a review",
    actionPath: "/review/new?enq={enquiryId}",
    metaTemplateName: "bl_review_requested_v1",
    status: "pending_meta",
  },
  /*
     Board 3e §5. The copy said "drops to tier 2", which was the schema's own
     wording before the site-visit cut and was wrong in the dangerous direction:
     tier 2 *is* licence verification, so a listing left there keeps the badge
     the expiry is supposed to withdraw. It drops to tier 1, claimed.

     The consequence rather than the number, because "tier 1" means nothing to a
     supplier reading their email. The badge and the filter are what they lose,
     and the last sentence is the one the screen also carries: nothing is
     deleted, and a renewal puts it back.
  */
  {
    event: "document_expiring",
    channel: "email",
    kind: "neutral",
    subject: "Your trade licence expires {expiresAt} — {days} days",
    body: "The trade licence on your listing expires {expiresAt}, in {days} days. On the day it lapses your listing stops showing the licence-verified badge and stops matching the licence-verified filter, with no grace period. Your listing, products and enquiries are not affected, and the badge returns as soon as we have checked a renewal.",
    actionLabel: "Upload the renewal",
    actionPath: "/dashboard/verification",
    status: "live",
  },
  /*
     Board 8a's one nudge, and the only template here whose recipient did not
     ask for it.

     WhatsApp because that is what the hub promises out loud — "one WhatsApp
     three days after you went live if anything is still open, then nothing" —
     and in-app because the delivery log should carry a real row rather than a
     skip when Meta has not approved the words yet. **Deliberately no email.**
     An email fallback is a second message, and the promise is one.

     `pending_meta` like every other WhatsApp template: Meta approves the words
     before they can be sent, and seeding one live would have the send layer
     believe in a template that does not exist on the Bird side.
  */
  {
    event: "setup_nudge",
    channel: "whatsapp",
    kind: "neutral",
    // One string rather than two concatenated: the criterion-8 scan in
    // tests/unit/notification-templates.test.ts matches `body: "…"` and reads
    // only the first chunk, so a split body hides half of itself from the check
    // that exists to stop a template carrying contact details.
    body: "Your listing is live and some setup is still open: {taskList}. About {minutes} minutes of work. This is the only reminder we send.",
    actionLabel: "Finish setting up",
    actionPath: "/dashboard/setup",
    metaTemplateName: "bl_setup_nudge_v1",
    status: "pending_meta",
  },
  {
    event: "setup_nudge",
    channel: "in_app",
    kind: "neutral",
    body: "Still open on your listing: {taskList}. About {minutes} minutes of work.",
    actionLabel: "Finish setting up",
    actionPath: "/dashboard/setup",
    status: "live",
  },
  /*
     Board 8d §8 gave this event its first emitter, and the routing matrix has
     always listed `in_app` for it with no template to satisfy — so an
     escalation would have recorded `skipped / no_live_template` on the one
     channel a seller sees without leaving the product.

     Same placeholders as the email above, because `withParams` type-checks one
     set per event and two templates wanting different ones is how `render`
     starts throwing MissingParamError in a cron.
  */
  {
    event: "enquiry_escalated",
    channel: "in_app",
    kind: "neutral",
    body: "Enquiry {ref} reached your team {hours} hours ago and has no reply. It closes {closesAt}.",
    actionLabel: "Open the enquiry",
    actionPath: "/dashboard/leads/{enquiryId}",
    status: "live",
  },
  {
    event: "weekly_digest",
    channel: "email",
    kind: "goods",
    subject: "Your week: {enquiryCount} enquiries, {quoteCount} quotes",
    body: "{enquiryCount} enquiries reached you this week and you quoted {quoteCount}. Median reply time {medianReply}.",
    actionLabel: "Open the dashboard",
    actionPath: "/dashboard",
    status: "live",
  },
  /*
     Board 3d's promise, and the event that had nowhere to land.

     The Ramadan card says "we shift them and email you when they move", and
     `lib/trade/ramadan-shift-job.ts` has called `onRamadanDatesMoved` since
     board 3d landed — against no template and, before board 12g, no routing row
     either, so the call returned without writing a delivery and the job's own
     "who has already been told" query found nobody, every night. `B7` puts it
     on the platform floor with licence expiry: the dates are ours, and a
     seller cannot opt out of being told we corrected them.

     About our dates and not their hours, so it asks for nothing. The window is
     two dates joined by "to" rather than a dash: an SMS or a Meta template
     later would lose a non-GSM character, and the email should read the same.
  */
  {
    event: "ramadan_dates_moved",
    channel: "email",
    kind: "neutral",
    subject: "Ramadan {year} dates have moved",
    body: "We have corrected the Ramadan {year} window on the platform to {from} to {to}. The Ramadan hours you published are unchanged and now apply to those dates. There is nothing you need to do.",
    actionLabel: "See your hours",
    actionPath: "/dashboard/hours",
    status: "live",
  },
  {
    event: "ramadan_dates_moved",
    channel: "in_app",
    kind: "neutral",
    body: "Ramadan {year} now runs {from} to {to}. Your Ramadan hours move with it.",
    actionLabel: "See your hours",
    actionPath: "/dashboard/hours",
    status: "live",
  },
];

