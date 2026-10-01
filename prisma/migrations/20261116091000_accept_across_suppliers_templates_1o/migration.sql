-- Board `1o` — the templates for a quote accepted in part, in production.
--
-- Templates are database rows and the seed refuses a non-loopback database, so
-- a template added to `prisma/seed-notification-templates.mts` and not written
-- here would exist locally and in CI and nowhere a supplier could receive it.
-- `tests/unit/notification-templates.test.ts` holds this file to the catalogue.
--
-- Goods only: a brief is answered with one proposal, which has no lines to
-- take a part of. Written only where the line — event, channel and kind — has
-- no row of any version, so a second run is a no-op.
--
-- ## Ordering
--
-- **Rows carrying a new enum value: applied as the last step before the
-- merge**, after `20261116090000_accept_across_suppliers_events_1o`. A Prisma
-- client refuses the whole read when a row carries a value its schema lacks;
-- `templateBoard` scopes its reads since `1n`, but the rule stays: rows last.

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
  ('quote_partly_accepted', 'email', 'goods', 'live', 'Part of your quote {quoteRef} was accepted — {amount}',
   'The buyer on enquiry {ref} accepted {lines}, at {amount}. Your other lines on this quote were not accepted. Their contact details are on the lead. Payment and delivery are between you and the buyer.',
   'Open the accepted lines', '/dashboard/leads/{enquiryId}', NULL),
  ('quote_partly_accepted', 'in_app', 'goods', 'live', NULL,
   'The buyer on {ref} accepted {lines} from {quoteRef}, at {amount}.',
   'Open the accepted lines', '/dashboard/leads/{enquiryId}', NULL)
) AS v(event, channel, kind, status, subject, body, action_label, action_path, meta_template_name)
WHERE NOT EXISTS (
  SELECT 1 FROM "notification_template" t
   WHERE t."event" = v.event::"notification_event"
     AND t."channel" = v.channel::"notification_channel"
     AND t."kind" = v.kind::"template_kind"
     AND t."locale" = 'en'
);
