import "server-only";
import { prisma } from "@/lib/db/client";
import { assertCanEditListing } from "@/lib/auth/guards";
import type { Actor } from "@/lib/auth/roles";
import { effectiveFor } from "@/lib/billing/entitlements-service";
import { allowance } from "@/lib/plan/entitlements";
import { WEIGHTS } from "@/lib/metrics/profile-strength";
import { MEDIA_BUCKET, publicUrl } from "@/lib/storage";
import { readSlotKey } from "./slots";
import { NON_LOGO_TARGET, PHOTO_TARGET } from "./targets";

/**
 * Board 8b — the photographs task.
 *
 * Everything the screen reads and everything it writes. The screen itself is a
 * grid and a top bar; every rule about what counts, what a cover is, and what a
 * seller is allowed lives here, where it can be tested without a browser.
 *
 * ## The cover is a kind, not a flag
 *
 * `MediaKind` already has `cover`, and `lib/storefront/loader.ts` already picks
 * the hero with `media.find(e => e.kind === "storefront" || e.kind === "cover")`.
 * So promoting a photograph is a kind change and needs no new column, and the
 * storefront reads it without learning anything. "Exactly one" is enforced twice
 * — a transaction that demotes before it promotes, and a partial unique index
 * behind that, because two tabs and a retry are enough to produce two covers and
 * a storefront that picks whichever row sorted first.
 *
 * ## What is counted, and what the seller is told
 *
 * The task wants five photographs of which at least three are not the logo.
 * Those are two different conditions and the screen must not merge them: the
 * count drives the bar and the pro-rata points, the non-logo rule gates
 * completion. Board 8b §2 is explicit that the non-logo requirement scores
 * nothing of its own — it is a gate, and it is explained at the point it blocks
 * rather than before.
 */

/*
   Re-exported, not redefined. `lib/photos/targets.ts` is the one place these
   live, because the setup hub's card states the same figures.
*/
export { NON_LOGO_TARGET, PHOTO_MINUTES, PHOTO_TARGET } from "./targets";

/** The kinds this board writes. A photograph is one of exactly two things. */
const BOARD_KINDS = ["gallery", "cover"] as const;

export interface PhotoItem {
  id: string;
  url: string;
  /** The seller's own filename, for a photograph filed outside a slot. */
  filename: string;
  slotKey: string | null;
  isCover: boolean;
  isLogo: boolean;
  width: number | null;
  height: number | null;
  sortOrder: number;
}

export interface PhotoBoard {
  items: PhotoItem[];
  /** Everything on the listing, logo included — the figure the bar shows. */
  count: number;
  target: number;
  /** How many are not the logo. Gates completion, scores nothing. */
  nonLogo: number;
  nonLogoTarget: number;
  done: boolean;
  /**
   * Whole points earned so far, pro-rata on count to the target.
   *
   * `3 / 5 × 20 = 12`. Board 8b's render says `+7% SO FAR` against a twelve-
   * point weight; this repo's photographs lever is twenty (see WEIGHTS), and
   * the figure is read from there rather than restated, so the chip and the
   * meter on the hub cannot drift apart.
   */
  pointsSoFar: number;
  pointsWhole: number;
  /** Null where the plan does not cap photographs. */
  capRemaining: number | null;
  atCap: boolean;
  cap: number | null;
  planName: string | null;
}

const ITEM_SELECT = {
  id: true,
  kind: true,
  storagePath: true,
  alt: true,
  slotKey: true,
  width: true,
  height: true,
  sortOrder: true,
  createdAt: true,
} as const;

/**
 * What the board renders.
 *
 * Business photographs only: product images belong to a product screen and a
 * review's photograph belongs to the buyer who took it. The cap, however, is
 * counted the way the rest of the product counts it — see `photoUsage`.
 */
export async function photoBoardFor(businessId: string): Promise<PhotoBoard> {
  const [rows, used, caps] = await Promise.all([
    prisma.media.findMany({
      where: { businessId, kind: { in: [...BOARD_KINDS, "logo"] }, reviewId: null },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: ITEM_SELECT,
    }),
    photoUsage(businessId),
    effectiveFor(businessId),
  ]);

  const items: PhotoItem[] = rows.map((row) => ({
    id: row.id,
    url: publicUrl(MEDIA_BUCKET, row.storagePath),
    filename: filenameOf(row.storagePath, row.alt),
    slotKey: row.slotKey,
    isCover: row.kind === "cover",
    isLogo: row.kind === "logo",
    width: row.width,
    height: row.height,
    sortOrder: row.sortOrder,
  }));

  const count = items.length;
  const nonLogo = items.filter((item) => !item.isLogo).length;
  const left = caps ? allowance(caps, "photos", used) : null;

  /*
     Pro-rata on count, floored, and capped at the target.

     Floored rather than rounded because a seller at 3 of 5 should not be shown
     a number the meter will not agree with the moment the job recomputes it.
     Capped because a sixth photograph is welcome and is not worth more.
  */
  const ratio = Math.min(1, count / PHOTO_TARGET);
  const pointsWhole = WEIGHTS.photos;

  return {
    items,
    count,
    target: PHOTO_TARGET,
    nonLogo,
    nonLogoTarget: NON_LOGO_TARGET,
    done: count >= PHOTO_TARGET && nonLogo >= NON_LOGO_TARGET,
    pointsSoFar: Math.floor(ratio * pointsWhole),
    pointsWhole,
    capRemaining: left?.remaining ?? null,
    atCap: left?.atCap ?? false,
    cap: left?.cap ?? null,
    planName: caps?.name ?? null,
  };
}

/**
 * The denominator the photograph cap is measured against.
 *
 * Business media plus product media, review photographs excluded — the same
 * `where` the media library and its own gate already use, so the two screens
 * cannot disagree about how full a plan is.
 */
export async function photoUsage(businessId: string): Promise<number> {
  return prisma.media.count({
    where: { OR: [{ businessId }, { product: { businessId } }], reviewId: null },
  });
}

/** The object's own name, or the alt the seller gave it. */
function filenameOf(storagePath: string, alt: string | null): string {
  if (alt && alt.trim() !== "") return alt;
  return storagePath.split("/").pop() ?? storagePath;
}

export type PhotoResult = { ok: true } | { ok: false; error: string };

export interface AttachInput {
  /** The storage path the signed upload wrote to. Re-checked against the seat. */
  path: string;
  slotKey?: string | null;
  bytes: number;
  width: number;
  height: number;
  /** The name off the seller's phone, kept for the grid. */
  filename: string;
}

/**
 * Record an uploaded photograph.
 *
 * The first one a listing has becomes the cover, which is board 8b §2's rule
 * and is also the only way a storefront gets a hero without asking anybody a
 * question. Everything after it is a gallery item at the end of the order.
 */
export async function attachPhoto(
  actor: Actor,
  businessId: string,
  input: AttachInput,
): Promise<PhotoResult> {
  assertCanEditListing(actor);
  if (actor.businessId !== businessId) {
    return { ok: false, error: "You can only add photographs to your own listing." };
  }

  /*
     The path is the client's word for where it wrote. It was issued by
     `signUpload` for this business, but the value comes back through the
     browser, so it is checked again rather than trusted — the media board does
     the same and for the same reason.
  */
  if (!input.path.startsWith(`${businessId}/`)) {
    return { ok: false, error: "That file does not belong to this listing." };
  }

  const caps = await effectiveFor(businessId);
  if (caps) {
    const used = await photoUsage(businessId);
    if (allowance(caps, "photos", used).atCap) return { ok: false, error: "at_cap" };
  }

  const [hasCover, last] = await Promise.all([
    prisma.media.findFirst({ where: { businessId, kind: "cover" }, select: { id: true } }),
    prisma.media.findFirst({
      where: { businessId, kind: { in: [...BOARD_KINDS] } },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    }),
  ]);

  await prisma.media.create({
    data: {
      businessId,
      kind: hasCover ? "gallery" : "cover",
      storagePath: input.path,
      alt: input.filename,
      slotKey: readSlotKey(input.slotKey),
      bytes: input.bytes,
      width: input.width,
      height: input.height,
      sortOrder: (last?.sortOrder ?? -1) + 1,
    },
  });

  return { ok: true };
}

/**
 * Move the cover.
 *
 * Demote then promote, in one transaction. The partial unique index refuses the
 * half-applied state outright, so a crash between the two leaves the listing
 * with the cover it had rather than with none.
 */
export async function setCover(
  actor: Actor,
  businessId: string,
  mediaId: string,
): Promise<PhotoResult> {
  assertCanEditListing(actor);
  if (actor.businessId !== businessId) {
    return { ok: false, error: "You can only change your own listing." };
  }

  const target = await prisma.media.findFirst({
    where: { id: mediaId, businessId, kind: { in: [...BOARD_KINDS] } },
    select: { id: true, kind: true },
  });
  if (!target) return { ok: false, error: "That photograph cannot be found." };
  if (target.kind === "cover") return { ok: true };

  await prisma.$transaction([
    prisma.media.updateMany({ where: { businessId, kind: "cover" }, data: { kind: "gallery" } }),
    prisma.media.update({ where: { id: target.id }, data: { kind: "cover" } }),
  ]);

  return { ok: true };
}

/**
 * Reorder the grid.
 *
 * The order is the storefront gallery's order, which is why it is worth a drag
 * rather than a sort control: the seller is arranging what a buyer scrolls
 * through, and the only person who knows which photograph should be second is
 * them.
 *
 * Ids not belonging to this business are dropped rather than refused. A stale
 * tab posting an order containing a photograph somebody has since deleted
 * should still get its remaining order applied.
 */
export async function reorderPhotos(
  actor: Actor,
  businessId: string,
  ids: readonly string[],
): Promise<PhotoResult> {
  assertCanEditListing(actor);
  if (actor.businessId !== businessId) {
    return { ok: false, error: "You can only change your own listing." };
  }

  const mine = await prisma.media.findMany({
    where: { id: { in: [...ids] }, businessId, kind: { in: [...BOARD_KINDS] } },
    select: { id: true },
  });
  const allowed = new Set(mine.map((row) => row.id));
  const ordered = ids.filter((id) => allowed.has(id));
  if (ordered.length === 0) return { ok: true };

  await prisma.$transaction(
    ordered.map((id, index) =>
      prisma.media.update({ where: { id }, data: { sortOrder: index } }),
    ),
  );

  return { ok: true };
}

/**
 * Remove one.
 *
 * The storage object is left where it is. Deleting it needs the same admin
 * client the upload used and a failure there must not take the row with it —
 * an orphaned object costs pennies, and a row pointing at a file that is gone
 * is a broken image on a storefront.
 *
 * Removing the cover promotes the next photograph rather than leaving the
 * listing without one.
 */
export async function deletePhoto(
  actor: Actor,
  businessId: string,
  mediaId: string,
): Promise<PhotoResult> {
  assertCanEditListing(actor);
  if (actor.businessId !== businessId) {
    return { ok: false, error: "You can only change your own listing." };
  }

  const target = await prisma.media.findFirst({
    where: { id: mediaId, businessId, kind: { in: [...BOARD_KINDS] } },
    select: { id: true, kind: true },
  });
  if (!target) return { ok: false, error: "That photograph cannot be found." };

  await prisma.media.delete({ where: { id: target.id } });

  if (target.kind === "cover") {
    const next = await prisma.media.findFirst({
      where: { businessId, kind: "gallery" },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { id: true },
    });
    if (next) await prisma.media.update({ where: { id: next.id }, data: { kind: "cover" } });
  }

  return { ok: true };
}
