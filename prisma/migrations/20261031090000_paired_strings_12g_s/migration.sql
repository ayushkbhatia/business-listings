-- Board `12g-s` — paired strings: one key, two halves, chosen by the trade kind
-- of whatever is being rendered.
--
-- 1. `string_state` — written, missing, suppressed. Suppressed and missing both
--    carry no value and mean opposite things (B2), so the state is a column and
--    the CHECK below holds a value to exactly the written rows.
-- 2. `string_kind` — single, goods, services. Not nullable: a unique index over
--    a nullable column treats every null as distinct.
-- 3. `string_entry` — a staff decision about one half. The spec names the model
--    `Message`, which has been the enquiry thread's table since handoff 2. The
--    keys and their code defaults are declared in `lib/i18n/paired.ts`; no row
--    means the default stands. Nothing is carried over: every default already
--    ships in code.
--
-- **Additive, and applies before the merge** (`docs/deployments.md` § Ordering).
-- The code on `main` reads no such table. Idempotent: applied through the
-- Supabase MCP and then recorded, a second run is a no-op.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'string_state') THEN
    CREATE TYPE "string_state" AS ENUM ('written', 'missing', 'suppressed');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'string_kind') THEN
    CREATE TYPE "string_kind" AS ENUM ('single', 'goods', 'services');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "string_entry" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "locale" TEXT NOT NULL DEFAULT 'en',
  "kind" "string_kind" NOT NULL,
  "state" "string_state" NOT NULL,
  "value" TEXT,
  "updated_by_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "string_entry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "string_entry_value_iff_written" CHECK (("state" = 'written') = ("value" IS NOT NULL)),
  CONSTRAINT "string_entry_value_not_blank" CHECK ("value" IS NULL OR char_length(btrim("value")) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "string_entry_key_locale_kind_key" ON "string_entry"("key", "locale", "kind");
CREATE INDEX IF NOT EXISTS "string_entry_state_idx" ON "string_entry"("state");
