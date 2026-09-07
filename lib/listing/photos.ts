import "server-only";
import { prisma } from "@/lib/db/client";
import { assertCanEditListing } from "@/lib/auth/guards";
import type { Actor } from "@/lib/auth/roles";
import { MEDIA_BUCKET, publicUrl } from "@/lib/storage";
import { recordPhotoRevision } from "./save";

/**
 * Board 3b §Photos — **references into `3i`, never uploads.**
 *
 * The board this replaces said `28 uploaded, first 6 shown on the storefront`,
 * which implied the listing editor stores files. It does not. Media files are
 * owned by the media library board `3i` built, one file can serve a product and
 * a storefront at once, and this screen only decides which of them lead the
 * public page and in what order.
 *
 * Three consequences the code has to carry, not just the copy:
 *
 *   1. The label counts both sides — six picked, twenty-eight held — so the
 *      seller can see that the library is bigger than the selection.
 *   2. The seventh tile opens the library rather than reading `+ 22`. An
 *      overflow count implied the other twenty-two were also somehow published.
 *   3. **Removing unpicks.** `unpick` moves a file to `kind: "library"`, which
 *      exists for exactly this and names no surface. The row, its alt text, its
 *      folder and its dimensions are untouched, and `3i` still lists it.
 *      Deleting is `3i`'s action, behind `3i`'s blast-radius warning.
 */

/** The kinds that put a photograph on the public storefront, in order. */
const PICKED = ["cover", "gallery"] as const;

export interface PickedPhoto {
  id: string;
  url: string;
  alt: string | null;
  /** Position one. The storefront hero reads this. */
  isCover: boolean;
  sortOrder: number;
}

export interface PhotoPicks {
  picked: PickedPhoto[];
  /** Everything the seller holds, picked or not. The `28`. */
  libraryCount: number;
}

export async function photoPicks(businessId: string): Promise<PhotoPicks> {
  const [rows, libraryCount] = await Promise.all([
    prisma.media.findMany({
      where: { businessId, kind: { in: [...PICKED] }, reviewId: null },
      orderBy: [{ kind: "asc" }, { sortOrder: "asc" }],
      select: { id: true, kind: true, storagePath: true, alt: true, sortOrder: true },
    }),
    /*
       Every image the seller holds, including the ones on products and the ones
       placed nowhere. The label says "of the 28 in your media library", and the
       library is the whole library — counting only the unpicked ones would make
       the two numbers unaddable and the sentence wrong.
    */
    prisma.media.count({
      where: { businessId, reviewId: null, kind: { not: "logo" } },
    }),
  ]);

  return {
    picked: rows.map((row) => ({
      id: row.id,
      url: publicUrl(MEDIA_BUCKET, row.storagePath),
      alt: row.alt,
      isCover: row.kind === "cover",
      sortOrder: row.sortOrder,
    })),
    libraryCount,
  };
}

/** What `Choose from library` offers: held, and on no public surface. */
export async function unpickedPhotos(businessId: string) {
  const rows = await prisma.media.findMany({
    where: { businessId, kind: "library", reviewId: null },
    orderBy: { createdAt: "desc" },
    take: 60,
    select: { id: true, storagePath: true, alt: true },
  });
  return rows.map((row) => ({
    id: row.id,
    url: publicUrl(MEDIA_BUCKET, row.storagePath),
    alt: row.alt,
  }));
}

export type PickResult = { ok: true } | { ok: false; error: string };

/**
 * Take a photograph off the storefront without touching the file.
 *
 * Criterion 7. The cover is refused rather than silently promoting the next
 * one: a storefront with no cover renders the no-cover state, and a seller who
 * removed one photograph should not discover they changed the hero as well.
 * Setting a new cover first is one click and says what it does.
 */
export async function unpick(
  actor: Actor,
  businessId: string,
  mediaId: string,
): Promise<PickResult> {
  assertCanEditListing(actor);
  if (actor.businessId !== businessId) {
    return { ok: false, error: "You can only edit your own listing." };
  }

  const media = await prisma.media.findUnique({
    where: { id: mediaId },
    select: { id: true, kind: true, businessId: true },
  });
  if (!media || media.businessId !== businessId) {
    return { ok: false, error: "That photograph is not on your listing." };
  }
  if (media.kind === "cover") {
    return {
      ok: false,
      error: "That is your cover photograph. Make another one the cover first, then remove it.",
    };
  }
  if (!(PICKED as readonly string[]).includes(media.kind)) {
    return { ok: false, error: "That photograph is not on your listing." };
  }

  await prisma.media.update({ where: { id: media.id }, data: { kind: "library" } });
  await recordPhotoRevision(businessId, actor.id, 1);
  return { ok: true };
}

/** Put a library file back on the storefront, at the end of the order. */
export async function pick(
  actor: Actor,
  businessId: string,
  mediaId: string,
): Promise<PickResult> {
  assertCanEditListing(actor);
  if (actor.businessId !== businessId) {
    return { ok: false, error: "You can only edit your own listing." };
  }

  const media = await prisma.media.findUnique({
    where: { id: mediaId },
    select: { id: true, kind: true, businessId: true },
  });
  if (!media || media.businessId !== businessId) {
    return { ok: false, error: "That file is not in your library." };
  }
  if (media.kind === "product") {
    /*
       Refused, not moved. A product image is referenced by `ProductMedia`, and
       changing its kind here would take it off the product pages that cite it —
       a destructive edit dressed as a pick. `3i` is where a file's placement
       across surfaces is managed, with the reference list in view.
    */
    return {
      ok: false,
      error: "That file is on a product. Use the media library to place it in more than one place.",
    };
  }

  const last = await prisma.media.aggregate({
    where: { businessId, kind: { in: [...PICKED] } },
    _max: { sortOrder: true },
  });

  await prisma.media.update({
    where: { id: media.id },
    data: { kind: "gallery", sortOrder: (last._max.sortOrder ?? 0) + 1 },
  });
  await recordPhotoRevision(businessId, actor.id, 1);
  return { ok: true };
}

/**
 * Make one photograph the cover.
 *
 * Exactly one row carries `kind: "cover"` — the storefront hero reads the first
 * of `cover`/`gallery` by sort order, so two would make the hero depend on an
 * ordering nobody set. The outgoing cover becomes an ordinary picked photograph
 * rather than being unpicked; it was on the storefront before and still is.
 */
export async function setCover(
  actor: Actor,
  businessId: string,
  mediaId: string,
): Promise<PickResult> {
  assertCanEditListing(actor);
  if (actor.businessId !== businessId) {
    return { ok: false, error: "You can only edit your own listing." };
  }

  const media = await prisma.media.findUnique({
    where: { id: mediaId },
    select: { id: true, kind: true, businessId: true },
  });
  if (!media || media.businessId !== businessId) {
    return { ok: false, error: "That photograph is not on your listing." };
  }
  if (!(PICKED as readonly string[]).includes(media.kind)) {
    return { ok: false, error: "Add that photograph to your listing before making it the cover." };
  }

  await prisma.$transaction([
    prisma.media.updateMany({
      where: { businessId, kind: "cover" },
      data: { kind: "gallery" },
    }),
    prisma.media.update({ where: { id: media.id }, data: { kind: "cover", sortOrder: 0 } }),
  ]);
  await recordPhotoRevision(businessId, actor.id, 1);
  return { ok: true };
}
