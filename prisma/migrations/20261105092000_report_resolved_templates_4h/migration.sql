-- Board `4h` `Q5` — the two templates that answer a report, in production.
--
-- Templates are database rows, and `prisma/seed.mts` refuses a non-loopback
-- database — so a template added to the catalogue and not written here exists
-- locally and in CI and nowhere a reporter could receive it. That is exactly
-- how production came to hold 15 rows against the seed's 27 on 14 Sep 2026;
-- `20261027091000_notification_template_backfill` fixed it, and is frozen.
-- `tests/unit/notification-templates.test.ts` reads every backfill file in the
-- migrations directory, so this one keeps the catalogue honest in its turn.
--
-- Email and in-app only. A closed case is a thing to read, not a thing to act
-- on, and `INTERRUPTING_CHANNELS` keeps it off somebody's phone.
--
-- Written only where the pair has no row of any version, so copy somebody has
-- since edited on `/admin/notifications` stays exactly as they left it and a
-- second run is a no-op.
--
-- ## Ordering
--
-- **Additive, and applies after `20261105091000_report_resolved_event_4h`**,
-- whose enum value it casts to. Content rather than schema.

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
  ('report_resolved', 'email', 'neutral', 'live', 'We looked at what you reported',
   'Thank you for telling us about {businessName}. We have finished looking at it. Outcome: {outcome}. If the listing still looks wrong, report it again and we will take another look.',
   'Open the listing', '/b/{businessSlug}', NULL),
  ('report_resolved', 'in_app', 'neutral', 'live', NULL,
   'Your report about {businessName} is closed. Outcome: {outcome}.',
   'Open the listing', '/b/{businessSlug}', NULL)
) AS v(event, channel, kind, status, subject, body, action_label, action_path, meta_template_name)
WHERE NOT EXISTS (
  SELECT 1 FROM "notification_template" t
   WHERE t."event" = v.event::"notification_event"
     AND t."channel" = v.channel::"notification_channel"
     AND t."locale" = 'en'
);
