import "server-only";
import { Prisma } from "@/lib/db/generated/client";
import { prisma } from "@/lib/db/client";
import { assertCanEditListing } from "@/lib/auth/guards";
import type { Actor } from "@/lib/auth/roles";
import { isTime, normalise, problemsWith, type RamadanHours, type WeekHours } from "@/lib/trade/hours";
import { describeProblemText } from "@/lib/trade/hours-copy";
import { branchStatus } from "@/lib/locations/branch";

/**
 * Board 3d's writes — the week, the Ramadan confirmation, and the dates a
 * seller adds.
 *
 * `saveHours` in `lib/listing/service.ts` predates this and still owns the plain
 * per-branch save that board 2d's onboarding step calls. What is here is
 * everything the manager screen does that onboarding never had to: write one
 * named branch and say which, copy a week across branches after showing what it
 * costs, confirm a year's Ramadan hours, and schedule a closure.
 *
 * No `AuditEvent`. These are the seller's own statements about their own
 * trading hours, and `AuditEvent` is the staff log — `ListingRevision` is the
 * seller-side record, which board 3b's rail already draws.
 */

async function recordRevision(businessId: string, actorId: string, field: string, itemCount?: number) {
  await prisma.listingRevision.create({
    data: { businessId, actorId, field, itemCount: itemCount ?? null },
  });
}

/* ── The week ────────────────────────────────────────────────────────────── */

export type SaveResult =
  | { ok: true; applied: number }
  | { ok: false; error: string; fix?: string };

/**
 * Criterion 1: the save writes the selected branch, and only that one.
 *
 * `locationId` is required and there is no `"all"`. Board 3d's fifth correction
 * is that a branch picker, a copy-to-all button and a Save in one 58px header
 * with nothing saying which branch is being written is how a seller overwrites
 * a depot's hours with a head office's — so the bulk path is `copyHours` below,
 * which is a different function with a preview in front of it and a different
 * word on its button.
 */
export async function saveBranchWeek(
  actor: Actor,
  businessId: string,
  input: { locationId: string; hours: WeekHours; ramadanHours?: RamadanHours | null },
): Promise<SaveResult> {
  assertCanEditListing(actor);

  const problems = problemsWith(input.hours);
  if (problems.length > 0) {
    return { ok: false, error: describeProblemText(problems[0]!) };
  }

  const ramadan =
    input.ramadanHours === undefined
      ? undefined
      : input.ramadanHours === null
        ? Prisma.DbNull
        : (normaliseRamadan(input.ramadanHours) as unknown as Prisma.InputJsonValue);

  const { count } = await prisma.location.updateMany({
    where: { id: input.locationId, businessId },
    data: {
      hours: normalise(input.hours) as unknown as object,
      ...(ramadan !== undefined ? { ramadanHours: ramadan } : {}),
    },
  });
  if (count === 0) return { ok: false, error: "not_found" };

  await recordRevision(businessId, actor.id, "hours");
  return { ok: true, applied: count };
}

/**
 * Ramadan's own block, normalised the same way the week is.
 *
 * `all` is kept because that is the shape the storefront already reads and the
 * shape board 3d's condensed rows write — Ramadan hours vary by weekday group
 * rather than by day for almost every supplier, which is Q3's answer.
 */
function normaliseRamadan(hours: RamadanHours): RamadanHours {
  const out = normalise(hours) as RamadanHours;
  if (hours.all) out.all = hours.all.filter((shift) => isTime(shift.open) && isTime(shift.close));
  return out;
}

/* ── Copying a week ──────────────────────────────────────────────────────── */

/**
 * Criterion 2's write half. The preview is `lib/hours/copy.ts`, and it is the
 * caller's job to have shown it.
 *
 * Explicit target ids rather than "everything else", so the modal that named
 * four branches and the update that touches four branches cannot come to
 * disagree — a preview describing a different set from the write is worse than
 * no preview.
 */
export async function copyHours(
  actor: Actor,
  businessId: string,
  input: { fromLocationId: string; toLocationIds: readonly string[] },
): Promise<SaveResult> {
  assertCanEditListing(actor);
  if (input.toLocationIds.length === 0) return { ok: true, applied: 0 };

  const source = await prisma.location.findFirst({
    where: { id: input.fromLocationId, businessId },
    select: { hours: true, ramadanHours: true },
  });
  if (!source) return { ok: false, error: "not_found" };

  const { count } = await prisma.location.updateMany({
    where: { id: { in: [...input.toLocationIds] }, businessId },
    data: {
      hours: source.hours as object,
      ramadanHours:
        source.ramadanHours === null
          ? Prisma.DbNull
          : (source.ramadanHours as Prisma.InputJsonValue),
      /*
         The confirmation does not travel with the hours.

         A seller confirming the head office's Ramadan times has said something
         about the head office. Copying that word onto four branches would clear
         board 3a's reminder for branches nobody has looked at, which is the
         reminder quietly lying rather than the seller being efficient.
      */
      ramadanConfirmedYear: null,
    },
  });

  await recordRevision(businessId, actor.id, "hours", count);
  return { ok: true, applied: count };
}

/* ── Confirming Ramadan ──────────────────────────────────────────────────── */

/**
 * Criterion 4: confirming is what clears board 3a's card, and nothing else does.
 *
 * The year comes from the platform's window rather than from the form. It is
 * the platform's calendar that decides which Ramadan the seller is confirming
 * hours for, and a year posted by a browser is a year a browser could be wrong
 * about.
 */
export async function confirmRamadanHours(
  actor: Actor,
  businessId: string,
  input: { locationId: string; year: number },
): Promise<SaveResult> {
  assertCanEditListing(actor);

  const { count } = await prisma.location.updateMany({
    where: { id: input.locationId, businessId },
    data: { ramadanConfirmedYear: input.year },
  });
  if (count === 0) return { ok: false, error: "not_found" };

  await recordRevision(businessId, actor.id, "hours");
  return { ok: true, applied: count };
}

/* ── The seller's own dates ──────────────────────────────────────────────── */

export type ClosureResult =
  | { ok: true; id: string }
  | { ok: false; error: "not_found" | "backwards" | "half_day_needs_hours" | "no_reason" };

/**
 * A date the seller adds to the rail, or a half day.
 *
 * Criterion 8, and board 3d's sixth correction: a half day carries its hours or
 * it is a setting whose value the seller cannot see. Checked here as well as by
 * the CHECK, so they get a sentence rather than a constraint violation.
 */
export async function addClosure(
  actor: Actor,
  businessId: string,
  input: {
    locationId: string;
    startsOn: Date;
    endsOn: Date;
    reason: string;
    openFrom?: string | null;
    openUntil?: string | null;
  },
): Promise<ClosureResult> {
  assertCanEditListing(actor);

  if (input.reason.trim() === "") return { ok: false, error: "no_reason" };
  if (input.endsOn < input.startsOn) return { ok: false, error: "backwards" };

  const half = Boolean(input.openFrom) || Boolean(input.openUntil);
  if (half && !(isTime(input.openFrom ?? "") && isTime(input.openUntil ?? ""))) {
    return { ok: false, error: "half_day_needs_hours" };
  }

  const owned = await prisma.location.findFirst({
    where: { id: input.locationId, businessId },
    select: { id: true },
  });
  if (!owned) return { ok: false, error: "not_found" };

  const row = await prisma.locationClosure.create({
    data: {
      locationId: input.locationId,
      startsOn: input.startsOn,
      endsOn: input.endsOn,
      reason: input.reason.trim(),
      openFrom: half ? input.openFrom! : null,
      openUntil: half ? input.openUntil! : null,
    },
    select: { id: true },
  });

  await recordRevision(businessId, actor.id, "hours");
  return { ok: true, id: row.id };
}

export async function removeClosure(
  actor: Actor,
  businessId: string,
  closureId: string,
): Promise<{ ok: true } | { ok: false; error: "not_found" }> {
  assertCanEditListing(actor);
  const { count } = await prisma.locationClosure.deleteMany({
    where: { id: closureId, location: { businessId } },
  });
  if (count === 0) return { ok: false, error: "not_found" };
  await recordRevision(businessId, actor.id, "hours");
  return { ok: true };
}

/* ── The temporary closure ───────────────────────────────────────────────── */

/**
 * The one thing that outranks everything else on this screen.
 *
 * Board 3d Q2: **a notice, not a routing change.** A closed warehouse still
 * wants next week's enquiries, and board 3c already establishes hiding as the
 * way to stop them — so this writes no visibility and touches no RFQ path.
 *
 * `Location`'s own three columns rather than a row in `location_closure`,
 * because they shipped before this board with a CHECK that refuses a half-set
 * window, and board 1f already renders them. §5 describes one closure at a
 * time, which is what three columns hold.
 */
export async function scheduleClosure(
  actor: Actor,
  businessId: string,
  input: { locationId: string; from: Date; until: Date; reason: string },
): Promise<ClosureResult> {
  assertCanEditListing(actor);
  if (input.reason.trim() === "") return { ok: false, error: "no_reason" };
  if (input.until < input.from) return { ok: false, error: "backwards" };

  const { count } = await prisma.location.updateMany({
    where: { id: input.locationId, businessId },
    data: { closedFrom: input.from, closedUntil: input.until, closureReason: input.reason.trim() },
  });
  if (count === 0) return { ok: false, error: "not_found" };

  await recordRevision(businessId, actor.id, "hours");
  return { ok: true, id: input.locationId };
}

export async function clearClosure(
  actor: Actor,
  businessId: string,
  locationId: string,
): Promise<{ ok: true } | { ok: false; error: "not_found" }> {
  assertCanEditListing(actor);
  const { count } = await prisma.location.updateMany({
    where: { id: locationId, businessId },
    data: { closedFrom: null, closedUntil: null, closureReason: null },
  });
  if (count === 0) return { ok: false, error: "not_found" };
  await recordRevision(businessId, actor.id, "hours");
  return { ok: true };
}

/* ── Which branches this screen offers ───────────────────────────────────── */

/**
 * Criterion 11: draft branches are not in the picker.
 *
 * A branch nobody has published has no buyers to make claims to, so hours for
 * it are hours about nothing. Hidden branches *are* offered — board 3c's
 * `branchStatus` is what tells the two apart, and their hours still matter for
 * the day they come back.
 */
export function pickerBranches<T extends { published: boolean; publishedAt: Date | null }>(
  branches: readonly T[],
): T[] {
  return branches.filter((branch) => branchStatus(branch) !== "draft");
}
