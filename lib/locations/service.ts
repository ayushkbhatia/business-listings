import "server-only";
import { prisma } from "@/lib/db/client";
import { assertCanEditListing } from "@/lib/auth/guards";
import type { Actor } from "@/lib/auth/roles";
import { roundCoord, withinUae } from "@/lib/onboarding/branch-fields";
import { branchStatus } from "./branch";
import {
  alreadyCovered,
  isStorableLeadTime,
  type CoverageScope,
} from "./coverage";
import type { Emirate } from "@/lib/db/generated/enums";

/**
 * Board 3c's writes — visibility, pins and coverage.
 *
 * The branch's own fields are board 2d's form and stay where they are; what is
 * here is the three things the manager screen does that onboarding never had to:
 * take a branch off the directory, correct a pin, and say where the supplier
 * delivers.
 *
 * No `AuditEvent`. These are the seller's own decisions about their own
 * listing, and `AuditEvent` is the staff log — its value is that every row is a
 * staff action somebody can be asked about, which is exactly what filing a
 * seller's own edits there would dilute. `ListingRevision` is the seller-side
 * record and board 3b's rail already draws it.
 */

/* ── Ownership, once ─────────────────────────────────────────────────────── */

/**
 * Every mutation below narrows on `businessId` as well as the row id.
 *
 * Not a belt-and-braces check on top of the capability test — the capability
 * says this actor may edit *a* listing, and the id says which. An `updateMany`
 * with both in the `where` cannot touch another supplier's branch even if the
 * id came off a forged form, and it reports `count: 0` rather than throwing,
 * which is the same answer as "that branch does not exist" and is the right
 * thing to tell somebody guessing ids.
 */
function ownedBy(businessId: string, id: string) {
  return { id, businessId };
}

async function recordRevision(businessId: string, actorId: string, field: string, itemCount?: number) {
  await prisma.listingRevision.create({
    data: { businessId, actorId, field, itemCount: itemCount ?? null },
  });
}

/* ── Visibility ──────────────────────────────────────────────────────────── */

export type VisibilityResult =
  | { ok: true; status: "published" | "hidden" }
  | { ok: false; error: "not_found" };

/**
 * Publish or hide a branch.
 *
 * `publishedAt` is stamped on the way up and never cleared on the way down.
 * That is the whole of the draft/hidden distinction: a branch that has been
 * live once has made a claim to buyers, and un-hiding and re-hiding it does not
 * un-make that. Board 3d reads it to decide whether to offer the branch in its
 * hours picker.
 *
 * Publishing without a pin is allowed — board 3c Q1. The branch is absent from
 * map search and scores no distance either way, and the issue card says so;
 * refusing the save on top of that would punish a seller for a geocoder they do
 * not control. Onboarding still gates on it, and that is a different gate: a
 * *first* branch with no pin is a listing that cannot appear on the area page
 * publishing it is for.
 */
export async function setBranchVisibility(
  actor: Actor,
  businessId: string,
  locationId: string,
  published: boolean,
): Promise<VisibilityResult> {
  assertCanEditListing(actor);

  const { count } = await prisma.location.updateMany({
    where: ownedBy(businessId, locationId),
    data: published ? { published: true, publishedAt: new Date() } : { published: false },
  });
  if (count === 0) return { ok: false, error: "not_found" };

  await recordRevision(businessId, actor.id, "locations");
  return { ok: true, status: published ? "published" : "hidden" };
}

export interface HideConsequence {
  /** Areas where this is the seller's only published branch. */
  areasLost: { id: string; name: string }[];
  /** True when hiding these leaves the business with no published branch at all. */
  lastPublished: boolean;
}

/**
 * What hiding these branches costs, before it is done — board 3c Q4.
 *
 * *"Does hiding a branch that is the only one in its area remove the business
 * from that area page? Yes, and it should say so at the moment of hiding."*
 * The membership is a live query rather than a stored list, so this is asked by
 * running it: which areas would still hold a published branch afterwards, and
 * which would not.
 *
 * A preview, in the shape board 3f §4 established for destructive bulk actions.
 * Hiding is destructive in the way that matters here — the seller does not see
 * the area page they fall off, so nothing tells them afterwards.
 */
export async function hideConsequence(
  businessId: string,
  locationIds: readonly string[],
): Promise<HideConsequence> {
  const published = await prisma.location.findMany({
    where: { businessId, published: true },
    select: { id: true, areaId: true, area: { select: { id: true, name: true } } },
  });

  const going = new Set(locationIds);
  const staying = published.filter((location) => !going.has(location.id));
  const stayingAreas = new Set(staying.map((location) => location.areaId));

  const areasLost = new Map<string, { id: string; name: string }>();
  for (const location of published) {
    if (!going.has(location.id)) continue;
    if (stayingAreas.has(location.areaId)) continue;
    areasLost.set(location.area.id, { id: location.area.id, name: location.area.name });
  }

  return {
    areasLost: [...areasLost.values()].sort((a, b) => a.name.localeCompare(b.name)),
    lastPublished: published.length > 0 && staying.length === 0,
  };
}

/** The bulk form of the toggle. One revision row for the batch, not one each. */
export async function setBranchVisibilityMany(
  actor: Actor,
  businessId: string,
  locationIds: readonly string[],
  published: boolean,
): Promise<{ ok: true; changed: number }> {
  assertCanEditListing(actor);
  if (locationIds.length === 0) return { ok: true, changed: 0 };

  const { count } = await prisma.location.updateMany({
    where: { id: { in: [...locationIds] }, businessId },
    data: published ? { published: true, publishedAt: new Date() } : { published: false },
  });
  if (count > 0) await recordRevision(businessId, actor.id, "locations", count);
  return { ok: true, changed: count };
}

/* ── The pin ─────────────────────────────────────────────────────────────── */

export type PinResult = { ok: true } | { ok: false; error: "not_found" | "outside_uae" };

/**
 * A pin the seller placed, which is what makes it exact.
 *
 * `exact` is not a judgement about the coordinates — nothing can look at a pair
 * of floats and tell whether they are a gate or a centroid. It is a record of
 * *who put them there*, written by the only code path where a person did. That
 * is why the precision is set here and never inferred later, and why the seed's
 * area-derived pins are `approximate` however precise the decimals look.
 */
export async function setPin(
  actor: Actor,
  businessId: string,
  locationId: string,
  position: { lat: number; lng: number },
): Promise<PinResult> {
  assertCanEditListing(actor);

  const lat = roundCoord(position.lat);
  const lng = roundCoord(position.lng);
  // Board 2d's box, and the same reason: a pin outside it is a mis-drag or a
  // bad paste, and storing it puts a marker in the Gulf of Oman on board 1c.
  if (!withinUae(lat, lng)) return { ok: false, error: "outside_uae" };

  const { count } = await prisma.location.updateMany({
    where: ownedBy(businessId, locationId),
    data: { lat, lng, geocodePrecision: "exact" },
  });
  if (count === 0) return { ok: false, error: "not_found" };

  await recordRevision(businessId, actor.id, "locations");
  return { ok: true };
}

/**
 * Take the pin off.
 *
 * The precision goes with it, because `location_precision_matches_pin` refuses
 * a row claiming to know how a pin it does not have was placed — and it is
 * right to. That row would read `Exact` on this screen's table while the map
 * drew nothing.
 */
export async function clearPin(
  actor: Actor,
  businessId: string,
  locationId: string,
): Promise<PinResult> {
  assertCanEditListing(actor);
  const { count } = await prisma.location.updateMany({
    where: ownedBy(businessId, locationId),
    data: { lat: null, lng: null, geocodePrecision: null },
  });
  if (count === 0) return { ok: false, error: "not_found" };
  await recordRevision(businessId, actor.id, "locations");
  return { ok: true };
}

/* ── Coverage ────────────────────────────────────────────────────────────── */

export type CoverageError =
  | "unknown_area"
  | "already_covered"
  | "bad_lead_time"
  | "not_found";

export type CoverageResult = { ok: true; id: string } | { ok: false; error: CoverageError };

/**
 * Add one coverage row.
 *
 * The area is looked up rather than trusted, and the emirate comes off it —
 * the rule `saveLocation` already follows one field over. Two independent
 * fields that must agree is two fields that eventually will not, and here the
 * disagreement would be a supplier appearing under a Sharjah filter because a
 * form said `sharjah` beside a Dubai area id.
 *
 * `areaId` null covers the emirate entire, and that is the only case where the
 * emirate comes from the caller.
 */
export async function addCoverage(
  actor: Actor,
  businessId: string,
  input: { emirate: Emirate; areaId: string | null; leadTimeHours: number },
): Promise<CoverageResult> {
  assertCanEditListing(actor);

  if (!isStorableLeadTime(input.leadTimeHours)) return { ok: false, error: "bad_lead_time" };

  let scope: CoverageScope;
  if (input.areaId === null) {
    scope = { emirate: input.emirate, areaId: null };
  } else {
    const area = await prisma.area.findUnique({
      where: { id: input.areaId },
      select: { id: true, emirate: true },
    });
    // Criterion 6: no code path accepts a typed area. An id that is not in the
    // table is what a typed one looks like by the time it reaches here.
    if (!area) return { ok: false, error: "unknown_area" };
    scope = { emirate: area.emirate, areaId: area.id };
  }

  const existing = await prisma.businessCoverage.findMany({
    where: { businessId },
    select: { emirate: true, areaId: true },
  });
  // Checked here as well as by the two partial unique indexes, so the seller
  // gets a sentence rather than a constraint violation. The indexes are what
  // make it true under a double submit.
  if (alreadyCovered(existing, scope)) return { ok: false, error: "already_covered" };

  const row = await prisma.businessCoverage.create({
    data: {
      businessId,
      emirate: scope.emirate,
      areaId: scope.areaId,
      leadTimeHours: input.leadTimeHours,
    },
    select: { id: true },
  });

  await recordRevision(businessId, actor.id, "coverage");
  return { ok: true, id: row.id };
}

export async function removeCoverage(
  actor: Actor,
  businessId: string,
  coverageId: string,
): Promise<{ ok: true } | { ok: false; error: "not_found" }> {
  assertCanEditListing(actor);
  const { count } = await prisma.businessCoverage.deleteMany({
    where: { id: coverageId, businessId },
  });
  if (count === 0) return { ok: false, error: "not_found" };
  await recordRevision(businessId, actor.id, "coverage");
  return { ok: true };
}

/* ── Deleting a branch ───────────────────────────────────────────────────── */

export type DeleteBranchResult =
  | { ok: true }
  | { ok: false; error: "not_found" | "last_published" };

/**
 * Delete, with the one refusal worth having.
 *
 * A supplier's last published branch is their address. Board 2d makes one
 * branch the condition of publishing at all, so deleting the only live one
 * leaves a published listing with nowhere to go — findable in search, on an
 * area page, and unable to say where it is. Hiding it is the reversible way to
 * take a branch out of circulation, and the refusal says so.
 */
export async function deleteBranch(
  actor: Actor,
  businessId: string,
  locationId: string,
): Promise<DeleteBranchResult> {
  assertCanEditListing(actor);

  const branches = await prisma.location.findMany({
    where: { businessId },
    select: { id: true, published: true, publishedAt: true },
  });
  const target = branches.find((branch) => branch.id === locationId);
  if (!target) return { ok: false, error: "not_found" };

  const otherPublished = branches.some(
    (branch) => branch.id !== locationId && branchStatus(branch) === "published",
  );
  if (branchStatus(target) === "published" && !otherPublished) {
    return { ok: false, error: "last_published" };
  }

  await prisma.location.deleteMany({ where: ownedBy(businessId, locationId) });
  await recordRevision(businessId, actor.id, "locations");
  return { ok: true };
}
