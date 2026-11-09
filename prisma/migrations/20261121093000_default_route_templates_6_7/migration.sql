-- Task T6.7 — the six bodies the new build check found missing.
--
-- Templates are database rows and the seed refuses a non-loopback database, so
-- a template added to `prisma/seed-notification-templates.mts` and not written
-- here would exist locally and in CI and nowhere a seller could receive it.
-- `tests/unit/notification-templates.test.ts` reads this file and holds it equal
-- to the catalogue.
--
-- ## What was missing, and why nobody knew
--
-- Each of these is a channel the recipient gets **without choosing anything** —
-- `DEFAULT_ROUTING` plus `PLATFORM_FLOOR` for a seller, `BUYER_DEFAULT` for a
-- buyer — with no body behind it. `notify` recorded `no_live_template` and
-- carried on, which is right at runtime and invisible in practice: the same
-- shape that let production hold 15 templates against a catalogue of 27 and
-- skip `enquiry_escalated`'s in-app delivery twenty-two times with nothing
-- failing.
--
--   · `enquiry_received` on email — the most important message in the product,
--     and the one that decides whether an imported listing hears about its
--     first enquiry;
--   · `quote_expiring` on email — a seller not logged in that week lost the
--     quote, which is the case the message exists for;
--   · `setup_nudge` on email — sent once ever, to a list a seller who had not
--     come back was not looking at;
--   · `document_expiring` on in-app — the badge notice on the channel that
--     always works, for a seller with no verified email;
--   · `quote_accepted` on in-app — an acceptance in the list the work appears
--     in, which 7e §2.2 keeps whatever else is switched off;
--   · `quote_received` on WhatsApp — `BUYER_DEFAULT` has promised this channel
--     since the defaults were written and **no body existed at all**. Written
--     `pending_meta`, because a WhatsApp body cannot be live until Meta
--     approves it.
--
-- No enum value is new here, so unlike `20261121091000_payment_dunning_templates`
-- this one is **additive in the ordinary sense and applies before the merge**: a
-- deployed client already knows every event named below.
--
-- Written only where the line — event, channel and kind — has no row of any
-- version, so copy somebody has since edited on `/admin/notifications` stays as
-- they left it and a second run is a no-op.

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
  ('document_expiring', 'in_app', 'neutral', 'live', NULL,
   'Your trade licence expires {expiresAt}, in {days} days. The licence-verified badge goes on the day it lapses, with no grace period, and returns when we have checked a renewal.',
   'Upload the renewal', '/dashboard/verification', NULL),
  ('enquiry_received', 'email', 'goods', 'live', 'New enquiry {ref} — {summary}',
   'A buyer needs {summary} in {area} by {neededBy}. Enquiry {ref} has {lineCount} lines and is open for quotes until {closesAt}. Reply times are measured from this message.',
   'Open and quote', '/dashboard/leads/{enquiryId}', NULL),
  ('quote_accepted', 'in_app', 'goods', 'live', NULL,
   'Quote {quoteRef} accepted at {amount}. The buyer''s contact details are on enquiry {ref}.',
   'Open the accepted quote', '/dashboard/leads/{enquiryId}', NULL),
  ('quote_expiring', 'email', 'goods', 'live', 'Quote {quoteRef} expires {expiresAt}',
   'Quote {quoteRef} expires {expiresAt}. Extend its validity if it still stands, or let it lapse — a lapsed quote cannot be accepted, and the buyer is told when it goes.',
   'Open the quote', '/dashboard/quotes', NULL),
  ('setup_nudge', 'email', 'neutral', 'live', 'A few minutes of setup left on your listing',
   'Your listing is live, and this is still open: {taskList}. About {minutes} minutes of work. This is the only reminder we send.',
   'Finish setting up', '/dashboard/setup', NULL),
  ('quote_received', 'whatsapp', 'goods', 'pending_meta', NULL,
   '{businessName} sent a quote for enquiry {ref}. Compare it with the others before you accept.',
   'See the quote', '/enquiry/{enquiryId}', 'bl_quote_received_v1')
) AS v(event, channel, kind, status, subject, body, action_label, action_path, meta_template_name)
WHERE NOT EXISTS (
  SELECT 1 FROM "notification_template" t
   WHERE t."event" = v.event::"notification_event"
     AND t."channel" = v.channel::"notification_channel"
     AND t."kind" = v.kind::"template_kind"
     AND t."locale" = 'en'
);
