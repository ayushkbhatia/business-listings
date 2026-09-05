-- Board 7e §3 — an unverified channel receives nothing.
--
-- The rule the two boards rest on is about to start gating delivery in
-- `lib/notify/service.ts`, which until now addressed a notification from
-- `user.phone` and `user.email` directly. Turning that on against an empty
-- `seat_channel` would silence every seller notification in the product on the
-- deploy that shipped it — the same silent dead end this pair of screens exists
-- to close, arriving from the other direction.
--
-- So the table starts out holding what was already true. Every seller seat's
-- address becomes a verified channel, because it already receives, and because
-- it is proven: `lib/auth/flow.ts` signs a seat in by OTP to that phone or that
-- address, and `acceptInvite` binds a seat to the contact the invitation went
-- to. Nothing here invents a verification that did not happen; it records the
-- one that did.
--
-- From here the column means what it says: a channel added after this is
-- unverified until somebody proves it.
--
-- SMS is deliberately not backfilled. Board 7e §10.3 recommends keeping the
-- column and defaulting it off — every SMS is billed per message and duplicates
-- WhatsApp for most sellers — so a seat that wants one adds it on the screen.
--
-- Idempotent: `ON CONFLICT DO NOTHING` against the (user_id, kind) unique, so
-- re-running this migration on a database that already has channels is a no-op
-- rather than a duplicate-key failure.

INSERT INTO "seat_channel" ("id", "user_id", "business_id", "kind", "address", "verified_at", "created_at", "updated_at")
SELECT
  -- cuid() is application-side; a migration needs its own id, and the pair
  -- (user, kind) is already unique so a deterministic one is safe.
  'seed_' || replace(u."id"::text, '-', '') || '_wa',
  u."id",
  u."business_id",
  'whatsapp'::"seat_channel_kind",
  u."phone",
  now(),
  now(),
  now()
FROM "user" u
WHERE u."business_id" IS NOT NULL
  AND u."phone" IS NOT NULL
  AND u."is_provisional" = false
ON CONFLICT ("user_id", "kind") DO NOTHING;

INSERT INTO "seat_channel" ("id", "user_id", "business_id", "kind", "address", "verified_at", "created_at", "updated_at")
SELECT
  'seed_' || replace(u."id"::text, '-', '') || '_em',
  u."id",
  u."business_id",
  'email'::"seat_channel_kind",
  lower(u."email"),
  now(),
  now(),
  now()
FROM "user" u
WHERE u."business_id" IS NOT NULL
  AND u."email" IS NOT NULL
  AND u."is_provisional" = false
ON CONFLICT ("user_id", "kind") DO NOTHING;
