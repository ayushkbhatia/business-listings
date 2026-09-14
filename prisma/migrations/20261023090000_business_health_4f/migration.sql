-- Board 4f — businesses and account health.
--
-- Additive. Nothing on `main` reads any of it, so it applies before the merge
-- that does (docs/deployments.md § Ordering).

-- ── 1 · Reply rate, measured beside the median (B5) ─────────────────────────

ALTER TABLE "business" ADD COLUMN IF NOT EXISTS "reply_rate" DOUBLE PRECISION;
ALTER TABLE "business" ADD COLUMN IF NOT EXISTS "reply_sample" INTEGER;

-- A rate is a share and a sample is a count. Both are written by the metrics
-- job alone, and they are set or cleared together: a rate with no sample behind
-- it is a number nobody can check.
DO $$ BEGIN
  ALTER TABLE "business" ADD CONSTRAINT "business_reply_rate_measured"
    CHECK (("reply_rate" IS NULL) = ("reply_sample" IS NULL)
       AND ("reply_rate" IS NULL OR ("reply_rate" >= 0 AND "reply_rate" <= 1))
       AND ("reply_sample" IS NULL OR "reply_sample" > 0));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── 2 · The identifiers an ops call starts from (B7) ────────────────────────
--
-- The composite (licence_authority, licence_number) leads with the authority,
-- and a caller says "four-four-one-nine-oh-eight" without it. Named as Prisma
-- names them, so `migrate dev` reads them as the `@@index` lines they are.

CREATE INDEX IF NOT EXISTS "business_licence_number_idx" ON "business"("licence_number");
CREATE INDEX IF NOT EXISTS "business_trn_idx" ON "business"("trn");
CREATE INDEX IF NOT EXISTS "business_plan_id_idx" ON "business"("plan_id");

-- ── 3 · Saved segments (B8) ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "account_segment" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_segment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "account_segment_name_key" ON "account_segment"("name");
CREATE INDEX IF NOT EXISTS "account_segment_created_at_id_idx" ON "account_segment"("created_at", "id");

DO $$ BEGIN
  ALTER TABLE "account_segment" ADD CONSTRAINT "account_segment_created_by_id_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- A name somebody can read and a query the filter writer could have produced:
-- short, and never an absolute URL.
DO $$ BEGIN
  ALTER TABLE "account_segment" ADD CONSTRAINT "account_segment_shape"
    CHECK (char_length(btrim("name")) BETWEEN 1 AND 80
       AND char_length("query") <= 500
       AND "query" NOT LIKE '%://%');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
