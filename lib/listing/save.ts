import "server-only";
import { prisma } from "@/lib/db/client";
import { assertCanEditListing } from "@/lib/auth/guards";
import type { Actor } from "@/lib/auth/roles";
import { DESCRIPTION_LIMIT } from "./constants";
import { isModerated, requestModeratedChange, type ModeratedField } from "./service";

/**
 * Board 3b criterion 3 — **one action, two behaviours, and the seller is told
 * which is which.**
 *
 * The screen this replaces had two buttons: `Save` wrote the instant fields and
 * `Save & submit` queued a moderated one, with a global `2 edits pending
 * review` pill over the top that never said which of the two edits was live.
 * The split itself was right and is unchanged — `MODERATED` in ./service.ts is
 * still the one place it is expressed. What was wrong is that the seller had to
 * hold the model in their head to use the screen.
 *
 * So: one `Save changes`. It writes everything a seller owns immediately,
 * queues the fields a person has to look at, and reports **both halves** so the
 * screen can mark the held ones where they are edited and say the rest is live.
 *
 * ## Why the instant half writes even when the queued half fails
 *
 * A seller who fixes their description and adds a category in the same sitting
 * should not lose the description because the category was already pending.
 * They are independent edits that happen to share a button, and the result
 * names each outcome separately rather than collapsing to one boolean.
 *
 * The exception is validation on the instant fields themselves, which refuses
 * before anything is written — a description over the limit is the one hard
 * block on this screen, and it is a length, not a judgement.
 */

export interface ListingEdit {
  description?: string;
  paymentTerms?: string | null;
  establishedYear?: number | null;
  teamSize?: string | null;
  languages?: string[];
  /** Requested primary category. Queued when it differs from the current one. */
  primaryCategoryId?: string;
  /** Category ids to ask for. Each becomes its own queue row. */
  addCategoryIds?: string[];
  /** Category ids to drop. Instant — giving up reach needs no gate. */
  removeCategoryIds?: string[];
}

export interface SaveOutcome {
  ok: true;
  /** Field keys written and live now, for the catalogue to name. */
  live: string[];
  /** Field keys a person has to clear, with what was asked. */
  held: { field: ModeratedField; value: string }[];
  /** Asks that were refused, with the reason the seller reads. */
  refused: { value: string; error: string }[];
}

export type SaveResult = SaveOutcome | { ok: false; error: string };

const TEAM_SIZES = ["b1_10", "b11_50", "b51_200", "b201_500", "b500_plus"] as const;

export async function saveListing(
  actor: Actor,
  businessId: string,
  edit: ListingEdit,
): Promise<SaveResult> {
  assertCanEditListing(actor);
  if (actor.businessId !== businessId) {
    return { ok: false, error: "You can only edit your own listing." };
  }

  /*
     Validation first, and all of it, before a single write.

     A save that wrote the description and then refused the year would leave the
     form disagreeing with the record about what happened.
  */
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

  const business = await prisma.business.findUniqueOrThrow({
    where: { id: businessId },
    select: {
      description: true,
      paymentTerms: true,
      establishedYear: true,
      teamSize: true,
      languages: true,
      primaryCategoryId: true,
    },
  });

  const live: string[] = [];
  const data: Record<string, unknown> = {};

  /*
     Only what actually moved.

     The form posts every field on every save, so writing all of them would put
     "Description" in the revision list every time a seller changed their
     opening year — and the rail's whole job is saying what changed.
  */
  const description = edit.description?.trim() || null;
  if (edit.description !== undefined && description !== business.description) {
    data.description = description;
    live.push("description");
  }
  const terms = edit.paymentTerms?.trim() || null;
  if (edit.paymentTerms !== undefined && terms !== business.paymentTerms) {
    data.paymentTerms = terms;
    live.push("payment_terms");
  }
  if (edit.establishedYear !== undefined && edit.establishedYear !== business.establishedYear) {
    data.establishedYear = edit.establishedYear;
    live.push("established_year");
  }
  if (edit.teamSize !== undefined && edit.teamSize !== business.teamSize) {
    data.teamSize = edit.teamSize;
    live.push("team_size");
  }
  if (edit.languages !== undefined && !sameSet(edit.languages, business.languages)) {
    data.languages = edit.languages;
    live.push("languages");
  }

  const removing = edit.removeCategoryIds ?? [];
  if (removing.length > 0) {
    /*
       Removal is instant, and that is not an oversight.

       Adding a category widens which enquiries reach a listing, into a market
       the seller may not be licensed for — that is what the queue is for.
       Taking one away narrows it. A seller giving up their own reach does not
       need a person's permission, and gating it would mean a listing sits in a
       category it has told us it does not serve until somebody gets to it.
    */
    const { count } = await prisma.businessCategory.deleteMany({
      where: { businessId, categoryId: { in: removing } },
    });
    if (count > 0) live.push("categories_removed");
  }

  if (Object.keys(data).length > 0) {
    await prisma.business.update({ where: { id: businessId }, data });
  }

  /* ── The half a person looks at ───────────────────────────────────────── */

  const held: { field: ModeratedField; value: string }[] = [];
  const refused: { value: string; error: string }[] = [];

  if (
    edit.primaryCategoryId !== undefined &&
    edit.primaryCategoryId !== business.primaryCategoryId
  ) {
    const asked = await requestModeratedChange(
      actor,
      businessId,
      "primary_category",
      edit.primaryCategoryId,
    );
    if (asked.ok) held.push({ field: "primary_category", value: edit.primaryCategoryId });
    else refused.push({ value: edit.primaryCategoryId, error: asked.error });
  }

  for (const categoryId of edit.addCategoryIds ?? []) {
    const asked = await requestModeratedChange(actor, businessId, "additional_category", categoryId);
    if (asked.ok) held.push({ field: "additional_category", value: categoryId });
    else refused.push({ value: categoryId, error: asked.error });
  }

  await recordRevisions(businessId, actor.id, live);

  return { ok: true, live, held, refused };
}

/**
 * The rail's recent-changes list, written here rather than in each branch.
 *
 * One row per field group that actually moved, so "Description · S. Menon · 2 H"
 * is a fact about a save rather than a row written on every submit. See
 * `ListingRevision` for why this is not the audit log.
 */
async function recordRevisions(
  businessId: string,
  actorId: string,
  fields: readonly string[],
): Promise<void> {
  if (fields.length === 0) return;
  await prisma.listingRevision.createMany({
    data: fields.map((field) => ({ businessId, actorId, field })),
  });
}

/** One revision for a photo save, with the count the rail shows. */
export async function recordPhotoRevision(
  businessId: string,
  actorId: string,
  itemCount: number,
): Promise<void> {
  await prisma.listingRevision.create({
    data: { businessId, actorId, field: "photos", itemCount },
  });
}

/** The three the rail draws. Newest first, with who saved them. */
export async function recentRevisions(businessId: string, take = 3) {
  return prisma.listingRevision.findMany({
    where: { businessId },
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      field: true,
      itemCount: true,
      createdAt: true,
      actor: { select: { fullName: true } },
    },
  });
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((value, index) => value === right[index]);
}

export { isModerated };
