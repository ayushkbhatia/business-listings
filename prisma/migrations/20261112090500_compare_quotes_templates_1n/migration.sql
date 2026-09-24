-- Board `1n` — the templates for the three events around comparing quotes, in
-- production.
--
-- Templates are database rows and the seed refuses a non-loopback database, so
-- a template added to `prisma/seed-notification-templates.mts` and not written
-- here would exist locally and in CI and nowhere a supplier or a buyer could
-- receive it. `tests/unit/notification-templates.test.ts` reads this file and
-- holds it equal to the catalogue.
--
-- Each event has a goods body and a services twin (board 12g `B5`): a brief is
-- answered with proposals, by firms. The WhatsApp pair lands `pending_meta` —
-- Meta approves the wording before anything can send on it.
--
-- Written only where the line — event, channel and kind — has no row of any
-- version, so copy somebody has since edited on `/admin/notifications` stays as
-- they left it and a second run is a no-op. Unlike the backfills before it, the
-- guard names the kind: these arrive with their twins, and a guard on the event
-- and channel alone would write the goods body and skip the services one.
--
-- ## Ordering
--
-- **Additive, and applies after `20261112090000_compare_quotes_events_1n`**,
-- whose enum values it casts to. Content rather than schema.

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
  ('quote_declined', 'email', 'goods', 'live', 'Your quote {quoteRef} was not accepted',
   'The buyer on enquiry {ref} — {summary} — accepted another supplier''s quote. Yours stays in your pipeline, marked lost, and nothing more is needed from you.',
   'See the enquiry', '/dashboard/leads/{enquiryId}', NULL),
  ('quote_declined', 'in_app', 'goods', 'live', NULL,
   'The buyer on {ref} accepted another supplier''s quote. {quoteRef} is marked lost.',
   'See the enquiry', '/dashboard/leads/{enquiryId}', NULL),
  ('quote_declined', 'email', 'services', 'live', 'Your proposal {quoteRef} was not accepted',
   'The buyer on brief {ref} — {summary} — accepted another firm''s proposal. Yours stays in your pipeline, marked lost, and nothing more is needed from you.',
   'See the brief', '/dashboard/leads/{enquiryId}', NULL),
  ('quote_declined', 'in_app', 'services', 'live', NULL,
   'The buyer on {ref} accepted another firm''s proposal. {quoteRef} is marked lost.',
   'See the brief', '/dashboard/leads/{enquiryId}', NULL),
  ('enquiry_nudged', 'whatsapp', 'goods', 'pending_meta', NULL,
   'A reminder from the buyer on {ref}: they are waiting for your quote on {summary}. The enquiry closes {closesAt}.',
   'Open the enquiry', '/dashboard/leads/{enquiryId}', 'enquiry_nudged_v1'),
  ('enquiry_nudged', 'email', 'goods', 'live', 'The buyer on {ref} is waiting for your quote',
   'A reminder, sent once by the buyer: they are waiting for your quote on {ref} — {summary}. The enquiry closes {closesAt}, and no quote can be sent after that.',
   'Open the enquiry', '/dashboard/leads/{enquiryId}', NULL),
  ('enquiry_nudged', 'in_app', 'goods', 'live', NULL,
   'The buyer on {ref} nudged you: they are waiting for your quote. It closes {closesAt}.',
   'Open the enquiry', '/dashboard/leads/{enquiryId}', NULL),
  ('enquiry_nudged', 'whatsapp', 'services', 'pending_meta', NULL,
   'A reminder from the buyer on brief {ref}: they are waiting for your proposal on {summary}. The brief closes {closesAt}.',
   'Open the brief', '/dashboard/leads/{enquiryId}', 'enquiry_nudged_services_v1'),
  ('enquiry_nudged', 'email', 'services', 'live', 'The buyer on {ref} is waiting for your proposal',
   'A reminder, sent once by the buyer: they are waiting for your proposal on {ref} — {summary}. The brief closes {closesAt}, and no proposal can be sent after that.',
   'Open the brief', '/dashboard/leads/{enquiryId}', NULL),
  ('enquiry_nudged', 'in_app', 'services', 'live', NULL,
   'The buyer on {ref} nudged you: they are waiting for your proposal. It closes {closesAt}.',
   'Open the brief', '/dashboard/leads/{enquiryId}', NULL),
  ('enquiry_closing', 'email', 'goods', 'live', '{quotes} on {ref} can be accepted until {closesAt}',
   'You have {quotes} on enquiry {ref}. It closes {closesAt}, and after that none of them can be accepted — the enquiry would have to be sent again. Compare them and accept one, or ask a supplier a question first.',
   'Compare the quotes', '/enquiry/{enquiryId}/compare', NULL),
  ('enquiry_closing', 'in_app', 'goods', 'live', NULL,
   '{quotes} on {ref} can be accepted until {closesAt}. After that, none of them can.',
   'Compare the quotes', '/enquiry/{enquiryId}/compare', NULL),
  ('enquiry_closing', 'email', 'services', 'live', '{quotes} on {ref} can be accepted until {closesAt}',
   'You have {quotes} on brief {ref}. It closes {closesAt}, and after that none of them can be accepted — the brief would have to be sent again. Compare them and accept one, or ask a firm a question first.',
   'Compare the proposals', '/enquiry/{enquiryId}/compare', NULL),
  ('enquiry_closing', 'in_app', 'services', 'live', NULL,
   '{quotes} on {ref} can be accepted until {closesAt}. After that, none of them can.',
   'Compare the proposals', '/enquiry/{enquiryId}/compare', NULL)
) AS v(event, channel, kind, status, subject, body, action_label, action_path, meta_template_name)
WHERE NOT EXISTS (
  SELECT 1 FROM "notification_template" t
   WHERE t."event" = v.event::"notification_event"
     AND t."channel" = v.channel::"notification_channel"
     AND t."kind" = v.kind::"template_kind"
     AND t."locale" = 'en'
);
