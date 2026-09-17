-- Board `11e` `B10` — the two templates `placement_slot_freed` renders.
--
-- After `20261106090500_placement_slot_freed_event_11e`, which adds the enum
-- value this casts to: Postgres refuses a new enum value in the transaction that
-- created it, and Prisma runs each file in one.
--
-- Templates are database rows, and `20261027091000_notification_template_backfill`
-- is frozen the moment Prisma has checksummed it — so a template added after it
-- needs a migration of its own or it exists locally and nowhere a seller can
-- receive it, which is exactly the state that backfill was written to end.
-- `tests/unit/notification-templates.test.ts` reads every migration in the
-- directory and holds them in step with `prisma/seed-notification-templates.mts`.
--
-- Same shape as the backfill, deliberately: a pair that already exists is never
-- touched, so copy somebody has edited on `/admin/notifications` stays as they
-- left it and a second run is a no-op.

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
  ('placement_slot_freed', 'email', 'neutral', 'live', 'The sponsored slot for {scope} is free',
   'The sponsored slot you asked about — {scope} — has come free. It is AED {price} a month plus VAT. Everybody on the waiting list has been sent this, and the first to take it gets it.',
   'Take the slot', '/dashboard/promote', NULL),
  ('placement_slot_freed', 'in_app', 'neutral', 'live', NULL,
   '{scope} is free — AED {price} a month plus VAT. Everybody waiting was told, so it is first come.',
   'Take the slot', '/dashboard/promote', NULL)
) AS v(event, channel, kind, status, subject, body, action_label, action_path, meta_template_name)
WHERE NOT EXISTS (
  SELECT 1 FROM "notification_template" t
  WHERE t."event" = v.event::"notification_event"
    AND t."channel" = v.channel::"notification_channel"
    AND t."locale" = 'en'
);
