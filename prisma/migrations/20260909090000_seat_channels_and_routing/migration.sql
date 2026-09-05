-- Boards 7d and 7e: the channel a seat can be reached on, and the routing state
-- that reads it.
--
-- Idempotent throughout, like every hand-written migration here.
--
-- ## Why this is one migration and not two screens' worth
--
-- The handoff README names the failure that belongs to neither board alone:
--
--   > A routing rule assigns a lead to a seat that has no verified notification
--   > channel. The lead is assigned, nobody is told, and it sits until it
--   > escalates — invisible on both screens.
--
-- 7d decides *which* seat, 7e decides *how* that seat is told, and the rule that
-- spans them — a seat with no verified channel cannot be a routing target — has
-- four readers and, until now, nothing to read. 7d's `REACHABLE ON` column,
-- 7d §4's routing skip, 7e §3's reachability rail and 7e's "receives nothing"
-- promise are all one absent table.

-- ─────────────────────────────────────────────────────────────────────────────
-- A seat's channels
--
-- ## Why not User.phone and User.email
--
-- Both exist and neither means what this needs.
--
-- `createProvisionalIdentity` writes `User.phone` with `phone_confirm: false`
-- (lib/auth/flow.ts) and `addressFor` hands whatever is there to the carrier
-- with no check, so a non-null phone is not a verified one — it is false-positive
-- for exactly the population `REACHABLE ON` exists to catch.
--
-- Worse, `adoptProfile` writes phone OR email and nothing anywhere adds the
-- second. A seat that signed up by phone has `email: null` for ever, so
-- "WhatsApp · email" cannot be true of anybody on the current shape.
--
-- ## Why in-app is not a row here
--
-- It needs no address and no verification, and 7e §2 rule 2 makes it always on
-- for anything with a deadline. A row for it would make every seat trivially
-- reachable and the routing rule would mean nothing. Reachability is *an
-- addressable channel somebody verified*; in-app is the floor underneath it.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'seat_channel_kind') THEN
    CREATE TYPE "seat_channel_kind" AS ENUM ('whatsapp', 'sms', 'email');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "seat_channel" (
  "id"          TEXT PRIMARY KEY,
  "user_id"     UUID NOT NULL,
  -- Denormalised from `user.business_id` on purpose: every read on both boards
  -- is "the channels for this business's seats", and the alternative is a join
  -- through `user` on a screen that already joins through it for names.
  "business_id" TEXT NOT NULL,
  "kind"        "seat_channel_kind" NOT NULL,

  -- E.164 for a number, an address for email. Stored as the seat entered it and
  -- normalised by the service, so the column holds one shape per kind.
  "address"     TEXT NOT NULL,

  -- The whole point of the table. NULL means the seat typed a number and never
  -- proved it: hidden from buyers, receives nothing, and not a routing target.
  -- 7e §3 is explicit that the board stated only the first half of that.
  "verified_at" TIMESTAMP(3),

  -- When a code last went out, for the resend throttle. Not the code itself:
  -- `auth_attempt` already owns challenge history and this table has no business
  -- holding a secret.
  "challenge_sent_at" TIMESTAMP(3),

  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
    ALTER TABLE "seat_channel" ADD CONSTRAINT "seat_channel_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE "seat_channel" ADD CONSTRAINT "seat_channel_business_id_fkey"
        FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- One address per kind per seat. A seller with two WhatsApp numbers on one seat
-- is a seller who cannot say which one routing should try, and 7e §3 renders
-- "the order they will be tried" rather than a set.
CREATE UNIQUE INDEX IF NOT EXISTS "seat_channel_user_kind_key"
  ON "seat_channel"("user_id", "kind");

-- The reachability read, on both boards: this business's seats, verified first.
CREATE INDEX IF NOT EXISTS "seat_channel_business_idx"
  ON "seat_channel"("business_id", "verified_at");

-- ─────────────────────────────────────────────────────────────────────────────
-- Routing state
--
-- ## Unrouted is not unassigned
--
-- Both are `assigned_to_id IS NULL` and they mean opposite things. A lead under
-- `everyone` routing is unassigned because nobody was meant to own it; a lead
-- the router *tried* to place and could not is a failure the seller needs to
-- see. 7d §9 calls `unroutable_lead` "the single measurement that tells you
-- whether this pair of screens works", and one nullable column cannot carry it.
--
-- `routed_at` says the router ran. `unrouted_reason` says it ran and found
-- nobody, and why.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'unrouted_reason') THEN
    CREATE TYPE "unrouted_reason" AS ENUM (
      'no_reachable_seat',
      'outside_hours',
      'no_seat_in_branch',
      'routing_off'
    );
  END IF;
END $$;

ALTER TABLE "enquiry_recipient" ADD COLUMN IF NOT EXISTS "routed_at" TIMESTAMP(3);
ALTER TABLE "enquiry_recipient" ADD COLUMN IF NOT EXISTS "unrouted_reason" "unrouted_reason";

-- The router ran and placed it, or ran and did not. It cannot have done both.
DO $$
BEGIN
    ALTER TABLE "enquiry_recipient" ADD CONSTRAINT "enquiry_recipient_routing_outcome"
        CHECK ("unrouted_reason" IS NULL OR "assigned_to_id" IS NULL);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Where round-robin got to.
--
-- The last seat routed to rather than an index, because 7d §8.3 requires the
-- rotation to survive a seat being removed mid-cycle and an integer cursor into
-- a list that just got shorter points at the wrong person. "The next eligible
-- seat after this one, in a stable order" degrades to "the first eligible seat"
-- when the cursor's seat is gone, which is the correct answer rather than an
-- arbitrary one.
ALTER TABLE "business" ADD COLUMN IF NOT EXISTS "routing_cursor_id" UUID;

DO $$
BEGIN
    ALTER TABLE "business" ADD CONSTRAINT "business_routing_cursor_id_fkey"
        FOREIGN KEY ("routing_cursor_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- The index routing makes hot
--
-- `assigned_to_id` has been free to leave unindexed because it is null nearly
-- everywhere — nothing has ever written it except board 3j's manual Assign. The
-- first business that turns routing on is the one that notices: the rail's
-- scope filter, its five tab counts, the quotes pipeline, the speed card and the
-- CSV export all filter on it.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "enquiry_recipient_assignee_idx"
  ON "enquiry_recipient"("assigned_to_id")
  WHERE "assigned_to_id" IS NOT NULL;
