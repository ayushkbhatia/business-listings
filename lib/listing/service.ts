import "server-only";
import { prisma } from "@/lib/db/client";
import { Prisma } from "@/lib/db/generated/client";
import { assertCanEditListing } from "@/lib/auth/guards";
import type { Actor } from "@/lib/auth/roles";
import { normalise, problemsWith, type RamadanHours, type WeekHours } from "@/lib/trade/hours";
import { describeProblemText } from "@/lib/trade/hours-copy";
import { DESCRIPTION_LIMIT } from "./constants";

export { DESCRIPTION_LIMIT };

/**
 * Editing a listing, and the one line that decides whether a person sees it
 * first.
 *
 * Acceptance criterion 8: only trade name, category and licence changes enter
 * the moderation queue. Photographs, hours, products and descriptions publish
 * immediately.
 *
 * The split is expressed once, as data, in `MODERATED`. A service that decided
 * per call site would drift the first time somebody added a field, and the way
 * it would drift is towards moderating more — because moderating more always
 * feels safer in the moment. At 41,000 listings it is not safer: a queue that
 * gates hours and photographs never empties, and a dashboard where nothing a
 * seller does appears is a dashboard they stop opening.
 */

/** The three, and adding a fourth means changing an enum in the schema. */
export const MODERATED = ["trade_name", "primary_category", "licence"] as const;
export type ModeratedField = (typeof MODERATED)[number];

/**
 * Everything else. Listed rather than inferred, so a new field is a deliberate
 * choice on one side or the other rather than defaulting to instant by
 * omission.
 */
export const INSTANT = [
  "display_name",
  "description",
  "established_year",
  "team_size",
  "languages",
  "hours",
  "ramadan_hours",
  "locations",
  "media",
  "products",
] as const;
export type InstantField = (typeof INSTANT)[number];

export function isModerated(field: string): field is ModeratedField {
  return (MODERATED as readonly string[]).includes(field);
}

/* ── Instant: the profile a seller owns ──────────────────────────────────── */

export interface ProfileEdit {
  displayName?: string;
  description?: string;
  establishedYear?: number | null;
  teamSize?: string | null;
  languages?: string[];
}

export type EditResult = { ok: true } | { ok: false; error: string };

const TEAM_SIZES = ["b1_10", "b11_50", "b51_200", "b201_500", "b500_plus"] as const;


/**
 * Publishes on save. No queue, no "pending review" state, nothing to wait for.
 *
 * The trade name is not here and cannot be: it is the name on the licence, and
 * changing it is `requestModeratedChange`.
 */
export async function saveProfile(
  actor: Actor,
  businessId: string,
  edit: ProfileEdit,
): Promise<EditResult> {
  assertCanEditListing(actor);
  if (actor.businessId !== businessId) {
    return { ok: false, error: "You can only edit your own listing." };
  }

  if (edit.displayName !== undefined && edit.displayName.trim() === "") {
    return { ok: false, error: "Give your listing a display name buyers will recognise." };
  }
  if (edit.description !== undefined && edit.description.length > DESCRIPTION_LIMIT) {
    return {
      ok: false,
      error: `That description is ${edit.description.length} characters. The limit is ${DESCRIPTION_LIMIT}.`,
    };
  }
  if (
    edit.establishedYear !== undefined &&
    edit.establishedYear !== null &&
    (edit.establishedYear < 1900 || edit.establishedYear > new Date().getUTCFullYear())
  ) {
    return { ok: false, error: "Enter the year the business was established, as four digits." };
  }
  if (
    edit.teamSize !== undefined &&
    edit.teamSize !== null &&
    !(TEAM_SIZES as readonly string[]).includes(edit.teamSize)
  ) {
    return { ok: false, error: "Choose a team size from the list." };
  }

  await prisma.business.update({
    where: { id: businessId },
    data: {
      ...(edit.displayName !== undefined ? { displayName: edit.displayName.trim() } : {}),
      ...(edit.description !== undefined ? { description: edit.description.trim() || null } : {}),
      ...(edit.establishedYear !== undefined ? { establishedYear: edit.establishedYear } : {}),
      ...(edit.teamSize !== undefined ? { teamSize: edit.teamSize as never } : {}),
      ...(edit.languages !== undefined ? { languages: edit.languages } : {}),
    },
  });

  return { ok: true };
}

/* ── Instant: hours ──────────────────────────────────────────────────────── */

export type HoursResult = { ok: true; applied: number } | { ok: false; error: string };

/**
 * Save trading hours to one location, or to all of them.
 *
 * Copy-to-all-branches is not a convenience toggle: most suppliers keep the
 * same hours everywhere, and making them retype a split shift six times is how
 * five of the six end up wrong.
 */
export async function saveHours(
  actor: Actor,
  businessId: string,
  input: {
    locationId: string | "all";
    hours: WeekHours;
    ramadanHours?: RamadanHours | null;
  },
): Promise<HoursResult> {
  assertCanEditListing(actor);
  if (actor.businessId !== businessId) {
    return { ok: false, error: "You can only edit your own listing." };
  }

  const problems = problemsWith(input.hours);
  if (problems.length > 0) return { ok: false, error: describeProblemText(problems[0]!) };

  const hours = normalise(input.hours) as unknown as object;
  /*
   * `Prisma.DbNull`, not `null`. A nullable Json column has two empty states —
   * SQL NULL and the JSON value `null` — and Prisma makes you say which. A
   * seller clearing their Ramadan block means the column has nothing in it,
   * which is the SQL one.
   */
  const ramadan =
    input.ramadanHours === undefined
      ? undefined
      : input.ramadanHours === null
        ? Prisma.DbNull
        : (input.ramadanHours as unknown as Prisma.InputJsonValue);

  const where = input.locationId === "all" ? { businessId } : { businessId, id: input.locationId };

  const { count } = await prisma.location.updateMany({
    where,
    data: { hours, ...(ramadan !== undefined ? { ramadanHours: ramadan } : {}) },
  });

  if (count === 0) return { ok: false, error: "That branch cannot be found." };
  return { ok: true, applied: count };
}

/**
 * Says what is wrong and what correct looks like. Never blames the seller.
 *
 * The same function the editor calls while typing — see lib/trade/hours-copy.ts.
 * Two copies of this wording is how a seller is told one thing in the form and
 * another on save.
 */
export { describeProblemText as describeProblem };

/* ── Moderated: the three that wait ──────────────────────────────────────── */

export type ChangeRequestResult = { ok: true; id: string } | { ok: false; error: string };

/**
 * Ask for one of the three.
 *
 * Nothing on `Business` moves. The request carries the before and after so the
 * queue can show the change rather than only the ask, and the public listing
 * keeps saying what it says until somebody decides.
 *
 * One pending request per field. A seller who submits twice has changed their
 * mind, not asked twice, so the second supersedes the first — otherwise a
 * moderator picks up a request the seller has already replaced.
 */
export async function requestModeratedChange(
  actor: Actor,
  businessId: string,
  field: ModeratedField,
  afterValue: string,
): Promise<ChangeRequestResult> {
  assertCanEditListing(actor);
  if (actor.businessId !== businessId) {
    return { ok: false, error: "You can only edit your own listing." };
  }

  const value = afterValue.trim();
  if (value === "") return { ok: false, error: "Enter the new value before submitting it." };

  const business = await prisma.business.findUniqueOrThrow({
    where: { id: businessId },
    select: { tradeName: true, primaryCategoryId: true, licenceNumber: true },
  });

  const before =
    field === "trade_name"
      ? business.tradeName
      : field === "primary_category"
        ? business.primaryCategoryId
        : business.licenceNumber;

  if (before === value) {
    return { ok: false, error: "That is what it says now. Nothing has been submitted." };
  }

  const created = await prisma.$transaction(async (tx) => {
    await tx.listingChangeRequest.updateMany({
      where: { businessId, field, status: "pending" },
      data: { status: "withdrawn" },
    });

    return tx.listingChangeRequest.create({
      data: { businessId, actorId: actor.id, field, beforeValue: before, afterValue: value },
      select: { id: true },
    });
  });

  return { ok: true, id: created.id };
}

/** What is waiting, so the screen can say so beside the field it concerns. */
export async function pendingChanges(businessId: string) {
  return prisma.listingChangeRequest.findMany({
    where: { businessId, status: "pending" },
    orderBy: { createdAt: "desc" },
    select: { id: true, field: true, beforeValue: true, afterValue: true, createdAt: true },
  });
}

export async function withdrawChange(
  actor: Actor,
  businessId: string,
  id: string,
): Promise<EditResult> {
  assertCanEditListing(actor);
  if (actor.businessId !== businessId) {
    return { ok: false, error: "That request cannot be found." };
  }
  const { count } = await prisma.listingChangeRequest.updateMany({
    where: { id, businessId, status: "pending" },
    data: { status: "withdrawn" },
  });
  if (count === 0) return { ok: false, error: "That request cannot be found." };
  return { ok: true };
}
