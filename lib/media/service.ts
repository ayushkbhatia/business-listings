import "server-only";
import { prisma } from "@/lib/db/client";
import { DOCUMENT_BUCKET, MEDIA_BUCKET, removeObject } from "@/lib/storage";
import { parseFileId, type FileKind } from "./library";
import { referencesForFile } from "./references";
import { canDelete, type Reference } from "./state";

/**
 * Board 3i's writes, and the one refusal the board turned into a warning.
 *
 * `deleteMedia` used to take an id, check the owner, and delete. It looked at
 * no reference of any kind — so a seller could remove the photograph on a live
 * product page, or the datasheet attached to a quote a buyer was reading, and
 * the only sign was a broken image afterwards.
 *
 * Deleting a quote-held file is **refused**, not warned about. Same position as
 * `3h` §5's flag-not-delist, `6f`'s 301-not-404 and `4e`'s no-grace publish:
 * the platform does not offer a control whose only outcome is destroying
 * something somebody else is relying on. Detaching from products stays
 * available, because that is the seller's to decide; the file stays until the
 * citing quotes age out, and the retention window belongs to `3k`.
 */

export type MediaError =
  | "not_found"
  | "quote_held"
  | "folder_exists"
  | "not_an_image"
  | "empty_name";

export type MediaResult<T = void> =
  | ({ ok: true } & (T extends void ? Record<never, never> : { value: T }))
  | { ok: false; error: MediaError; message: string; holders?: string[] };

const fail = (error: MediaError, message: string, holders?: string[]) => ({
  ok: false as const,
  error,
  message,
  ...(holders ? { holders } : {}),
});

/** The row behind a prefixed id, scoped to the seller who is asking. */
async function ownedFile(businessId: string, fileId: string) {
  const parsed = parseFileId(fileId);
  if (!parsed) return null;

  if (parsed.kind === "image") {
    const row = await prisma.media.findFirst({
      where: { id: parsed.id, businessId, reviewId: null },
      select: { id: true, storagePath: true, alt: true },
    });
    return row ? ({ kind: "image" as FileKind, ...row } as const) : null;
  }

  const row = await prisma.document.findFirst({
    where: { id: parsed.id, businessId },
    select: { id: true, storagePath: true, filename: true, displayName: true },
  });
  return row
    ? ({
        kind: "document" as FileKind,
        ...row,
        // What the seller calls it, which is what the tile shows. The preview
        // named `scan_1000.pdf` while the grid named `ISO 9001:2015` — one file
        // with two names across two surfaces is the identity defect CLAUDE.md
        // warns about, in miniature.
        filename: row.displayName ?? row.filename,
        alt: null,
      } as const)
    : null;
}

/* ── Delete, and the refusal ─────────────────────────────────────────────── */

export interface DeletePreview {
  fileId: string;
  filename: string;
  /** Products that lose the file. */
  products: string[];
  /**
   * Everything else that points at it — the storefront, a team member, an
   * enquiry thread.
   *
   * Separate from `products` because the copy treats them differently, and
   * because "nothing references this file" must be answerable from the whole
   * set. The first version asked only about products and told a seller that a
   * certificate live on their listing was referenced by nothing, which is the
   * exact conflation this board exists to remove.
   */
  otherReferences: string[];
  /** Products that lose their *primary* image and fall back to the next. */
  primaryFor: string[];
  /** Quotes holding it. Non-empty means the delete is refused. */
  holders: string[];
}

/**
 * What deleting this file would do, computed before anything runs.
 *
 * Board 3f §3's convention: an action ending in `…` opens a preview naming what
 * changes. For a shared file that preview names every product affected and
 * calls out any where the file is primary, because `1g` falls back to the next
 * image and `3f`'s row will read *no photo*.
 */
export async function previewDelete(
  businessId: string,
  fileId: string,
): Promise<MediaResult<DeletePreview>> {
  const file = await ownedFile(businessId, fileId);
  if (!file) return fail("not_found", "That file is not in your library.");

  const references = await referencesForFile(businessId, file.id);
  const verdict = canDelete(references);

  return {
    ok: true,
    value: {
      fileId,
      filename: "filename" in file ? file.filename : (file.storagePath.split("/").pop() ?? fileId),
      products: verdict.ok ? verdict.products : productsOf(references),
      otherReferences: references
        .filter((reference) => reference.kind !== "product" && reference.kind !== "sent_quote")
        .map((reference) => reference.label),
      primaryFor: verdict.ok ? verdict.primaryFor : [],
      holders: verdict.ok ? [] : verdict.holders,
    },
  };
}

const productsOf = (references: readonly Reference[]) =>
  references.filter((reference) => reference.kind === "product").map((r) => r.label);

export async function deleteFile(businessId: string, fileId: string): Promise<MediaResult> {
  const file = await ownedFile(businessId, fileId);
  if (!file) return fail("not_found", "That file is not in your library.");

  const references = await referencesForFile(businessId, file.id);
  const verdict = canDelete(references);
  if (!verdict.ok) {
    return fail(
      "quote_held",
      "A buyer holds a quote linking to this file, so it cannot be deleted. Detach it from your products if you no longer want it on them.",
      verdict.holders,
    );
  }

  /*
     The row first. An orphaned object costs storage; an orphaned row renders a
     broken image on a storefront, which is the worse of the two. The join rows
     go with it by cascade, so every product carrying it loses one image and
     the next in the gallery becomes primary — which is what the preview said.
  */
  if (file.kind === "image") {
    await prisma.media.delete({ where: { id: file.id } });
    await removeObject(MEDIA_BUCKET, file.storagePath).catch(() => undefined);
  } else {
    await prisma.document.delete({ where: { id: file.id } });
    await removeObject(DOCUMENT_BUCKET, file.storagePath).catch(() => undefined);
  }
  return { ok: true };
}

/* ── Folders ─────────────────────────────────────────────────────────────── */

export async function createFolder(
  businessId: string,
  name: string,
): Promise<MediaResult<string>> {
  const trimmed = name.trim();
  if (!trimmed) return fail("empty_name", "Give the folder a name.");

  const existing = await prisma.mediaFolder.findFirst({
    where: { businessId, name: trimmed },
    select: { id: true },
  });
  if (existing) return fail("folder_exists", `You already have a folder called ${trimmed}.`);

  const created = await prisma.mediaFolder.create({
    data: { businessId, name: trimmed },
    select: { id: true },
  });
  return { ok: true, value: created.id };
}

/** Moving is additive and reversible, so it needs no preview — board 3i §6. */
export async function moveToFolder(
  businessId: string,
  fileIds: readonly string[],
  folderId: string | null,
): Promise<MediaResult> {
  if (folderId !== null) {
    const folder = await prisma.mediaFolder.findFirst({
      where: { id: folderId, businessId },
      select: { id: true },
    });
    if (!folder) return fail("not_found", "That folder is not yours.");
  }

  const parsed = fileIds.map(parseFileId).filter((row): row is NonNullable<typeof row> => !!row);
  const mediaIds = parsed.filter((row) => row.kind === "image").map((row) => row.id);
  const documentIds = parsed.filter((row) => row.kind === "document").map((row) => row.id);

  await prisma.$transaction([
    prisma.media.updateMany({
      where: { id: { in: mediaIds }, businessId, reviewId: null },
      data: { folderId },
    }),
    prisma.document.updateMany({
      where: { id: { in: documentIds }, businessId },
      data: { folderId },
    }),
  ]);
  return { ok: true };
}

/* ── Alt text ────────────────────────────────────────────────────────────── */

/**
 * Alt text belongs to the **file**, not to the product — board 3i Q3.
 *
 * It describes the image, and a per-product override would multiply the
 * missing-alt problem by the reference count: one photograph on three products
 * would be three descriptions to write and three ways to leave it empty.
 */
export async function saveAlt(
  businessId: string,
  fileId: string,
  alt: string,
): Promise<MediaResult> {
  const parsed = parseFileId(fileId);
  if (!parsed || parsed.kind !== "image") {
    return fail("not_an_image", "Only an image carries alt text.");
  }

  const { count } = await prisma.media.updateMany({
    where: { id: parsed.id, businessId, reviewId: null },
    data: { alt: alt.trim() || null },
  });
  if (count === 0) return fail("not_found", "That file is not in your library.");
  return { ok: true };
}

/* ── Products ────────────────────────────────────────────────────────────── */

export async function attachToProduct(
  businessId: string,
  fileIds: readonly string[],
  productId: string,
): Promise<MediaResult> {
  const product = await prisma.product.findFirst({
    where: { id: productId, businessId },
    select: { id: true, _count: { select: { media: true, documents: true } } },
  });
  if (!product) return fail("not_found", "That product is not yours.");

  const parsed = fileIds.map(parseFileId).filter((row): row is NonNullable<typeof row> => !!row);
  let nextImage = product._count.media;
  let nextDoc = product._count.documents;

  for (const file of parsed) {
    if (file.kind === "image") {
      const owned = await prisma.media.findFirst({
        where: { id: file.id, businessId, reviewId: null },
        select: { id: true },
      });
      if (!owned) continue;
      await prisma.productMedia.upsert({
        where: { productId_mediaId: { productId, mediaId: file.id } },
        create: { productId, mediaId: file.id, sortOrder: nextImage },
        update: {},
      });
      nextImage += 1;
    } else {
      const owned = await prisma.document.findFirst({
        where: { id: file.id, businessId },
        select: { id: true },
      });
      if (!owned) continue;
      await prisma.productDocument.upsert({
        where: { productId_documentId: { productId, documentId: file.id } },
        create: { productId, documentId: file.id, sortOrder: nextDoc },
        update: {},
      });
      nextDoc += 1;
    }
  }
  return { ok: true };
}

export async function detachFromProduct(
  businessId: string,
  fileId: string,
  productId: string,
): Promise<MediaResult> {
  const parsed = parseFileId(fileId);
  if (!parsed) return fail("not_found", "That file is not in your library.");

  const product = await prisma.product.findFirst({
    where: { id: productId, businessId },
    select: { id: true },
  });
  if (!product) return fail("not_found", "That product is not yours.");

  if (parsed.kind === "image") {
    await prisma.productMedia.deleteMany({ where: { productId, mediaId: parsed.id } });
    await resequence(productId);
  } else {
    await prisma.productDocument.deleteMany({ where: { productId, documentId: parsed.id } });
  }
  return { ok: true };
}

/**
 * Make this file the product's primary image.
 *
 * Position zero, and everything else shifts down. There is no `isPrimary`
 * column to set: the gallery order **is** the answer, so board 1g's rendering
 * and this control cannot disagree — acceptance criterion 8.
 */
export async function setPrimary(
  businessId: string,
  fileId: string,
  productId: string,
): Promise<MediaResult> {
  const parsed = parseFileId(fileId);
  if (!parsed || parsed.kind !== "image") {
    return fail("not_an_image", "Only an image can be a product's primary picture.");
  }

  const product = await prisma.product.findFirst({
    where: { id: productId, businessId },
    select: { id: true },
  });
  if (!product) return fail("not_found", "That product is not yours.");

  const rows = await prisma.productMedia.findMany({
    where: { productId },
    orderBy: { sortOrder: "asc" },
    select: { mediaId: true },
  });
  if (!rows.some((row) => row.mediaId === parsed.id)) {
    return fail("not_found", "That file is not on this product.");
  }

  const ordered = [parsed.id, ...rows.map((r) => r.mediaId).filter((id) => id !== parsed.id)];
  await prisma.$transaction(
    ordered.map((mediaId, index) =>
      prisma.productMedia.update({
        where: { productId_mediaId: { productId, mediaId } },
        data: { sortOrder: index },
      }),
    ),
  );
  return { ok: true };
}

/** Closes the gap a detach leaves, so position zero is always the primary. */
async function resequence(productId: string): Promise<void> {
  const rows = await prisma.productMedia.findMany({
    where: { productId },
    orderBy: { sortOrder: "asc" },
    select: { mediaId: true },
  });
  await prisma.$transaction(
    rows.map((row, index) =>
      prisma.productMedia.update({
        where: { productId_mediaId: { productId, mediaId: row.mediaId } },
        data: { sortOrder: index },
      }),
    ),
  );
}

/* ── Storage ─────────────────────────────────────────────────────────────── */

/**
 * Bytes this seller is holding.
 *
 * Images and documents both, because both cost money to hold and the header
 * states one figure. A buyer's review photograph is excluded — it is not the
 * seller's file and charging their allowance for it would be a bill for
 * somebody else's upload.
 */
export async function storageUsedBytes(businessId: string): Promise<number> {
  const [images, documents] = await Promise.all([
    prisma.media.aggregate({
      where: { businessId, reviewId: null },
      _sum: { bytes: true },
    }),
    prisma.document.aggregate({ where: { businessId }, _sum: { bytes: true } }),
  ]);
  return (images._sum.bytes ?? 0) + (documents._sum.bytes ?? 0);
}
