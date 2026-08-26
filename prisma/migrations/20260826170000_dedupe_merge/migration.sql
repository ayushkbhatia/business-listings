-- Handoff 4, step 2b. Dedupe and merge.
--
-- The rule this whole migration is shaped around: **a merge must not delete the
-- loser.** Reviews, enquiries, quotes, products, locations and media all cascade
-- from `business_id`, so deleting the absorbed listing destroys the reviews that
-- were the reason to merge in the first place — and criterion 2 requires every
-- merge to be reversible for thirty days.
--
-- So a merge moves rows and records exactly which ones it moved. Reversal is a
-- replay of that manifest rather than a guess.

CREATE TYPE "merge_band" AS ENUM ('certain', 'probable', 'unlikely');

CREATE TABLE "merge_candidate" (
  "id"         TEXT NOT NULL,
  -- The listing that would survive, and the one that would be absorbed.
  "keep_id"    TEXT NOT NULL,
  "absorb_id"  TEXT NOT NULL,
  -- 0..1, to four places. Computed, never typed.
  "score"      DOUBLE PRECISION NOT NULL,
  "band"       "merge_band" NOT NULL,
  -- Which signals agreed, so a person can see why the number is what it is.
  "signals"    JSONB NOT NULL,
  -- Set when somebody decides. A dismissed pair does not come back.
  "dismissed_at"    TIMESTAMP(3),
  "dismissed_by_id" UUID,
  "dismiss_reason"  TEXT,
  "merge_id"   TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "merge_candidate_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "merge_candidate"
  ADD CONSTRAINT "merge_candidate_keep_id_fkey"
  FOREIGN KEY ("keep_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "merge_candidate"
  ADD CONSTRAINT "merge_candidate_absorb_id_fkey"
  FOREIGN KEY ("absorb_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "merge_candidate"
  ADD CONSTRAINT "merge_candidate_dismissed_by_id_fkey"
  FOREIGN KEY ("dismissed_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "merge_candidate"
  ADD CONSTRAINT "merge_candidate_two_listings"
  CHECK ("keep_id" <> "absorb_id");

ALTER TABLE "merge_candidate"
  ADD CONSTRAINT "merge_candidate_score_is_a_share"
  CHECK ("score" >= 0 AND "score" <= 1);

-- A dismissal carries its reason, like every other staff decision here.
ALTER TABLE "merge_candidate"
  ADD CONSTRAINT "merge_candidate_dismissal_has_a_reason"
  CHECK (("dismissed_at" IS NULL) = ("dismiss_reason" IS NULL));

-- One open candidate per ordered pair. Regenerating the list must not stack
-- duplicates on top of pairs somebody has already looked at.
CREATE UNIQUE INDEX IF NOT EXISTS "merge_candidate_open_pair"
  ON "merge_candidate" ("keep_id", "absorb_id") WHERE "dismissed_at" IS NULL AND "merge_id" IS NULL;

CREATE INDEX IF NOT EXISTS "merge_candidate_band_score_idx"
  ON "merge_candidate" ("band", "score" DESC) WHERE "dismissed_at" IS NULL AND "merge_id" IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- The merge itself
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "business_merge" (
  "id"         TEXT NOT NULL,
  "keep_id"    TEXT NOT NULL,
  "absorb_id"  TEXT NOT NULL,
  "actor_id"   UUID NOT NULL,
  "reason"     TEXT NOT NULL,
  /*
   * What moved, and from where.
   *
   * `{ review: [ids], enquiryRecipient: [[enquiryId, businessId]], ... }`.
   * Reversal replays this rather than recomputing it: by the time somebody
   * unmerges, the winner has rows of its own and "everything that belongs to
   * the winner" is no longer the same set.
   */
  "manifest"   JSONB NOT NULL,
  -- The address the absorbed listing had. Kept so a reversal can put it back.
  "absorbed_slug" TEXT NOT NULL,
  "reversible_until" TIMESTAMP(3) NOT NULL,
  "reversed_at" TIMESTAMP(3),
  "reverse_reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "business_merge_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "business_merge"
  ADD CONSTRAINT "business_merge_keep_id_fkey"
  FOREIGN KEY ("keep_id") REFERENCES "business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "business_merge"
  ADD CONSTRAINT "business_merge_absorb_id_fkey"
  FOREIGN KEY ("absorb_id") REFERENCES "business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "business_merge"
  ADD CONSTRAINT "business_merge_actor_id_fkey"
  FOREIGN KEY ("actor_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "business_merge"
  ADD CONSTRAINT "business_merge_reversal_has_a_reason"
  CHECK (("reversed_at" IS NULL) = ("reverse_reason" IS NULL));

CREATE INDEX IF NOT EXISTS "business_merge_absorb_idx" ON "business_merge" ("absorb_id");
CREATE INDEX IF NOT EXISTS "business_merge_reversible_idx"
  ON "business_merge" ("reversible_until") WHERE "reversed_at" IS NULL;

ALTER TABLE "merge_candidate"
  ADD CONSTRAINT "merge_candidate_merge_id_fkey"
  FOREIGN KEY ("merge_id") REFERENCES "business_merge"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- The absorbed listing
--
-- Not deleted. It keeps its row, its slug and its id, and points at the listing
-- that absorbed it — which is what makes the 301 resolvable and the reversal a
-- flip rather than a restore from somewhere.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "business" ADD COLUMN "merged_into_id" TEXT;
ALTER TABLE "business" ADD COLUMN "merged_at" TIMESTAMP(3);

ALTER TABLE "business"
  ADD CONSTRAINT "business_merged_into_id_fkey"
  FOREIGN KEY ("merged_into_id") REFERENCES "business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "business"
  ADD CONSTRAINT "business_merge_is_paired"
  CHECK (("merged_into_id" IS NULL) = ("merged_at" IS NULL));

ALTER TABLE "business"
  ADD CONSTRAINT "business_not_merged_into_itself"
  CHECK ("merged_into_id" IS NULL OR "merged_into_id" <> "id");

CREATE INDEX IF NOT EXISTS "business_merged_into_idx"
  ON "business" ("merged_into_id") WHERE "merged_into_id" IS NOT NULL;
