-- Board 6b: a curated list becomes a dated snapshot instead of a live query.
--
-- Idempotent throughout, like every hand-written migration here.
--
-- ## What changed, and why it reverses a decision
--
-- Membership used to be computed on every read. The schema said so and meant it:
-- "a supplier whose reply time slips leaves the list without anybody running
-- anything". Board 6b §3 is why that cannot work.
--
-- The entries are hand-written and they cross-reference each other. Entry 03
-- reads "slower to reply than the two above". The `BEST FOR:` lines are chosen
-- so twelve recommendations do not overlap. The rank numerals are editorial.
-- A nightly job that re-evaluated and reordered would keep the *data* true and
-- make the *copy* false — and no automated process can rewrite the copy.
--
-- So: every figure the reader sees is a snapshot taken on the audit date, the
-- page states that date twice, and a nightly job writes drift to a queue a
-- person works rather than acting on it. One failure is still hard-suppressed
-- in the build — a lapsed licence — because that is the one that makes the
-- page's central claim false rather than merely stale.
--
-- ## What that costs, and where it went
--
-- "Placement cannot be bought" used to be free: there was no row to write. Now
-- there is one, so the guarantee moved into `lib/seo/curated/audit.ts`, which
-- refuses to record a member who fails the criteria at audit time and writes an
-- audited row naming who decided. `curated_list_audit` is the evidence, and it
-- is retained rather than overwritten — a record that is replaced on every
-- re-audit is not evidence, it is the current claim restated.

-- ── The list's own record ───────────────────────────────────────────────────
ALTER TABLE "curated_list" ADD COLUMN IF NOT EXISTS "standfirst" TEXT;
ALTER TABLE "curated_list" ADD COLUMN IF NOT EXISTS "criteria" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "curated_list" ADD COLUMN IF NOT EXISTS "audited_at" TIMESTAMP(3);
ALTER TABLE "curated_list" ADD COLUMN IF NOT EXISTS "editor_id" UUID;
ALTER TABLE "curated_list" ADD COLUMN IF NOT EXISTS "considered_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "curated_list" ADD COLUMN IF NOT EXISTS "entry_removed_at" TIMESTAMP(3);
ALTER TABLE "curated_list" ADD COLUMN IF NOT EXISTS "reaudit_due_at" TIMESTAMP(3);

DO $$
BEGIN
    ALTER TABLE "curated_list" ADD CONSTRAINT "curated_list_editor_id_fkey"
        FOREIGN KEY ("editor_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- The SLA sweep reads this. Partial, because a list with no audit has no SLA to
-- have expired and is not a row that sweep should walk.
CREATE INDEX IF NOT EXISTS "curated_list_reaudit_due_at_idx"
  ON "curated_list"("reaudit_due_at")
  WHERE "reaudit_due_at" IS NOT NULL;

-- ── Who is on the list, and the figures as they stood ───────────────────────
CREATE TABLE IF NOT EXISTS "curated_list_member" (
    "id"                    TEXT NOT NULL,
    "list_id"               TEXT NOT NULL,
    "business_id"           TEXT NOT NULL,
    "position"              INTEGER NOT NULL,
    "best_for"              TEXT NOT NULL,
    "prose"                 TEXT NOT NULL,
    "snapshot_at"           TIMESTAMP(3) NOT NULL,
    "snap_rating_overall"   DOUBLE PRECISION,
    "snap_review_count"     INTEGER NOT NULL,
    "snap_response_ms"      INTEGER NOT NULL,
    "snap_established_year" INTEGER,
    "extra_label"           TEXT,
    "extra_value"           TEXT,
    "created_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"            TIMESTAMP(3) NOT NULL,
    CONSTRAINT "curated_list_member_pkey" PRIMARY KEY ("id")
);

-- ── The selection record, one row per audit, kept ───────────────────────────
CREATE TABLE IF NOT EXISTS "curated_list_audit" (
    "id"               TEXT NOT NULL,
    "list_id"          TEXT NOT NULL,
    "audited_at"       TIMESTAMP(3) NOT NULL,
    "editor_id"        UUID,
    "considered_count" INTEGER NOT NULL,
    "member_count"     INTEGER NOT NULL,
    "record"           JSONB NOT NULL,
    "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "curated_list_audit_pkey" PRIMARY KEY ("id")
);

-- ── Drift: written nightly, acted on by a person ────────────────────────────
CREATE TABLE IF NOT EXISTS "curated_list_drift" (
    "id"             TEXT NOT NULL,
    "list_id"        TEXT NOT NULL,
    "business_id"    TEXT NOT NULL,
    "criterion"      TEXT NOT NULL,
    "snapshot_value" TEXT NOT NULL,
    "live_value"     TEXT NOT NULL,
    "detected_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at"    TIMESTAMP(3),
    CONSTRAINT "curated_list_drift_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
    ALTER TABLE "curated_list_member" ADD CONSTRAINT "curated_list_member_list_id_fkey"
        FOREIGN KEY ("list_id") REFERENCES "curated_list"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE "curated_list_member" ADD CONSTRAINT "curated_list_member_business_id_fkey"
        FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE "curated_list_audit" ADD CONSTRAINT "curated_list_audit_list_id_fkey"
        FOREIGN KEY ("list_id") REFERENCES "curated_list"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE "curated_list_audit" ADD CONSTRAINT "curated_list_audit_editor_id_fkey"
        FOREIGN KEY ("editor_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE "curated_list_drift" ADD CONSTRAINT "curated_list_drift_list_id_fkey"
        FOREIGN KEY ("list_id") REFERENCES "curated_list"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE "curated_list_drift" ADD CONSTRAINT "curated_list_drift_business_id_fkey"
        FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Editorial order is unique, so two entries cannot share a rank numeral, and a
-- business appears at most once on a list.
CREATE UNIQUE INDEX IF NOT EXISTS "curated_list_member_list_id_position_key"
  ON "curated_list_member"("list_id", "position");
CREATE UNIQUE INDEX IF NOT EXISTS "curated_list_member_list_id_business_id_key"
  ON "curated_list_member"("list_id", "business_id");

-- Acceptance 16, in the database rather than in review.
--
-- `BEST FOR:` is the actual product of the curation — it is what turns a ranked
-- list into twelve non-competing recommendations, and it is the line a reader
-- scans. Two entries sharing one is the list failing at the thing it is for.
CREATE UNIQUE INDEX IF NOT EXISTS "curated_list_member_list_id_best_for_key"
  ON "curated_list_member"("list_id", "best_for");

CREATE INDEX IF NOT EXISTS "curated_list_member_business_id_idx"
  ON "curated_list_member"("business_id");
CREATE INDEX IF NOT EXISTS "curated_list_audit_list_id_audited_at_idx"
  ON "curated_list_audit"("list_id", "audited_at");
CREATE INDEX IF NOT EXISTS "curated_list_drift_list_id_resolved_at_idx"
  ON "curated_list_drift"("list_id", "resolved_at");
