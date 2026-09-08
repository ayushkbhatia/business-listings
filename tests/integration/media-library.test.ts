import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { encodeFileId, mediaLibrary } from "@/lib/media/library";
import { referencesForFile } from "@/lib/media/references";
import {
  attachToProduct,
  createFolder,
  deleteFile,
  detachFromProduct,
  moveToFolder,
  previewDelete,
  saveAlt,
  setPrimary,
  storageUsedBytes,
} from "@/lib/media/service";

/**
 * Board 3i, against a real database.
 *
 * The criterion this file exists for is 2 and 3, together:
 *
 *   "Unreferenced is computed across products, pages, guides, enquiries **and
 *    sent quotes**. A file with no product attachment but a quote citation is
 *    never counted as unreferenced."
 *   "Deleting a file cited by a sent quote is refused, with the reason named.
 *    Not a warning."
 *
 * The fixture that proves it is a document with **no product attachment at
 * all** — the exact file the board offered to delete as one of its 41 — cited
 * by a quote that has been sent. Everything else here is the reference model
 * the board was already drawing without a schema that allowed it.
 */

const PREFIX = "media3i";

let businessId: string;
let categoryId: string;
let productA: string;
let productB: string;
const made: { media: string[]; documents: string[]; products: string[] } = {
  media: [],
  documents: [],
  products: [],
};

beforeAll(async () => {
  const business = await prisma.business.findFirstOrThrow({
    where: { claimStatus: "claimed", products: { some: {} } },
    orderBy: { slug: "asc" },
    select: { id: true, primaryCategoryId: true },
  });
  businessId = business.id;
  categoryId = business.primaryCategoryId!;

  const stamp = Date.now().toString(36);
  for (const name of ["a", "b"]) {
    const product = await prisma.product.create({
      data: {
        businessId,
        categoryId,
        name: `${PREFIX} ${name} ${stamp}`,
        slug: `${PREFIX}-${name}-${stamp}`,
        status: "live",
        availability: "in_stock",
        searchText: `${PREFIX} ${name}`,
      },
      select: { id: true },
    });
    made.products.push(product.id);
  }
  [productA, productB] = made.products as [string, string];
});

/**
 * A product of this test's own.
 *
 * The gallery order is shared state: a test that attaches two images to
 * `productA` changes what position zero means for every test after it. The two
 * primary-order cases below were written against a fresh product and failed
 * beside their own file's earlier cases, which is the same fixture-sharing
 * defect this suite's `beforeAll` avoids for businesses.
 */
async function ownProduct(): Promise<string> {
  seq += 1;
  const row = await prisma.product.create({
    data: {
      businessId,
      categoryId,
      name: `${PREFIX} own ${Date.now()}-${seq}`,
      slug: `${PREFIX}-own-${Date.now()}-${seq}`,
      status: "live",
      availability: "in_stock",
      searchText: `${PREFIX} own`,
    },
    select: { id: true },
  });
  made.products.push(row.id);
  return row.id;
}

afterAll(async () => {
  await prisma.media.deleteMany({ where: { id: { in: made.media } } });
  await prisma.document.deleteMany({ where: { id: { in: made.documents } } });
  await prisma.product.deleteMany({ where: { id: { in: made.products } } });
  await prisma.mediaFolder.deleteMany({ where: { businessId, name: { startsWith: PREFIX } } });
  await prisma.$disconnect();
});

let seq = 0;

async function image(over: { alt?: string | null; bytes?: number } = {}) {
  seq += 1;
  const row = await prisma.media.create({
    data: {
      businessId,
      kind: "product",
      storagePath: `${businessId}/product/${PREFIX}-${Date.now()}-${seq}.jpg`,
      alt: over.alt ?? null,
      bytes: over.bytes ?? 120_000,
      width: 2400,
      height: 1600,
    },
    select: { id: true },
  });
  made.media.push(row.id);
  return row.id;
}

async function document(over: { bytes?: number } = {}) {
  seq += 1;
  const row = await prisma.document.create({
    data: {
      businessId,
      kind: "datasheet",
      storagePath: `${businessId}/datasheet/${PREFIX}-${Date.now()}-${seq}.pdf`,
      filename: `${PREFIX}-${seq}.pdf`,
      bytes: over.bytes ?? 400_000,
      mimeType: "application/pdf",
    },
    select: { id: true },
  });
  made.documents.push(row.id);
  return row.id;
}

/* ── Criterion 5 — one file, many products, stored once ──────────────────── */

describe("the reference model", () => {
  it("puts one image on two products without copying it", async () => {
    const id = await image();
    const fileId = encodeFileId("image", id);

    expect((await attachToProduct(businessId, [fileId], productA)).ok).toBe(true);
    expect((await attachToProduct(businessId, [fileId], productB)).ok).toBe(true);

    // One row, two references. Not two rows.
    expect(await prisma.media.count({ where: { storagePath: { contains: id } } })).toBeLessThan(2);
    const references = await referencesForFile(businessId, id);
    expect(references.filter((r) => r.kind === "product")).toHaveLength(2);
  });

  it("cites one datasheet from several products — board 3g Q4", async () => {
    const id = await document();
    const fileId = encodeFileId("document", id);
    await attachToProduct(businessId, [fileId], productA);
    await attachToProduct(businessId, [fileId], productB);

    const references = await referencesForFile(businessId, id);
    expect(references.filter((r) => r.kind === "product")).toHaveLength(2);
  });

  it("makes the first image primary, and the order is the only source of it", async () => {
    const product = await ownProduct();
    const first = await image();
    const second = await image();
    await attachToProduct(businessId, [encodeFileId("image", first)], product);
    await attachToProduct(businessId, [encodeFileId("image", second)], product);

    const before = await referencesForFile(businessId, first);
    expect(before.find((r) => r.kind === "product")?.primary).toBe(true);

    expect((await setPrimary(businessId, encodeFileId("image", second), product)).ok).toBe(true);

    const after = await referencesForFile(businessId, second);
    expect(after.find((r) => r.kind === "product")?.primary).toBe(true);
    const demoted = await referencesForFile(businessId, first);
    expect(demoted.find((r) => r.kind === "product")?.primary).toBeUndefined();

    // Board 1g reads the same order the panel just set. One column, so they
    // cannot disagree — acceptance criterion 8.
    const gallery = await prisma.productMedia.findMany({
      where: { productId: product },
      orderBy: { sortOrder: "asc" },
      select: { mediaId: true },
    });
    expect(gallery[0]?.mediaId).toBe(second);
  });

  it("closes the gap when a file is detached, so position zero is still primary", async () => {
    const product = await ownProduct();
    const first = await image();
    const second = await image();
    await attachToProduct(businessId, [encodeFileId("image", first)], product);
    await attachToProduct(businessId, [encodeFileId("image", second)], product);

    await detachFromProduct(businessId, encodeFileId("image", first), product);

    const rows = await prisma.productMedia.findMany({
      where: { productId: product },
      orderBy: { sortOrder: "asc" },
      select: { mediaId: true, sortOrder: true },
    });
    expect(rows[0]).toMatchObject({ mediaId: second, sortOrder: 0 });
  });
});

/* ── Criteria 2 and 3 — the refusal ─────────────────────────────────────── */

describe("a file a buyer holds a quote for", () => {
  async function quoteHeldDocument() {
    const id = await document();

    const enquiry = await prisma.enquiry.findFirstOrThrow({
      where: { recipients: { some: { businessId } } },
      select: { id: true },
    });
    const quote = await prisma.quote.create({
      data: {
        ref: `Q-${PREFIX}-${Date.now()}`,
        enquiryId: enquiry.id,
        businessId,
        status: "sent",
        sentAt: new Date(),
        attachments: { create: { documentId: id } },
      },
      select: { id: true, ref: true },
    });
    return { id, quoteRef: quote.ref, quoteId: quote.id };
  }

  it("is not counted as unreferenced, though nothing links it to a product", async () => {
    const { id, quoteId } = await quoteHeldDocument();
    try {
      const references = await referencesForFile(businessId, id);
      // No product attachment at all — the exact shape the board's 41 had.
      expect(references.filter((r) => r.kind === "product")).toHaveLength(0);
      expect(references.some((r) => r.kind === "sent_quote")).toBe(true);

      const library = await mediaLibrary(businessId);
      const file = library.files.find((f) => f.id === encodeFileId("document", id));
      expect(file?.unreferenced).toBe(false);
      expect(file?.quoteHeld).toBe(true);
    } finally {
      await prisma.quote.delete({ where: { id: quoteId } });
    }
  });

  it("refuses the delete and names the quote — not a warning", async () => {
    const { id, quoteRef, quoteId } = await quoteHeldDocument();
    try {
      const result = await deleteFile(businessId, encodeFileId("document", id));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("quote_held");
        expect(result.holders).toContain(quoteRef);
      }
      // Still there. A refusal that deletes anyway is not a refusal.
      expect(await prisma.document.findUnique({ where: { id } })).not.toBeNull();
    } finally {
      await prisma.quote.delete({ where: { id: quoteId } });
    }
  });

  it("still allows detaching it from a product", async () => {
    const { id, quoteId } = await quoteHeldDocument();
    try {
      await attachToProduct(businessId, [encodeFileId("document", id)], productA);
      const result = await detachFromProduct(businessId, encodeFileId("document", id), productA);
      expect(result.ok).toBe(true);
    } finally {
      await prisma.quote.delete({ where: { id: quoteId } });
    }
  });

  it("does not refuse for a quote still in draft", async () => {
    const id = await document();
    const enquiry = await prisma.enquiry.findFirstOrThrow({
      where: { recipients: { some: { businessId } } },
      select: { id: true },
    });
    const quote = await prisma.quote.create({
      data: {
        ref: `Q-${PREFIX}-draft-${Date.now()}`,
        enquiryId: enquiry.id,
        businessId,
        status: "draft",
        attachments: { create: { documentId: id } },
      },
      select: { id: true },
    });
    try {
      // Nothing has been sent, so nobody is holding anything.
      const preview = await previewDelete(businessId, encodeFileId("document", id));
      expect(preview.ok).toBe(true);
      if (preview.ok) expect(preview.value.holders).toEqual([]);
    } finally {
      await prisma.quote.delete({ where: { id: quote.id } });
    }
  });
});

/* ── Criterion 4 — the preview names what changes ────────────────────────── */

describe("deleting a shared file", () => {
  it("names every product that loses it, and which lose their primary", async () => {
    const id = await image();
    const fileId = encodeFileId("image", id);
    const product = await ownProduct();
    await attachToProduct(businessId, [fileId], product);
    await attachToProduct(businessId, [fileId], productB);
    await setPrimary(businessId, fileId, product);

    const preview = await previewDelete(businessId, fileId);
    expect(preview.ok).toBe(true);
    if (preview.ok) {
      expect(preview.value.products).toHaveLength(2);
      expect(preview.value.primaryFor).toHaveLength(1);
    }
  });

  it("never says nothing references a file that is live on the listing", async () => {
    /*
       The board's own failure mode, one level down. A published certificate has
       no product attachment, and the first version of this preview asked only
       about products — so it told the seller a document live on their
       storefront was referenced by nothing.
    */
    const id = await document();
    await prisma.document.update({
      where: { id },
      data: { isPublic: true, displayName: `${PREFIX} public cert` },
    });

    const preview = await previewDelete(businessId, encodeFileId("document", id));
    expect(preview.ok).toBe(true);
    if (preview.ok) {
      expect(preview.value.products).toEqual([]);
      expect(preview.value.otherReferences.length).toBeGreaterThan(0);
      // And it is named by what the seller calls it, not by the scan filename.
      expect(preview.value.filename).toBe(`${PREFIX} public cert`);
    }
  });

  it("takes the file off every product it was on", async () => {
    const id = await image();
    const fileId = encodeFileId("image", id);
    await attachToProduct(businessId, [fileId], productA);
    await attachToProduct(businessId, [fileId], productB);

    expect((await deleteFile(businessId, fileId)).ok).toBe(true);
    expect(await prisma.productMedia.count({ where: { mediaId: id } })).toBe(0);
  });
});

/* ── Criteria 1, 7, 13 — folders, alt scope, and counts as queries ──────── */

describe("the library, as the screen reads it", () => {
  it("puts every file in exactly one folder, and the counts sum to the total", async () => {
    const folder = await createFolder(businessId, `${PREFIX} shots`);
    expect(folder.ok).toBe(true);
    if (!folder.ok) return;

    const id = await image();
    await moveToFolder(businessId, [encodeFileId("image", id)], folder.value);

    const library = await mediaLibrary(businessId);
    const summed = library.folders.reduce((sum, entry) => sum + entry.files, 0);
    expect(summed).toBe(library.total);
    // And `Unfiled` is one of them, as the null case rather than a row.
    expect(library.folders.some((entry) => entry.id === null)).toBe(true);
  });

  it("refuses a second folder with the same name", async () => {
    const first = await createFolder(businessId, `${PREFIX} dupe`);
    expect(first.ok).toBe(true);
    const second = await createFolder(businessId, `${PREFIX} dupe`);
    expect(second).toMatchObject({ ok: false, error: "folder_exists" });
  });

  it("counts a missing alt only where a buyer can read it", async () => {
    const hidden = await image({ alt: null });
    const before = (await mediaLibrary(businessId)).missingAltOnLive;

    // Unattached: nobody sees it, so it is not an accessibility failure.
    const library = await mediaLibrary(businessId);
    const file = library.files.find((f) => f.id === encodeFileId("image", hidden));
    expect(file?.badges).not.toContain("no_alt");

    // On a live product it is one, and the badge names the surface.
    await attachToProduct(businessId, [encodeFileId("image", hidden)], productA);
    const after = await mediaLibrary(businessId);
    expect(after.missingAltOnLive).toBeGreaterThan(before);
    const live = after.files.find((f) => f.id === encodeFileId("image", hidden));
    expect(live?.badges).toContain("no_alt");
    expect(live?.liveSurface).toBeTruthy();
  });

  it("stops counting it once the alt text is written", async () => {
    const id = await image({ alt: null });
    await attachToProduct(businessId, [encodeFileId("image", id)], productA);

    expect(
      (await saveAlt(businessId, encodeFileId("image", id), "Grooved butterfly valve DN100")).ok,
    ).toBe(true);

    const library = await mediaLibrary(businessId);
    const file = library.files.find((f) => f.id === encodeFileId("image", id));
    expect(file?.badges).not.toContain("no_alt");
  });

  it("meters the seller's own images, and not what we asked them for", async () => {
    /*
       Changed by the wave-4 fix batch, and it is a decision rather than a
       tidy-up.

       Documents used to count, on the argument that both cost money to hold.
       They do — and we are the ones who asked for them: a trade licence is
       uploaded because board 3e requires it, and none of the three `Document`
       writers checks the cap. Counting them meant either a cap that could not
       be enforced in the direction that matters, or one that could block a
       seller near their limit from completing verification.

       So the cap covers what a seller *chose* to upload. A buyer's review
       photograph is excluded for the older version of the same reason.
    */
    const before = await storageUsedBytes(businessId);
    await image({ bytes: 500_000 });
    await document({ bytes: 250_000 });
    const after = await storageUsedBytes(businessId);
    expect(after - before).toBe(500_000);
  });


  it("keeps a file when the product carrying it is deleted", async () => {
    /*
       A behaviour change, and a deliberate one. `media.product_id` had
       `onDelete: Cascade`, so deleting a product deleted its photographs — the
       file belonged to the product. Under board 3i the file is the library's
       and the product merely references it, so only the reference goes. The
       same image may well be on three other products.
    */
    const product = await ownProduct();
    const id = await image();
    await attachToProduct(businessId, [encodeFileId("image", id)], product);

    await prisma.product.delete({ where: { id: product } });

    expect(await prisma.media.findUnique({ where: { id } })).not.toBeNull();
    expect(await prisma.productMedia.count({ where: { mediaId: id } })).toBe(0);

    const library = await mediaLibrary(businessId);
    const file = library.files.find((f) => f.id === encodeFileId("image", id));
    expect(file?.unreferenced).toBe(true);
  });

  it("never lets a buyer's review photograph into the seller's library", async () => {
    const review = await prisma.review.findFirst({
      where: { businessId },
      select: { id: true },
    });
    if (!review) return;

    const row = await prisma.media.create({
      data: {
        businessId,
        reviewId: review.id,
        kind: "review",
        storagePath: `${businessId}/review/${PREFIX}-${Date.now()}.jpg`,
        bytes: 900_000,
      },
      select: { id: true },
    });
    made.media.push(row.id);

    const library = await mediaLibrary(businessId);
    // Not theirs, so it is neither in the grid nor charged to their allowance.
    expect(library.files.some((f) => f.id === encodeFileId("image", row.id))).toBe(false);
  });
});
