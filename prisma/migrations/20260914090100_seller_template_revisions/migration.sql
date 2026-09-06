-- Board 3h — the seller's own revision, the platform version it tracks, and the
-- changes waiting to be applied.
--
-- Everything here hangs off `seller_template`, which has existed since the
-- initial migration as an overlay: a pointer at a platform template plus a JSON
-- of what this seller changed. Nothing is cloned and no `spec_field` row gains
-- an owner — `Product.spec_values` is keyed by `spec_field.id`, and board 4e's
-- `publishVersionWithField` already bumps a version in place rather than
-- copying fields for exactly that reason. Copying is what empties a catalogue.

-- ── One clone per business per platform template ────────────────────────────
--
-- There was no unique, and five readers resolve "the seller's template"
-- differently: `productBoardFor` takes the newest, the storefront filter rail
-- takes an arbitrary `findFirst` with no `orderBy`, and the editor and this
-- board each inline their own lookup. A second row for the same pair makes them
-- disagree about which labels a seller has — silently, because every one of
-- them returns a valid-looking answer.
--
-- Deduped before the index rather than after, keeping the newest row: it is the
-- one `productBoardFor` has been showing, so this makes the other four agree
-- with what the seller already sees rather than moving anybody's labels.
DELETE FROM "seller_template" a
USING "seller_template" b
WHERE a."business_id" = b."business_id"
  AND a."platform_template_id" = b."platform_template_id"
  AND (a."created_at", a."id") < (b."created_at", b."id");

CREATE UNIQUE INDEX IF NOT EXISTS "seller_template_business_platform_key"
  ON "seller_template" ("business_id", "platform_template_id");

-- ── The two numbers in the header ───────────────────────────────────────────
--
-- The board's label read `v3 · YOUR COPY` while also offering "compare to
-- platform v3" and marking a field new in v3. Those cannot all hold: if the
-- seller is on v3 and the platform is on v3 there is nothing to compare. They
-- are two different counters — how many times this seller has applied changes,
-- and which platform version their copy has been reconciled against.
ALTER TABLE "seller_template"
  ADD COLUMN IF NOT EXISTS "revision" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "seller_template"
  ADD COLUMN IF NOT EXISTS "tracks_version" INTEGER NOT NULL DEFAULT 1;

-- Existing clones track whatever their platform template is on today. They were
-- created from it and nothing has diverged, so claiming version 1 would show
-- every seller a platform-changes nudge for changes they already have.
UPDATE "seller_template" st
SET "tracks_version" = pt."version"
FROM "spec_template" pt
WHERE pt."id" = st."platform_template_id";

-- ── Changes not yet applied ─────────────────────────────────────────────────
--
-- `field_mappings` is what products and buyers read. `draft_mappings` is what
-- the seller has been editing, and NULL means nothing is pending — which is why
-- it is nullable rather than defaulted: "no draft" and "a draft identical to
-- the applied state" are different, and the primary action is absent in the
-- first case rather than disabled.
--
-- The board's single `Save & apply to 318` was a one-click retroactive edit to
-- 318 live products. The diff between these two columns is what `Review N
-- changes` renders, with a blast radius per change.
ALTER TABLE "seller_template"
  ADD COLUMN IF NOT EXISTS "draft_mappings" JSONB;
ALTER TABLE "seller_template"
  ADD COLUMN IF NOT EXISTS "draft_own_fields" JSONB;

-- ── The seller's own fields ─────────────────────────────────────────────────
--
-- Warranty, lead time, whatever they compete on. Stored here rather than as
-- `spec_field` rows, because a `spec_field` belongs to a platform template that
-- every seller in the category shares — one seller's warranty column would
-- appear in everyone's editor and in the category's facet rail.
--
-- Each carries its own generated id, and `Product.spec_values` keys them the
-- same way it keys a platform field. They are never facets and never enter
-- comparison; board 3h renders them `YOURS ONLY` and says why.
ALTER TABLE "seller_template"
  ADD COLUMN IF NOT EXISTS "own_fields" JSONB NOT NULL DEFAULT '[]';

-- ── A route needs a name ────────────────────────────────────────────────────
--
-- `/dashboard/templates/:slug`. Unique per business rather than globally: two
-- suppliers both calling a template "Valves" is not a collision, and a global
-- unique would leak one seller's naming into another's error message.
ALTER TABLE "seller_template"
  ADD COLUMN IF NOT EXISTS "slug" TEXT;

UPDATE "seller_template"
SET "slug" = trim(both '-' from regexp_replace(lower("name"), '[^a-z0-9]+', '-', 'g'))
WHERE "slug" IS NULL;

-- A name of nothing but punctuation slugifies to an empty string, and two
-- templates named "Valves & fittings" and "Valves and fittings" collide. Both
-- fall back to the id, which is unique by construction.
UPDATE "seller_template" st
SET "slug" = st."id"
WHERE st."slug" IS NULL
   OR st."slug" = ''
   OR EXISTS (
     SELECT 1 FROM "seller_template" other
     WHERE other."business_id" = st."business_id"
       AND other."slug" = st."slug"
       AND other."id" <> st."id"
       AND (other."created_at", other."id") < (st."created_at", st."id")
   );

ALTER TABLE "seller_template" ALTER COLUMN "slug" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "seller_template_business_slug_key"
  ON "seller_template" ("business_id", "slug");

-- ── Revision history ────────────────────────────────────────────────────────
--
-- One row per apply, holding the whole overlay as it stood. A snapshot rather
-- than a diff: rolling back has to restore field order and options exactly, and
-- replaying a chain of diffs to get there is a second implementation of the
-- overlay that can disagree with the first.
--
-- `summary` is what changed in that apply, so `Revision history` can say
-- "renamed Size to Nominal size" without re-deriving it from two snapshots.
CREATE TABLE IF NOT EXISTS "seller_template_revision" (
  "id" TEXT NOT NULL,
  "seller_template_id" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "field_mappings" JSONB NOT NULL DEFAULT '{}',
  "own_fields" JSONB NOT NULL DEFAULT '[]',
  "summary" JSONB NOT NULL DEFAULT '[]',
  -- Nullable: a seat can be removed, and `removeSeat` nulls the business rather
  -- than deleting the person. A revision with no author is still a revision.
  "created_by_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "seller_template_revision_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  ALTER TABLE "seller_template_revision"
    ADD CONSTRAINT "seller_template_revision_template_fkey"
    FOREIGN KEY ("seller_template_id") REFERENCES "seller_template"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "seller_template_revision"
    ADD CONSTRAINT "seller_template_revision_author_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "user"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "seller_template_revision_key"
  ON "seller_template_revision" ("seller_template_id", "revision");

CREATE INDEX IF NOT EXISTS "seller_template_revision_recent_idx"
  ON "seller_template_revision" ("seller_template_id", "created_at" DESC);
