-- Handoff 3, step 4. Team routing, seats, sponsored waitlist, and what a
-- cancellation needs.

CREATE TYPE "lead_routing" AS ENUM ('round_robin', 'by_branch', 'everyone');

-- `everyone` by default because it is what a five-person supplier actually
-- wants. Round-robin and by-branch only start paying off at a scale most of
-- the directory will never reach, and a default nobody understands is a
-- setting that silently loses enquiries.
ALTER TABLE "business"
  ADD COLUMN "lead_routing" "lead_routing" NOT NULL DEFAULT 'everyone',
  ADD COLUMN "lead_escalation_minutes" INTEGER NOT NULL DEFAULT 120;

-- Criterion 10: cancel drops to Free at period end, never immediately. The
-- seller keeps what they paid for until this date.
ALTER TABLE "subscription"
  ADD COLUMN "ends_at" TIMESTAMP(3),
  ADD COLUMN "provider_ref" TEXT;

-- A cancelled subscription has to say when it ends, or nothing can tell the
-- difference between "cancelled, running until the 30th" and "cancelled, over".
ALTER TABLE "subscription"
  ADD CONSTRAINT "subscription_cancellation_has_an_end"
  CHECK (("cancelled_at" IS NULL) = ("ends_at" IS NULL));

CREATE TABLE "team_invite" (
  "id"            TEXT NOT NULL,
  "business_id"   TEXT NOT NULL,
  "email"         TEXT NOT NULL,
  "roles"         "role"[] NOT NULL DEFAULT ARRAY[]::"role"[],
  "invited_by_id" UUID NOT NULL,
  "token"         TEXT NOT NULL,
  "expires_at"    TIMESTAMP(3) NOT NULL,
  "accepted_at"   TIMESTAMP(3),
  "revoked_at"    TIMESTAMP(3),
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "team_invite_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "team_invite"
  ADD CONSTRAINT "team_invite_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "team_invite"
  ADD CONSTRAINT "team_invite_invited_by_id_fkey"
  FOREIGN KEY ("invited_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "placement_waitlist" (
  "id"          TEXT NOT NULL,
  "business_id" TEXT NOT NULL,
  "category_id" TEXT NOT NULL,
  "emirate"     "emirate",
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "notified_at" TIMESTAMP(3),

  CONSTRAINT "placement_waitlist_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "placement_waitlist"
  ADD CONSTRAINT "placement_waitlist_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "placement_waitlist"
  ADD CONSTRAINT "placement_waitlist_category_id_fkey"
  FOREIGN KEY ("category_id") REFERENCES "category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS "team_invite_token_key" ON "team_invite" ("token");
CREATE UNIQUE INDEX IF NOT EXISTS "team_invite_business_id_email_key"
  ON "team_invite" ("business_id", "email");
CREATE INDEX IF NOT EXISTS "team_invite_business_id_idx" ON "team_invite" ("business_id");

-- One waiting entry per business per slot. Joining twice is not twice the queue.
CREATE UNIQUE INDEX IF NOT EXISTS "placement_waitlist_business_category_emirate_key"
  ON "placement_waitlist" ("business_id", "category_id", "emirate");
-- The queue is read in the order people joined it. Not auctioned.
CREATE INDEX IF NOT EXISTS "placement_waitlist_category_emirate_created_idx"
  ON "placement_waitlist" ("category_id", "emirate", "created_at");

-- Postgres treats two NULLs as distinct in a unique index, so the constraint
-- above does not stop a business joining the *national* queue for a category
-- twice — `emirate IS NULL` collides with nothing. A partial index on that
-- case closes it. Joining twice is not twice the queue.
CREATE UNIQUE INDEX IF NOT EXISTS "placement_waitlist_business_category_national_key"
  ON "placement_waitlist" ("business_id", "category_id")
  WHERE "emirate" IS NULL;
