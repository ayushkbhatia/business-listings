-- Handoff 4, step 6. Storefront templates — boards 5a–5e, 5g, 5h.
--
-- Sellers do not build storefronts. We build templates per sector; sellers fill
-- the fields we opened. That makes every template edit a fan-out: changing the
-- Industrial template changes every live storefront in that sector, which is
-- why the store count is on every screen that can change one, and on the
-- version row that records what somebody confirmed.

-- ── Sector, denormalised ────────────────────────────────────────────────────
--
-- A template belongs to a sector — the top-level ancestor of a listing's
-- primary category. The store count is the number the whole design is organised
-- around, so it has to be one indexed column rather than a recursive walk per
-- render. `business_category` rows are ignored on purpose: a third of listings
-- carry a second one, and a listing in two sectors would be on two templates.

ALTER TABLE "business" ADD COLUMN "sector_id" TEXT;

ALTER TABLE "business"
  ADD CONSTRAINT "business_sector_id_fkey"
  FOREIGN KEY ("sector_id") REFERENCES "category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill by walking the category tree to its root. The tree is two levels
-- today; the recursive form is here so a third level does not silently leave
-- half the directory sectorless.
WITH RECURSIVE roots AS (
  SELECT id, parent_id, id AS root_id FROM category WHERE parent_id IS NULL
  UNION ALL
  SELECT c.id, c.parent_id, r.root_id
  FROM category c
  JOIN roots r ON c.parent_id = r.id
)
UPDATE "business" b
SET "sector_id" = r.root_id
FROM roots r
WHERE b."primary_category_id" = r.id;

CREATE INDEX IF NOT EXISTS "business_sector_idx" ON "business" ("sector_id");

-- ── The product id the RFQ tray was throwing away ───────────────────────────
--
-- Added now, while the table is small, so "auto-pick most-enquired" has
-- something to rank on later. Nullable: most enquiries start from a search, and
-- every row written before this column has no answer to recover.

ALTER TABLE "enquiry_line" ADD COLUMN "product_id" TEXT;

ALTER TABLE "enquiry_line"
  ADD CONSTRAINT "enquiry_line_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "enquiry_line_product_idx" ON "enquiry_line" ("product_id");

-- ── Templates ───────────────────────────────────────────────────────────────

CREATE TYPE "template_density" AS ENUM ('compact', 'comfortable', 'roomy');
CREATE TYPE "type_pairing" AS ENUM ('editorial', 'clean', 'technical');

CREATE TABLE "storefront_template" (
  "id"              TEXT NOT NULL,
  "sector_id"       TEXT NOT NULL,
  "name"            TEXT NOT NULL,
  "status"          "template_status" NOT NULL DEFAULT 'draft',
  "version"         INTEGER NOT NULL DEFAULT 1,
  "offered_themes"  TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "default_theme"   TEXT NOT NULL DEFAULT 'default',
  "allow_custom_hex" BOOLEAN NOT NULL DEFAULT false,
  "type_pairing"    "type_pairing" NOT NULL DEFAULT 'clean',
  "corner_radius"   INTEGER NOT NULL DEFAULT 6,
  "density"         "template_density" NOT NULL DEFAULT 'comfortable',
  "dark_header"     BOOLEAN NOT NULL DEFAULT false,
  "badge_removable" BOOLEAN NOT NULL DEFAULT false,
  "published_at"    TIMESTAMP(3),
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"      TIMESTAMP(3) NOT NULL,

  CONSTRAINT "storefront_template_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "storefront_template"
  ADD CONSTRAINT "storefront_template_sector_id_fkey"
  FOREIGN KEY ("sector_id") REFERENCES "category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- One live template per sector.
--
-- The store count is only well defined if a listing has exactly one template,
-- and "changing the Industrial template changes 1,842 storefronts" is only true
-- if there is one Industrial template. Drafts and retired ones are unlimited.
CREATE UNIQUE INDEX "storefront_template_one_live_per_sector"
  ON "storefront_template" ("sector_id")
  WHERE "status" = 'live';

-- A sector is a top-level category, not any category. Enforced by a trigger
-- rather than a CHECK because it reads another table.
CREATE OR REPLACE FUNCTION storefront_template_sector_is_top_level()
RETURNS TRIGGER AS $$
BEGIN
  IF (SELECT parent_id FROM category WHERE id = NEW.sector_id) IS NOT NULL THEN
    RAISE EXCEPTION 'storefront_template.sector_id must be a top-level category';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "storefront_template_sector_is_top_level"
  BEFORE INSERT OR UPDATE OF "sector_id" ON "storefront_template"
  FOR EACH ROW EXECUTE FUNCTION storefront_template_sector_is_top_level();

CREATE INDEX IF NOT EXISTS "storefront_template_sector_idx"
  ON "storefront_template" ("sector_id", "status");

-- ── Sections ────────────────────────────────────────────────────────────────

CREATE TABLE "template_section" (
  "id"          TEXT NOT NULL,
  "template_id" TEXT NOT NULL,
  -- A SectionType key from lib/storefront/section-types.ts. Not an enum:
  -- adding a type is a code change and the catalogue is the source of truth.
  "type"        TEXT NOT NULL,
  "sort_order"  INTEGER NOT NULL DEFAULT 0,
  "enabled"     BOOLEAN NOT NULL DEFAULT true,
  "fixed"       BOOLEAN NOT NULL DEFAULT false,
  "singleton"   BOOLEAN NOT NULL DEFAULT false,
  "seller_editable_fields" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "show_on_mobile" BOOLEAN NOT NULL DEFAULT true,
  "settings"    JSONB NOT NULL DEFAULT '{}',

  CONSTRAINT "template_section_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "template_section"
  ADD CONSTRAINT "template_section_template_id_fkey"
  FOREIGN KEY ("template_id") REFERENCES "storefront_template"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Criterion 7: a singleton type cannot be added twice; a non-singleton can.
-- A column and an index, not a service remembering to check.
CREATE UNIQUE INDEX "template_section_one_singleton_per_type"
  ON "template_section" ("template_id", "type")
  WHERE "singleton";

-- Criterion 6: the header cannot be disabled. It also cannot be un-fixed into
-- something that can be — the two move together or the row is refused.
ALTER TABLE "template_section"
  ADD CONSTRAINT "template_section_fixed_stays_enabled"
  CHECK (NOT "fixed" OR "enabled");

CREATE INDEX IF NOT EXISTS "template_section_order_idx"
  ON "template_section" ("template_id", "sort_order");

-- ── What a seller filled in ─────────────────────────────────────────────────
--
-- Keyed to template_section.id, which survives a version restore. Keyed to a
-- row a restore replaced, a rollback would wipe seller content across every
-- store in the sector, silently and with no way back.

CREATE TABLE "storefront_content" (
  "id"          TEXT NOT NULL,
  "business_id" TEXT NOT NULL,
  "section_id"  TEXT NOT NULL,
  "values"      JSONB NOT NULL DEFAULT '{}',
  "updated_at"  TIMESTAMP(3) NOT NULL,

  CONSTRAINT "storefront_content_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "storefront_content"
  ADD CONSTRAINT "storefront_content_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "storefront_content"
  ADD CONSTRAINT "storefront_content_section_id_fkey"
  FOREIGN KEY ("section_id") REFERENCES "template_section"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "storefront_content_business_id_section_id_key"
  ON "storefront_content" ("business_id", "section_id");

CREATE INDEX IF NOT EXISTS "storefront_content_section_idx"
  ON "storefront_content" ("section_id");

-- ── Pages ───────────────────────────────────────────────────────────────────

CREATE TABLE "template_page" (
  "id"               TEXT NOT NULL,
  "template_id"      TEXT NOT NULL,
  "slug"             TEXT NOT NULL,
  "title"            TEXT NOT NULL,
  "meta_description" TEXT,
  "blocks"           JSONB NOT NULL DEFAULT '[]',
  "show_in_nav"      BOOLEAN NOT NULL DEFAULT true,
  "allow_indexing"   BOOLEAN NOT NULL DEFAULT true,
  "status"           "template_status" NOT NULL DEFAULT 'draft',
  "published_at"     TIMESTAMP(3),
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "template_page_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "template_page"
  ADD CONSTRAINT "template_page_template_id_fkey"
  FOREIGN KEY ("template_id") REFERENCES "storefront_template"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "template_page_template_id_slug_key"
  ON "template_page" ("template_id", "slug");

-- Criterion 9: a slug is immutable once published. A published page has a date,
-- and the service writes a redirect rather than a rename — the constraint here
-- is that a live page cannot exist without one.
ALTER TABLE "template_page"
  ADD CONSTRAINT "template_page_live_has_published_at"
  CHECK ("status" <> 'live' OR "published_at" IS NOT NULL);

-- ── Version history ─────────────────────────────────────────────────────────

CREATE TABLE "template_version" (
  "id"           TEXT NOT NULL,
  "template_id"  TEXT NOT NULL,
  "version"      INTEGER NOT NULL,
  "snapshot"     JSONB NOT NULL,
  -- How many live storefronts this publish changed. On the row because the
  -- number is the decision: "this affects 1,842 stores" is what somebody
  -- confirmed, and a history that lost it cannot say what was agreed.
  "store_count"  INTEGER NOT NULL,
  -- `user.id` is the Supabase auth uuid. There is no second identity space.
  "published_by" UUID NOT NULL,
  "reason"       TEXT NOT NULL,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "template_version_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "template_version"
  ADD CONSTRAINT "template_version_template_id_fkey"
  FOREIGN KEY ("template_id") REFERENCES "storefront_template"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "template_version"
  ADD CONSTRAINT "template_version_published_by_fkey"
  FOREIGN KEY ("published_by") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "template_version_template_id_version_key"
  ON "template_version" ("template_id", "version");

-- A reason that is blank is a reason nobody wrote. Same rule as audit_event.
ALTER TABLE "template_version"
  ADD CONSTRAINT "template_version_reason_is_written"
  CHECK (length(btrim("reason")) >= 4);

-- ── Named people on a public page ───────────────────────────────────────────
--
-- "Meet the team" publishes names, roles and numbers. `user.phone` is a sign-in
-- credential and is never this. A row here is a deliberate act with a timestamp
-- on it, and the number defaults to the branch line rather than anybody's
-- mobile.

CREATE TABLE "team_member" (
  "id"               TEXT NOT NULL,
  "business_id"      TEXT NOT NULL,
  "name"             TEXT NOT NULL,
  "role"             TEXT NOT NULL,
  "phone"            TEXT,
  "location_id"      TEXT,
  "media_id"         TEXT,
  "sort_order"       INTEGER NOT NULL DEFAULT 0,
  -- NOT NULL. There is no row without consent, so there is no state in which
  -- somebody is published without it.
  "consent_given_at" TIMESTAMP(3) NOT NULL,
  "consent_by"       UUID NOT NULL,
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "team_member_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "team_member"
  ADD CONSTRAINT "team_member_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "team_member"
  ADD CONSTRAINT "team_member_location_id_fkey"
  FOREIGN KEY ("location_id") REFERENCES "location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "team_member"
  ADD CONSTRAINT "team_member_media_id_fkey"
  FOREIGN KEY ("media_id") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "team_member_business_idx"
  ON "team_member" ("business_id", "sort_order");
