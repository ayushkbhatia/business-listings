import "server-only";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/db/client";
import { supplyWhere, type LandingScope } from "./scope";

/**
 * Board 6a §Freshness — what `UPDATED 21 AUG 2026` means.
 *
 * It moves for exactly three reasons:
 *
 *   1. a listing enters or leaves the scope
 *   2. a listing in the scope changes verification tier
 *   3. the intro copy or the FAQ is edited
 *
 * It does **not** move for a nightly rebuild, a ranking-weight change, a review
 * landing, or a deploy.
 *
 * The render deliberately still read 21 Aug although it was exported on 4 Sep,
 * and that is the correct behaviour drawn. If the date tracked the build, every
 * page on the domain would claim to have been updated this morning — which is
 * both false and a pattern that is trivially detected across a few hundred URLs
 * that all move together.
 *
 * ## Why a digest and not a count
 *
 * "Listings: 218" is the same number the morning after one supplier is
 * suspended and another published in their place, and that swap is exactly the
 * change a reader would call an update. The digest is a hash over
 * `businessId:tier` for every listing in the scope, sorted — so a join, a
 * departure and a rung change each move it, and nothing else does.
 *
 * ## Why this is a job and not a render
 *
 * The obvious version recomputes on every request and writes when it differs.
 * That puts a write on the read path of the busiest public template in the
 * product, at `revalidate = 300`, on a pooled connection — and two crawlers
 * hitting the same cold page race each other to write the same row. So the
 * sweep does it: `refreshFreshness` is called from the daily job and from every
 * content mutation, and the page renders the stored value.
 *
 * The cost is that a supplier who publishes at noon does not move the date
 * until the sweep runs. That is the right way round: the date is a claim about
 * content, and a claim that is a few hours conservative is honest in the
 * direction that matters.
 */

/** Stable across processes and releases: it is only ever compared to itself. */
export async function supplyDigest(scope: LandingScope): Promise<string> {
  const rows = await prisma.business.findMany({
    where: supplyWhere(scope),
    select: { id: true, verificationTier: true },
    orderBy: { id: "asc" },
  });
  const hash = createHash("sha256");
  for (const row of rows) hash.update(`${row.id}:${row.verificationTier}\n`);
  return `${rows.length}-${hash.digest("hex").slice(0, 32)}`;
}

export interface FreshnessResult {
  digest: string;
  /** Whether supply actually moved, and so whether the date did. */
  moved: boolean;
  contentUpdatedAt: Date;
}

/**
 * The first pass records the digest and moves nothing.
 *
 * A page that has never been swept has `supply_digest = NULL`, and the obvious
 * reading — "the digest is different, so supply changed" — would move
 * `content_updated_at` on **every published page** the first night this ran.
 * That is the exact failure §Freshness is written against: every page on the
 * domain claiming to have been updated this morning, which is both false and a
 * pattern that is trivially detected when a few hundred URLs move together.
 *
 * Null is not a previous state. It means we have never looked, and the honest
 * answer to "did supply change since we last looked" is that there is no last
 * look to compare against. The migration backfills the date from `updated_at`
 * so there is something true to print in the meantime.
 *
 * Caught by an end-to-end test asserting the seeded date after a run of the
 * integration suite — which sweeps — had quietly moved it to today.
 */

/**
 * Recompute the digest and move the date only if it changed.
 *
 * Returns what it decided so the sweep can report it and a test can assert
 * both directions — criterion 5 asks for both: *"`content_updated_at` does not
 * change on a rebuild with no data or copy change; it does change when a
 * listing enters or leaves the scope. Both directions tested."*
 */
export async function refreshFreshness(
  scope: LandingScope,
  now = new Date(),
): Promise<FreshnessResult | null> {
  const digest = await supplyDigest(scope);

  if (scope.area) {
    const key = { areaId_categoryId: { areaId: scope.area.id, categoryId: scope.category.id } };
    const row = await prisma.areaPage.findUnique({
      where: key,
      select: { supplyDigest: true, contentUpdatedAt: true },
    });
    if (!row) return null;
    if (row.supplyDigest === digest) {
      return { digest, moved: false, contentUpdatedAt: row.contentUpdatedAt ?? now };
    }
    // Never looked before: record what is there, move nothing. See above.
    const first = row.supplyDigest === null;
    const next = await prisma.areaPage.update({
      where: key,
      data: { supplyDigest: digest, ...(first ? {} : { contentUpdatedAt: now }) },
      select: { contentUpdatedAt: true },
    });
    return {
      digest,
      moved: !first,
      contentUpdatedAt: (next.contentUpdatedAt as Date | null) ?? now,
    };
  }

  const key = { emirate_categoryId: { emirate: scope.emirate, categoryId: scope.category.id } };
  const row = await prisma.emiratePage.findUnique({
    where: key,
    select: { supplyDigest: true, contentUpdatedAt: true },
  });
  if (!row) return null;
  if (row.supplyDigest === digest) {
    return { digest, moved: false, contentUpdatedAt: row.contentUpdatedAt ?? now };
  }
  const first = row.supplyDigest === null;
  const next = await prisma.emiratePage.update({
    where: key,
    data: { supplyDigest: digest, ...(first ? {} : { contentUpdatedAt: now }) },
    select: { contentUpdatedAt: true },
  });
  return {
    digest,
    moved: !first,
    contentUpdatedAt: (next.contentUpdatedAt as Date | null) ?? now,
  };
}
