-- Task T6.2 — the four bodies board 11h's dunning sequence sends, in production.
--
-- Templates are database rows and the seed refuses a non-loopback database, so
-- a template added to `prisma/seed-notification-templates.mts` and not written
-- here would exist locally and in CI and nowhere a seller could receive it.
-- `tests/unit/notification-templates.test.ts` reads this file and holds it equal
-- to the catalogue.
--
-- Neutral, email and in-app. A failed card is about the account rather than the
-- trade, so there is no services twin to write; and `PLATFORM_FLOOR` carries
-- both events on exactly these two channels, because losing a paid plan without
-- being told is a consequence rather than marketing (12g `B7`).
--
-- Written only where the line — event, channel and kind — has no row of any
-- version, so copy somebody has since edited on `/admin/notifications` stays as
-- they left it and a second run is a no-op.
--
-- ## Ordering
--
-- **Additive, and applies last, seconds before the merge** — after
-- `20261121090000_payment_dunning_events`, whose two enum values it casts to. A
-- deployed client that meets a row carrying an event value it does not know
-- refuses the **whole read**, not the row: board 1n proved it, and 7b spent
-- thirteen minutes with `/admin/notifications` returning 500 for every event.
-- So these rows wait until the code that sends them is about to ship.

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
  ('payment_failed', 'email', 'neutral', 'live', 'Your {planName} payment did not go through',
   'We could not charge {amount} for your {planName} plan. It usually takes one try on an updated card. You have {daysLeft} days before the plan moves to Free.',
   'Update the card', '/dashboard/billing', NULL),
  ('payment_failed', 'in_app', 'neutral', 'live', NULL,
   '{planName} payment of {amount} did not go through. {daysLeft} days to update the card.',
   'Update the card', '/dashboard/billing', NULL),
  ('payment_final_notice', 'email', 'neutral', 'live', 'Last notice: your {planName} plan moves to Free tomorrow',
   'We still could not charge {amount} for your {planName} plan, so it moves to Free tomorrow. {keptLabel}',
   'Update the card', '/dashboard/billing', NULL),
  ('payment_final_notice', 'in_app', 'neutral', 'live', NULL,
   '{planName} moves to Free tomorrow — {amount} is still unpaid. {keptLabel}',
   'Update the card', '/dashboard/billing', NULL)
) AS v(event, channel, kind, status, subject, body, action_label, action_path, meta_template_name)
WHERE NOT EXISTS (
  SELECT 1 FROM "notification_template" t
   WHERE t."event" = v.event::"notification_event"
     AND t."channel" = v.channel::"notification_channel"
     AND t."kind" = v.kind::"template_kind"
     AND t."locale" = 'en'
);
