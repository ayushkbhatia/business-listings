-- Withdraw site visits, and shorten the verification ladder to match.
--
-- DESTRUCTIVE. Three tables and four columns go, and nine businesses are
-- retiered. Per docs/deployments.md § Ordering this applies **after** the
-- merge, once no running code refers to any of it — the previous deployment
-- reads `visited_at` and `site_visit_included` right up until the new one is
-- live.
--
-- ## Why the ladder changes at all
--
-- Tiers 3 and 4 both rested on somebody standing in the warehouse: "site
-- visited", and "premises visited and trading history audited". With no field
-- team there is no evidence behind either, and a rung whose requirement nobody
-- performs is a badge that means whatever staff decide on the day — which is
-- the thing CLAUDE.md's interface-honesty rules exist to stop.
--
-- So the visited rung goes and `audited` moves down to 3, resting on trading
-- history and buyer outcomes, which this platform already measures from
-- enquiries, quotes and reply timestamps.
--
-- ## No audit rows
--
-- Nine businesses change tier here and none of it is logged, deliberately.
-- `AuditEvent.actorId` is NOT NULL because the log records *decisions*, and a
-- migration following a published sequence has no actor to attribute — the same
-- reasoning `lib/verification/expiry-job.ts` carries, and the same reason it
-- writes none either.

-- ── Retier before the range tightens ────────────────────────────────────────
--
-- This order is load-bearing. `business_verification_tier_range` is rewritten
-- below to BETWEEN 0 AND 3, and a tier-4 row still present at that moment would
-- make the constraint fail to validate and abort the whole migration.

-- Demote before promote, and the order is the whole correctness of this block.
--
-- Every tier-4 supplier was also visited — "premises visited AND trading history
-- audited" — so promoting 4 to 3 first and then demoting the visited 3s would
-- catch the supplier just promoted and drop it to 2, losing the audit it had
-- actually earned. Written the other way round the first time, and the local
-- run put nobody on the top rung, which is how it was found.

-- The visited-only ones fall back to the last rung whose evidence still exists:
-- a licence checked against the issuing authority. Their visit happened, but it
-- is no longer a thing this directory claims to do, and a badge nobody can earn
-- today is a badge that lies about what the tier means.
UPDATE "business" SET "verification_tier" = 2 WHERE "verification_tier" = 3;

-- The audited ones keep what they were audited for, at its new number.
UPDATE "business" SET "verification_tier" = 3 WHERE "verification_tier" = 4;

-- ── The constraints ────────────────────────────────────────────────────────
--
-- Dropped before the column it reads, or the DROP COLUMN takes it by surprise.
ALTER TABLE "business" DROP CONSTRAINT IF EXISTS "business_tier_3_requires_visit";

ALTER TABLE "business" DROP CONSTRAINT IF EXISTS "business_verification_tier_range";
ALTER TABLE "business"
  ADD CONSTRAINT "business_verification_tier_range"
  CHECK ("verification_tier" BETWEEN 0 AND 3);

-- ── The tables ─────────────────────────────────────────────────────────────
--
-- Photographs first: `site_visit_photo.media_id` is ON DELETE RESTRICT, so the
-- rows have to go before anything tries to touch the media they point at.
DROP TABLE IF EXISTS "site_visit_photo";
DROP TABLE IF EXISTS "site_visit_report";
DROP TABLE IF EXISTS "site_visit_request";

-- ── The columns ────────────────────────────────────────────────────────────
ALTER TABLE "business" DROP COLUMN IF EXISTS "visited_at";
ALTER TABLE "business" DROP COLUMN IF EXISTS "visited_by_staff_id";
ALTER TABLE "plan" DROP COLUMN IF EXISTS "site_visit_included";

-- ── What is deliberately left ──────────────────────────────────────────────
--
-- `media_kind` keeps its 'visit' value. Postgres cannot drop an enum label
-- without recreating the type and rewriting every column that uses it, which is
-- a table rewrite of `media` in exchange for tidiness. An unused label costs
-- nothing and nothing can select it: no code writes that kind any more.
--
-- Any `media` rows already carrying kind 'visit' are left in place too. They are
-- geotagged photographs of somebody's premises, in the private document bucket,
-- and deleting a person's files is not something a schema migration should do
-- quietly. They are unreachable — no surface renders that kind — so they are
-- inert until somebody decides, on purpose, to purge them and their storage
-- objects together.
