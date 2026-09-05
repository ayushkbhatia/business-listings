-- Boards 7e §4 and §8.1 — the acknowledgement, and proving a channel.

-- ── The out-of-hours acknowledgement ────────────────────────────────────────
--
-- 7e §4. Two columns rather than a template table: the body is one string per
-- business with three tokens in it, and a supplier who wants versions of it is
-- asking for something this board does not describe.
--
-- There is deliberately no `auto_reply_counts_as_first_reply` anything. The
-- board's card said an acknowledgement counts as a first response; it cannot,
-- and `lib/messaging/service.ts` refuses to stamp `first_reply_at` for a
-- message marked `automatic`. If it did, the median every buyer reads as a band
-- would measure a robot, the 18 ranking points for reply time would be won by
-- installing a template, and every seller would switch it on for that reason
-- inside a month.
ALTER TABLE "business"
  ADD COLUMN IF NOT EXISTS "auto_reply_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "business"
  ADD COLUMN IF NOT EXISTS "auto_reply_body" TEXT;

-- ── Proving a channel ───────────────────────────────────────────────────────
--
-- A table of its own, because `seat_channel` says in its own comment that it
-- holds no secret and that is worth keeping true: a row there is read by four
-- screens and joined into the roster, and a hashed code has no business
-- travelling with it.
--
-- One live challenge per channel. Asking again replaces it rather than stacking
-- a second, so the code in the most recent message is the only one that works —
-- the same rule `inviteSeat` applies to an invitation token, for the same
-- reason: two valid codes is a window that stays open as long as somebody keeps
-- pressing the button.
CREATE TABLE IF NOT EXISTS "seat_channel_challenge" (
  "id" TEXT NOT NULL,
  "seat_channel_id" TEXT NOT NULL,
  -- SHA-256 of the six digits. The code is sent and never stored: a leaked
  -- backup of this table proves nothing on its own.
  "code_hash" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  -- Wrong guesses against this one code. The throttle in lib/auth/throttle.ts
  -- counts attempts per address across codes; this counts them per code, so a
  -- new code is a fresh five rather than an escape from the last five.
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "seat_channel_challenge_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  ALTER TABLE "seat_channel_challenge"
    ADD CONSTRAINT "seat_channel_challenge_seat_channel_id_fkey"
    FOREIGN KEY ("seat_channel_id") REFERENCES "seat_channel"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "seat_channel_challenge_channel_key"
  ON "seat_channel_challenge" ("seat_channel_id");
