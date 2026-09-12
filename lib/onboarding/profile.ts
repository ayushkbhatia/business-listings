import "server-only";
import { prisma } from "@/lib/db/client";
import { profileStrength, strengthItems, type StrengthItem } from "@/lib/metrics/profile-strength";
import { VERIFIED_TIER } from "@/lib/verification";
import { checkDisplayName, couldBeMistakenFor, type DisplayNameProblem } from "./display-name";
import { DESCRIPTION_MAX, ESTABLISHED_MIN, TEAM_SIZES, type TeamSize } from "./profile-fields";
import {
  checkServiceProfile,
  type ProfileRefusal,
  type ServiceProfileInput,
} from "./service-profile";

/**
 * Board 2c — the first screen where a seller writes rather than proves.
 *
 * `2a` and `2b` established that they are entitled to speak for the licence.
 * This is where they decide what they sound like, and two things make it work:
 * the preview renders the card their profile will actually produce, and the
 * strength meter turns "please fill this in" into a number with named levers.
 *
 * Everything here is a patch of one field. Board 2c's autosave sends the field
 * that changed and nothing else, so a seller with two tabs open does not have
 * one of them post a stale copy of the other's work over the top.
 */

export interface ProfileState {
  businessId: string;
  /** Locked to the licence, forever. Rendered grey and never editable. */
  tradeName: string;
  displayName: string;
  description: string;
  establishedYear: number | null;
  teamSize: string | null;
  logoUrl: string | null;
  coverUrl: string | null;

  primaryCategoryId: string;
  primaryCategoryName: string;
  primaryParentName: string | null;
  extras: ProfileCategory[];

  /** Null is unlimited. Includes the primary, so extras are this minus one. */
  categoryLimit: number | null;
  planId: string;
  planName: string;

  /** For the preview's pill, which is never optimistic. */
  verificationTier: number;
  isVerified: boolean;

  areaName: string | null;
  emirateName: string | null;
  categoryCode: string;

  strength: number;
  items: StrengthItem[];
  savedAt: Date;
}

export interface ProfileCategory {
  id: string;
  name: string;
  /** Set where the licence's stated activity did not cover this category. */
  unverifiedActivity: boolean;
}

/*
   Re-exported, not redefined. They live in `./profile-fields.ts` because board
   2c's form is a client component and this module is server-only — see the note
   there for what importing a constant across that boundary actually costs.
*/
export { DESCRIPTION_MAX, ESTABLISHED_MIN, TEAM_SIZES, type TeamSize } from "./profile-fields";

/** Everything board 2c renders, in one read. */
export async function profileStateFor(businessId: string): Promise<ProfileState | null> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: {
      id: true,
      tradeName: true,
      displayName: true,
      description: true,
      establishedYear: true,
      teamSize: true,
      languages: true,
      verificationTier: true,
      planId: true,
      updatedAt: true,
      primaryCategoryId: true,
      primaryCategory: { select: { name: true, code: true, parent: { select: { name: true } } } },
      plan: { select: { id: true, name: true, categoryLimit: true } },
      categories: {
        orderBy: { createdAt: "asc" },
        select: {
          categoryId: true,
          unverifiedActivityAt: true,
          category: { select: { name: true } },
        },
      },
      locations: {
        where: { published: true },
        orderBy: { createdAt: "asc" },
        take: 1,
        select: { emirate: true, area: { select: { name: true } } },
      },
      media: {
        where: { kind: { in: ["logo", "cover"] } },
        orderBy: { createdAt: "desc" },
        select: { kind: true, storagePath: true },
      },
    },
  });
  if (!business) return null;

  const facts = await profileFacts(businessId, business);

  const logo = business.media.find((m) => m.kind === "logo")?.storagePath ?? null;
  const cover = business.media.find((m) => m.kind === "cover")?.storagePath ?? null;

  return {
    businessId: business.id,
    tradeName: business.tradeName,
    displayName: business.displayName,
    description: business.description ?? "",
    establishedYear: business.establishedYear,
    teamSize: business.teamSize,
    logoUrl: logo,
    coverUrl: cover,

    primaryCategoryId: business.primaryCategoryId,
    primaryCategoryName: business.primaryCategory.name,
    primaryParentName: business.primaryCategory.parent?.name ?? null,
    extras: business.categories.map((row) => ({
      id: row.categoryId,
      name: row.category.name,
      unverifiedActivity: row.unverifiedActivityAt !== null,
    })),

    categoryLimit: business.plan?.categoryLimit ?? null,
    planId: business.plan?.id ?? business.planId ?? "free",
    planName: business.plan?.name ?? "Free",

    verificationTier: business.verificationTier,
    isVerified: business.verificationTier >= VERIFIED_TIER,

    areaName: business.locations[0]?.area?.name ?? null,
    emirateName: business.locations[0]?.emirate ?? null,
    categoryCode: business.primaryCategory.code,

    strength: profileStrength(facts),
    items: strengthItems(facts),
    savedAt: business.updatedAt,
  };
}

/**
 * The facts the meter reads.
 *
 * `locations` and `locationsWithHours` are still gathered and still passed, and
 * the weights ignore them — board 2c, criterion 14. Kept in the shape rather
 * than dropped from it because `ProfileFacts` is what the nightly job builds
 * too, and a field that exists and scores nothing is easier to read than a
 * field that vanished for reasons in another file.
 */
async function profileFacts(
  businessId: string,
  business: {
    description: string | null;
    establishedYear: number | null;
    teamSize: string | null;
    languages: string[];
    categories: unknown[];
    media: { kind: string }[];
    /* Board `8a-s`. Zero on every goods listing, and read from the row rather
       than queried again — the caller already selected them. */
    sectorsServed?: string[];
    deliveryModes?: unknown[];
    verifiedAt?: Date | null;
  },
) {
  const [productRows, photos, seats, locations, withHours, servicesLive, coverageAreas, credentials] =
    await Promise.all([
    /*
       Spec values are a JSON column, so "has any spec value" is a read rather
       than a `count`. The same rule the nightly job applies in
       `lib/metrics/strength-job.ts`: any value at all counts, because the
       per-template completeness check belongs with the catalogue and counting an
       empty spec object as complete would be the wrong direction to be wrong in.
    */
    prisma.product.findMany({ where: { businessId }, select: { specValues: true } }),
    prisma.media.count({
      where: { businessId, reviewId: null },
    }),
    prisma.user.count({ where: { businessId } }),
    prisma.location.count({ where: { businessId } }),
    prisma.location.count({ where: { businessId, hours: { not: {} } } }),
    prisma.service.count({ where: { businessId, status: "live" } }),
    prisma.serviceCoverage.count({ where: { businessId } }),
    prisma.document.count({ where: { businessId, kind: "certificate" } }),
  ]);

  const filterable = productRows.filter((product) => {
    const values = product.specValues as Record<string, unknown> | null;
    return values !== null && Object.keys(values).length > 0;
  }).length;

  return {
    hasDescription: Boolean(business.description?.trim()),
    hasLogo: business.media.some((m) => m.kind === "logo"),
    hasCover: business.media.some((m) => m.kind === "cover"),
    additionalCategories: business.categories.length,
    hasEstablishedYear: business.establishedYear !== null,
    hasTeamSize: business.teamSize !== null,
    languages: business.languages.length,
    locations,
    locationsWithHours: withHours,
    products: productRows.length,
    productsWithFilterableSpecs: filterable,
    photos,
    teamSeats: seats,

    credentials,
    licenceVerified: business.verifiedAt != null,
    servicesLive,
    sectors: business.sectorsServed?.length ?? 0,
    deliveryModes: business.deliveryModes?.length ?? 0,
    coverageAreas,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// The patches
// ─────────────────────────────────────────────────────────────────────────────

export type PatchField =
  | "displayName"
  | "description"
  | "establishedYear"
  | "teamSize";

export type PatchResult =
  | { ok: true; savedAt: Date; flaggedForReview?: boolean }
  | { ok: false; field: PatchField; problem: PatchProblem };

export type PatchProblem =
  | DisplayNameProblem
  | { kind: "description_too_long"; length: number }
  | { kind: "established_out_of_range" }
  | { kind: "unknown_team_size" };

/**
 * One field, saved.
 *
 * Board 2c's autosave patches the field that changed and nothing else. The
 * alternative — posting the whole form on every idle — is what turns two open
 * tabs into one of them quietly overwriting the other's description with the
 * copy it loaded ten minutes ago.
 */
export async function patchProfileField(
  businessId: string,
  field: PatchField,
  raw: string,
): Promise<PatchResult> {
  if (field === "displayName") return patchDisplayName(businessId, raw);

  if (field === "description") {
    const value = raw.slice(0, DESCRIPTION_MAX + 1);
    if (value.length > DESCRIPTION_MAX) {
      return {
        ok: false,
        field,
        problem: { kind: "description_too_long", length: value.length },
      };
    }
    return saved(businessId, { description: value.trim() || null });
  }

  if (field === "establishedYear") {
    if (raw.trim() === "") return saved(businessId, { establishedYear: null });
    const year = Number(raw);
    const thisYear = new Date().getUTCFullYear();
    if (!Number.isInteger(year) || year < ESTABLISHED_MIN || year > thisYear) {
      return { ok: false, field, problem: { kind: "established_out_of_range" } };
    }
    /*
       Accepted even where it predates the licence. A 2014 licence on a business
       established in 1998 is ordinary — a relocation, or a re-registered entity
       — which is why board 1d renders the year as self-reported rather than as a
       verified fact. Refusing it would call an honest seller a liar.
    */
    return saved(businessId, { establishedYear: year });
  }

  if (raw.trim() === "") return saved(businessId, { teamSize: null });
  if (!TEAM_SIZES.includes(raw as TeamSize)) {
    return { ok: false, field: "teamSize", problem: { kind: "unknown_team_size" } };
  }
  return saved(businessId, { teamSize: raw as TeamSize });
}

async function patchDisplayName(businessId: string, raw: string): Promise<PatchResult> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: {
      primaryCategory: { select: { name: true } },
      categories: { select: { category: { select: { name: true } } } },
      locations: { take: 1, select: { emirate: true } },
    },
  });
  if (!business) return { ok: false, field: "displayName", problem: { kind: "too_short" } };

  const categoryWords = [
    business.primaryCategory.name,
    ...business.categories.map((row) => row.category.name),
  ];

  const checked = checkDisplayName(raw, categoryWords);
  if (!checked.ok) return { ok: false, field: "displayName", problem: checked.problem };

  /*
     A near-match to a verified listing in the same emirate is taken and flagged,
     never refused. In a market where a hundred firms are called Al Something
     Trading it is usually a coincidence; occasionally it is somebody trying to
     be mistaken for a competitor. A form cannot tell those apart, and refusing
     inline would block the common case to catch the rare one — so it goes to a
     person, and the seller carries on.
  */
  const emirate = business.locations[0]?.emirate ?? null;
  const collision = emirate ? await findCollision(businessId, checked.value, emirate) : null;

  const result = await saved(businessId, { displayName: checked.value });
  if (!result.ok || !collision) return result;

  await flagPossibleImpersonation(businessId, checked.value, collision);
  return { ...result, flaggedForReview: true };
}

async function findCollision(
  businessId: string,
  name: string,
  emirate: string,
): Promise<{ id: string; displayName: string } | null> {
  const nearby = await prisma.business.findMany({
    where: {
      id: { not: businessId },
      verificationTier: { gte: VERIFIED_TIER },
      suspendedAt: null,
      mergedIntoId: null,
      locations: { some: { emirate: emirate as never } },
    },
    select: { id: true, displayName: true },
    take: 500,
  });
  return nearby.find((other) => couldBeMistakenFor(name, other.displayName)) ?? null;
}

/**
 * The queue row a reviewer reads.
 *
 * A `SupplierReport` with no reporter, which is what `reporterId` being nullable
 * is for: the platform noticed this, not a person, and the row should not name
 * one who did not exist.
 */
async function flagPossibleImpersonation(
  businessId: string,
  name: string,
  other: { id: string; displayName: string },
): Promise<void> {
  const open = await prisma.supplierReport.findFirst({
    where: { subjectBusinessId: businessId, subjectField: "display_name", resolvedAt: null },
    select: { id: true },
  });
  const detail = `"${name}" is close to "${other.displayName}" (${other.id}) in the same emirate.`;

  // One open row per listing, updated rather than duplicated: autosave fires on
  // every idle, and a queue with forty rows for one keystroke sequence is a
  // queue nobody works through.
  if (open) {
    await prisma.supplierReport.update({ where: { id: open.id }, data: { detail } });
    return;
  }
  await prisma.supplierReport.create({
    data: {
      subjectBusinessId: businessId,
      kind: "wrong_details",
      subjectField: "display_name",
      detail,
    },
  });
}

async function saved(
  businessId: string,
  data: Record<string, unknown>,
): Promise<{ ok: true; savedAt: Date }> {
  const row = await prisma.business.update({
    where: { id: businessId },
    data: data as never,
    select: { updatedAt: true },
  });
  return { ok: true, savedAt: row.updatedAt };
}

/**
 * Board `2c-s` — save the services field set.
 *
 * A whole-set save rather than the per-field patch above, for two reasons. The
 * fields are arrays and `patchProfileField` takes a string; and the dashboard
 * mirror at `3b-s` saves a whole form, so one shape here keeps AC7's "a change
 * to one is a change to both" true of the write path as well as the render.
 *
 * **Nothing is truncated.** Over the cap is a refusal naming the cap — B4 — and
 * that holds for the sectors too. Silently dropping a sixth service teaches a
 * seller that the form is lying to them, and they find out at `8c-s` when the
 * scope sheet is missing.
 */
export async function saveServiceProfile(
  businessId: string,
  input: ServiceProfileInput,
): Promise<{ ok: true; savedAt: Date } | { ok: false; refusals: ProfileRefusal[] }> {
  const checked = checkServiceProfile(input);
  if (!checked.ok) return { ok: false, refusals: checked.refusals };

  const saved = await prisma.business.update({
    where: { id: businessId },
    data: {
      headline: checked.value.headline,
      sectorsServed: checked.value.sectorsServed,
      servicesOffered: checked.value.servicesOffered,
    },
    select: { updatedAt: true },
  });

  return { ok: true, savedAt: saved.updatedAt };
}
