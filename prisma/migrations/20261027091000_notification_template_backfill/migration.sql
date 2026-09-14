-- Board `12g` — the templates production never received.
--
-- Templates are database rows, and until this board the only thing that wrote
-- them was `prisma/seed.mts`, which refuses a non-loopback database. So every
-- template added after handoff 2 existed locally and in CI and nowhere a seller
-- could receive it. On 14 Sep 2026 production held 15 rows against the seed's
-- 27; `enquiry_escalated` had skipped its in-app delivery 22 times with
-- `no_live_template`, and the renewal receipt, the follow-up message, the
-- review request by email, the dispute decision and the setup nudge had no row
-- at all.
--
-- This writes the catalogue in `prisma/seed-notification-templates.mts` — the
-- same list the seed now reads, held in step by
-- `tests/unit/notification-templates.test.ts` — for every event and channel
-- that has **no row of any version**. A pair that exists is never touched, so
-- copy somebody has since edited on the console stays exactly as they left it,
-- and a second run is a no-op.
--
-- Two templates are new rather than copied: `ramadan_dates_moved` on email and
-- in-app. Board 3d's card promises "we email you when they move", and the job
-- behind it has been calling an event with nothing to render.
--
-- WhatsApp rows land `pending_meta`, as the seed writes them: Meta approves the
-- wording, and a backfill claiming otherwise would have the send layer believe
-- in a template the carrier does not have.
--
-- **Additive, and applies after `20261027090000_notification_templates_12g`**,
-- whose `kind` column it writes. Content rather than schema, and the only write
-- of it: from here on templates are created on `/admin/notifications`, which
-- audits every one.

INSERT INTO "notification_template" (
  "id", "event", "channel", "locale", "kind", "version", "status",
  "subject", "body", "action_label", "action_path", "meta_template_name",
  "created_at", "updated_at"
)
SELECT
  gen_random_uuid()::text,
  v.event::"notification_event",
  v.channel::"notification_channel",
  'en',
  v.kind::"template_kind",
  1,
  v.status::"template_approval",
  v.subject, v.body, v.action_label, v.action_path, v.meta_template_name,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (VALUES
  ('subscription_renewed', 'email', 'neutral', 'live', 'Your {planName} plan renewed: {amount}',
   'Your {planName} plan has been charged {amount}. The next payment is due {renewsAt}. Your invoice is on the billing page.',
   'See the invoice', '/dashboard/billing', NULL),
  ('subscription_renewed', 'in_app', 'neutral', 'live', NULL,
   '{planName} charged {amount}. Next payment {renewsAt}.',
   'See the invoice', '/dashboard/billing', NULL),
  ('message_received', 'in_app', 'neutral', 'live', NULL,
   '{businessName} followed up on your enquiry: "{preview}"',
   'Open the conversation', '/enquiry/{enquiryId}', NULL),
  ('enquiry_received', 'whatsapp', 'goods', 'pending_meta', NULL,
   'New enquiry {ref} for {summary}. Needed by {neededBy} in {area}. {lineCount} lines. Quote before {closesAt}.',
   'Open and quote', '/dashboard/leads/{enquiryId}', 'bl_enquiry_received_v1'),
  ('enquiry_received', 'in_app', 'goods', 'live', NULL,
   'New enquiry {ref} — {lineCount} lines for {area}, needed by {neededBy}.',
   'Open and quote', '/dashboard/leads/{enquiryId}', NULL),
  ('enquiry_unanswered', 'whatsapp', 'goods', 'pending_meta', NULL,
   'Enquiry {ref} is still unanswered after {hours} hours. It closes {closesAt}.',
   'Quote now', '/dashboard/leads/{enquiryId}', 'bl_enquiry_unanswered_v1'),
  ('enquiry_escalated', 'email', 'neutral', 'live', 'Enquiry {ref} has gone unanswered',
   'Enquiry {ref} reached your team {hours} hours ago and has no reply. It closes {closesAt}. Median reply time is part of how suppliers rank in search.',
   'Open the enquiry', '/dashboard/leads/{enquiryId}', NULL),
  ('enquiry_received', 'sms', 'goods', 'live', NULL,
   'New enquiry {ref}, {lineCount} lines for {area}. Closes {closesAt}. Quote: {shortLink}',
   NULL, '/dashboard/leads/{enquiryId}', NULL),
  ('quote_accepted', 'sms', 'goods', 'live', NULL,
   'Quote {quoteRef} accepted, {amount}. Contact details are on the enquiry: {shortLink}',
   NULL, '/dashboard/leads/{enquiryId}', NULL),
  ('quote_received', 'in_app', 'goods', 'live', NULL,
   '{businessName} sent a quote on {ref}, revision {revision}.',
   'Compare quotes', '/enquiry/{enquiryId}/compare', NULL),
  ('quote_revised', 'in_app', 'goods', 'live', NULL,
   '{businessName} revised their quote on {ref} to revision {revision}.',
   'See what changed', '/enquiry/{enquiryId}/thread/{businessSlug}', NULL),
  ('quote_accepted', 'whatsapp', 'goods', 'pending_meta', NULL,
   'Your quote {quoteRef} was accepted, {amount}. The buyer''s contact details are now on the enquiry.',
   'Open the accepted quote', '/dashboard/leads/{enquiryId}', 'bl_quote_accepted_v1'),
  ('quote_accepted', 'email', 'goods', 'live', 'Quote {quoteRef} accepted — {amount}',
   'Your quote {quoteRef} for enquiry {ref} was accepted at {amount}. Contact details are on the enquiry page. Payment and delivery are between you and the buyer.',
   'Open the accepted quote', '/dashboard/leads/{enquiryId}', NULL),
  ('quote_expiring', 'in_app', 'goods', 'live', NULL,
   'Quote {quoteRef} expires {expiresAt}. Extend the validity or let it lapse.',
   'Open the quote', '/dashboard/quotes', NULL),
  ('review_posted', 'email', 'neutral', 'live', 'A review was posted on your listing',
   'A buyer left a {rating} out of 5 review after enquiry {ref}. You have 28 days to reply. One reply, public, and it cannot be edited afterwards.',
   'Read and reply', '/dashboard/reviews', NULL),
  ('review_posted', 'in_app', 'neutral', 'live', NULL,
   'A {rating} out of 5 review landed after enquiry {ref}. 28 days to reply.',
   'Read and reply', '/dashboard/reviews', NULL),
  ('review_requested', 'email', 'goods', 'live', '{businessName} would like your review',
   'You accepted a quote from {businessName} on enquiry {ref}. If you have a minute, other buyers would find it useful to know how it went. One request only — we will not ask again.',
   'Write a review', '/review/new?enq={enquiryId}', NULL),
  ('review_dispute_decided', 'email', 'neutral', 'live', 'Your review dispute was decided',
   'We have decided your dispute on the ground of {ground}. Outcome: {outcome}. The reason is recorded on the review.',
   'Open the review', '/dashboard/reviews', NULL),
  ('review_dispute_decided', 'in_app', 'neutral', 'live', NULL,
   'Review dispute decided — {ground}. Outcome: {outcome}.',
   'Open the review', '/dashboard/reviews', NULL),
  ('review_requested', 'whatsapp', 'goods', 'pending_meta', NULL,
   '{businessName} has asked for a review of enquiry {ref}. One request only.',
   'Write a review', '/review/new?enq={enquiryId}', 'bl_review_requested_v1'),
  ('document_expiring', 'email', 'neutral', 'live', 'Your trade licence expires {expiresAt} — {days} days',
   'The trade licence on your listing expires {expiresAt}, in {days} days. On the day it lapses your listing stops showing the licence-verified badge and stops matching the licence-verified filter, with no grace period. Your listing, products and enquiries are not affected, and the badge returns as soon as we have checked a renewal.',
   'Upload the renewal', '/dashboard/verification', NULL),
  ('setup_nudge', 'whatsapp', 'neutral', 'pending_meta', NULL,
   'Your listing is live and some setup is still open: {taskList}. About {minutes} minutes of work. This is the only reminder we send.',
   'Finish setting up', '/dashboard/setup', 'bl_setup_nudge_v1'),
  ('setup_nudge', 'in_app', 'neutral', 'live', NULL,
   'Still open on your listing: {taskList}. About {minutes} minutes of work.',
   'Finish setting up', '/dashboard/setup', NULL),
  ('enquiry_escalated', 'in_app', 'neutral', 'live', NULL,
   'Enquiry {ref} reached your team {hours} hours ago and has no reply. It closes {closesAt}.',
   'Open the enquiry', '/dashboard/leads/{enquiryId}', NULL),
  ('weekly_digest', 'email', 'goods', 'live', 'Your week: {enquiryCount} enquiries, {quoteCount} quotes',
   '{enquiryCount} enquiries reached you this week and you quoted {quoteCount}. Median reply time {medianReply}.',
   'Open the dashboard', '/dashboard', NULL),
  ('ramadan_dates_moved', 'email', 'neutral', 'live', 'Ramadan {year} dates have moved',
   'We have corrected the Ramadan {year} window on the platform to {from} to {to}. The Ramadan hours you published are unchanged and now apply to those dates. There is nothing you need to do.',
   'See your hours', '/dashboard/hours', NULL),
  ('ramadan_dates_moved', 'in_app', 'neutral', 'live', NULL,
   'Ramadan {year} now runs {from} to {to}. Your Ramadan hours move with it.',
   'See your hours', '/dashboard/hours', NULL)
) AS v(event, channel, kind, status, subject, body, action_label, action_path, meta_template_name)
WHERE NOT EXISTS (
  SELECT 1 FROM "notification_template" t
  WHERE t."event" = v.event::"notification_event"
    AND t."channel" = v.channel::"notification_channel"
    AND t."locale" = 'en'
);
