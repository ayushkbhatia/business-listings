-- Board 8d: a seat that can be reached, scoped, and re-invited.
--
-- Idempotent throughout. A hand-written migration in this repo has to be, or a
-- later `prisma migrate dev` regenerates it as a drop.

-- ── A seat scoped to one branch ─────────────────────────────────────────────
--
-- `Actor.branchId` has been declared in lib/auth/roles.ts since handoff 0 and
-- read by `withinScope()` and `analyticsScopeFor()` ever since. Nothing has
-- ever populated it, because there was no column to populate it from — so every
-- branch-scoping check in the product has silently returned true, and board 7d's
-- "Fatima, scoped to Al Quoz" has never actually scoped anything.
--
-- Null is every branch, which is what an owner and most managers are.
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "branch_id" TEXT;

-- ── An invitation that can go to a phone ────────────────────────────────────
--
-- The screen offers one box reading "Mobile or email" and `email` was NOT NULL.
-- A supplier's staff are reached on WhatsApp in this market; an invitation that
-- could only be emailed is one half of them would never see.
--
-- `email` becomes nullable rather than gaining a sentinel: a row is one channel
-- or the other, and "" would sort, index and compare as a real address.
ALTER TABLE "team_invite" ADD COLUMN IF NOT EXISTS "phone" TEXT;
ALTER TABLE "team_invite" ADD COLUMN IF NOT EXISTS "branch_id" TEXT;
ALTER TABLE "team_invite" ALTER COLUMN "email" DROP NOT NULL;

-- When the last message actually went, for the once-an-hour resend limit §6
-- asks to enforce server-side. `created_at` cannot answer it: a resend does not
-- create a row.
ALTER TABLE "team_invite" ADD COLUMN IF NOT EXISTS "last_sent_at" TIMESTAMP(3);

-- One outstanding invitation per contact, per channel. Postgres treats NULLs as
-- distinct in a unique index, so this constrains phone invitations without
-- saying anything about the email ones — which is exactly what is wanted.
CREATE UNIQUE INDEX IF NOT EXISTS "team_invite_business_id_phone_key"
  ON "team_invite"("business_id", "phone");

DO $$
BEGIN
    ALTER TABLE "user" ADD CONSTRAINT "user_branch_id_fkey"
        FOREIGN KEY ("branch_id") REFERENCES "location"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE "team_invite" ADD CONSTRAINT "team_invite_branch_id_fkey"
        FOREIGN KEY ("branch_id") REFERENCES "location"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── The Free seat allowance ─────────────────────────────────────────────────
--
-- One seat is the owner and nobody else, so on Free the add-line was
-- permanently disabled, no invitation could ever be sent, and task 3 of the
-- setup hub was uncompletable — 8a's hundred-point score topped out at 92 for
-- the plan every supplier starts on.
--
-- This is the fourth board where a task's target could not be reached through
-- the product: team invitations had no accept route, the photograph cap sat on
-- its target, nothing could create a product, and now this.
--
-- Two is board 8d §3's own recommendation, and its argument is worth keeping:
-- plan-gating this task the way board 8a gates the site visit would be worse,
-- because a site visit costs us money and an invitation does not. Guarded on
-- the old value so it corrects the seeded default and never overwrites a number
-- somebody has since chosen.
UPDATE "plan" SET "team_seats" = 2 WHERE "id" = 'free' AND "team_seats" = 1;
